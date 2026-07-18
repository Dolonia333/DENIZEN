# Discord Paid Tier Runbook — guild premium subscriptions

**One page. This is how a Discord server pays to unlock premium bot modules, and how the bot knows.**

Source of truth: `src/denizen-guild-plans.js` (entitlements) + `denizen_guild_plans` table.
Billing (Stripe wiring): `src/denizen-guild-billing.js` + two server endpoints. Everything gates off `guildPlans.isModuleAllowed(guildId, module)`.

---

## 1. Overview — three plans, per guild

| Plan | Default? | Unlocks |
|------|----------|---------|
| `free` | **yes** — a guild with no row is free | free modules only |
| `pro` | no | premium modules |
| `ultra` | no | premium modules (higher tier for future limits) |

Plans are **per guild**, not per user. One paying server = one subscription.

**Premium modules** (require a paid, active plan):

| Module | What it covers |
|--------|----------------|
| `security` | antinuke + antiraid (both register under `security`) |
| `avatar` | cosmetics |
| `community` | community features |

**Free modules** (never gated, never touch the DB): `moderation`, `music`, `tickets`, `automod`, `voicemaster`, `misc`, `core`.

The premium set lives in one place — `PREMIUM_MODULES` in `denizen-guild-plans.js`. Add a module name there to gate it; leave it out to keep it free.

---

## 2. Data model — `denizen_guild_plans`

One row per guild. Migration: `supabase/migrations/20260718000001_discord_guild_plans.sql`.

| Column | Type | Notes |
|--------|------|-------|
| `guild_id` | text **PK** | Discord guild id; one row per guild |
| `plan` | text | `free` \| `pro` \| `ultra` (CHECK), default `free` |
| `status` | text | `active` \| `trialing` \| `past_due` \| `canceled` \| `incomplete` \| `unpaid` (CHECK), default `active` |
| `stripe_customer_id` | text | indexed (partial, non-null) |
| `stripe_subscription_id` | text | indexed (partial, non-null) |
| `price_id` | text | Stripe Price id that was purchased |
| `current_period_end` | timestamptz | when the paid period lapses |
| `linked_user_id` | text | discord_user_id of whoever subscribed |
| `metadata` | jsonb | free-form, default `{}` |
| `created_at` / `updated_at` | timestamptz | default `now()` |

**RLS is ON, service-role only.** No anon/authenticated client reads or writes billing rows — the bot and app reach the table with `SUPABASE_SERVICE_ROLE_KEY`. Absence of a row == free plan.

---

## 3. How gating works

Premium is enforced in **two** places, both off `guildPlans.isModuleAllowed`:

1. **Command dispatch** (`command-registry.js`) — a premium command in an
   unentitled guild is refused with an upgrade prompt.
2. **Event hooks** (`load-modules.js` `gatedHook`) — premium modules' *passive*
   listeners (antinuke audit sweeps, antiraid join checks, community
   message/reaction/member listeners, avatar component interactions) are
   wrapped so they only run for an entitled guild. Without this, the paid
   protection ran for everyone regardless of payment. Free-module hooks are
   never wrapped (no per-event DB cost); DMs (no guild) always run.

At command dispatch the bot asks the entitlement module:

```js
const allowed = await guildPlans.isModuleAllowed(guildId, cmd.module);
// free module        → true immediately (no DB call)
// premium module     → true only if plan != 'free' AND status ∈ {active, trialing}
```

`command-registry.js` requires `../../../src/denizen-guild-plans.js` (best-effort — if the require fails, `guildPlans` is null and the caller degrades gracefully). Rules that matter:

- **Free modules never hit the DB.** `isPremiumModule()` short-circuits to `true`.
- **Premium = `plan.active === true`**, which means `plan !== 'free'` **and** `status` is `active` or `trialing`. `past_due`, `canceled`, `incomplete`, `unpaid` → denied.
- **60-second in-memory cache** (`CACHE_TTL_MS`). Fresh reads come from cache; stale ones refetch from PostgREST.
- **A DB blip does not downgrade a paying guild.** If a refresh fails (timeout / non-200) *and* there's a cached row, the last-known-good plan is kept and retried shortly. Fail-closed only happens when there's **no cache and no DB** — then the guild is treated as free (premium denied).
- Fetch has a **2.5s abort timeout** so a slow Supabase can't stall command dispatch.

---

## 4. Environment variables

| Var | Purpose |
|-----|---------|
| `STRIPE_SECRET_KEY` | Stripe API key the billing module signs requests with. No key = billing disabled. |
| `STRIPE_GUILD_WEBHOOK_SECRET` | Signing secret for the guild-billing webhook endpoint. **Falls back to `STRIPE_WEBHOOK_SECRET`** if unset. |
| `STRIPE_PRICE_PRO` | Stripe Price id for the Pro plan (checkout uses it as the subscription line item). |
| `STRIPE_PRICE_ULTRA` | Stripe Price id for the Ultra plan. |
| `DISCORD_UPGRADE_URL` | Public "upgrade this server" link shown when a premium command is denied. |
| `SUPABASE_URL` | Base URL of the Supabase project (PostgREST endpoint for the plans table). |
| `SUPABASE_SERVICE_ROLE_KEY` | Service-role key — required to read/write `denizen_guild_plans` under RLS. |

Entitlement reads need `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`. If either is missing, `dbConfigured()` is false: free modules still work, premium is denied (fail-closed).

---

## 5. Endpoints

Both live on the denizen server and are backed by `src/denizen-guild-billing.js`.

### `POST /api/discord/billing/checkout`

Creates a Stripe Checkout session (subscription mode) and returns the hosted-checkout URL.

```http
POST /api/discord/billing/checkout
Content-Type: application/json

{ "guildId": "123456789012345678", "plan": "pro", "discordUserId": "9876..." }
```

```json
{ "url": "https://checkout.stripe.com/c/pay/cs_test_..." }
```

- `mode=subscription`, line item = the Price for the requested `plan` (`STRIPE_PRICE_PRO` / `STRIPE_PRICE_ULTRA`).
- `guildId` and `discordUserId` are carried in session metadata so the webhook can write the right guild row and `linked_user_id`.

### `POST /api/discord/billing/webhook`

Receives raw Stripe events. The **raw request body** must reach the handler unparsed — signature verification is an HMAC over the raw bytes (mirrors `verifyStripeSignature` in `denizen-crm-stripe.js`). Verified with `STRIPE_GUILD_WEBHOOK_SECRET` (→ `STRIPE_WEBHOOK_SECRET` fallback). Unverifiable events are rejected, not trusted.

---

## 6. Subscription lifecycle

| Stripe event | Effect |
|--------------|--------|
| `checkout.session.completed` | Webhook upserts the guild's row via `setGuildPlanFromStripe(...)` (plan, status, customer/subscription ids, price id, period end, `linked_user_id`). Bot picks it up within **60s** (cache TTL). |
| `customer.subscription.updated` | Sync `status` + `plan` (e.g. `active` → `past_due`, or Pro → Ultra). Row updated in place by `stripe_subscription_id`. |
| `customer.subscription.deleted` | Plan reverts to **free** (status `canceled`); premium modules stop resolving on the next cache refresh. |

The write path is `setGuildPlanFromStripe(patch)` — upsert on `guild_id` (`Prefer: resolution=merge-duplicates`), which also refreshes the in-memory cache immediately for that guild.

---

## 7. Stripe dashboard setup

1. **Create two Products** — "Denizen Pro" and "Denizen Ultra". Give each a **recurring monthly Price**.
2. **Copy the two Price ids** into env: `STRIPE_PRICE_PRO` and `STRIPE_PRICE_ULTRA`.
3. **Add a webhook endpoint** pointing at `https://<host>/api/discord/billing/webhook`, subscribed to exactly:
   - `checkout.session.completed`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
4. **Copy that endpoint's signing secret** into `STRIPE_GUILD_WEBHOOK_SECRET`.
5. Restart the denizen server so it picks up the new env.

---

## 8. Local testing

### Stripe CLI (webhook path)

```bash
# Forward live Stripe events to the local server (prints a whsec_... — set it as
# STRIPE_GUILD_WEBHOOK_SECRET for the session, or rely on STRIPE_WEBHOOK_SECRET)
stripe listen --forward-to localhost:8080/api/discord/billing/webhook

# In another terminal, fire a completed checkout:
stripe trigger checkout.session.completed
```

### Grant a test guild Pro directly (skip Stripe)

PostgREST or raw SQL against Supabase — no payment needed:

```sql
insert into denizen_guild_plans (guild_id, plan, status)
values ('<gid>', 'pro', 'active')
on conflict (guild_id) do update
  set plan = excluded.plan, status = excluded.status;
```

Premium modules unlock for that guild within 60s (cache TTL). To force it sooner, call `guildPlans.invalidate('<gid>')` or restart the bot.

---

## 9. Rollout note

**Ship the punch-list fixes before charging anyone.** The entitlement check is deliberately conservative:

- It **fails closed** — if Supabase is unreachable **and** there's no cached row, premium is **denied**, not granted.
- Once a guild's plan is cached, a transient DB error will **not** downgrade them (last-known-good is retained for a short retry window).

Net effect: a Supabase outage can briefly lock paying guilds out of premium if their cache is cold — acceptable, since the alternative (fail-open) would give away premium for free. Verify Supabase reachability and env pins before flipping billing live.

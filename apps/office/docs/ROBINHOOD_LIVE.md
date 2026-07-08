# Robinhood Live OAuth (Denizen / Roki)

This runbook enables live Robinhood MCP market connectivity for Roki in read-only mode.

## Design Rule (Read-Only)

Denizen never executes trades through Robinhood.

- No order placement API is exposed by Denizen.
- Trade intent is stored as suggestion data only.
- User executes any real trade manually in Robinhood.

Implementation source: `src/integrations/robinhood-mcp.js`.

## Roki Integration

Roki is the default NPC owner for market telemetry:

- watchlist persistence defaults to `npc_key = roki`
- trade suggestion persistence defaults to `npc_key = roki`
- market observation loop seeds and tracks a Roki watchlist

The flow is:

1. Roki observes market + watchlist
2. Denizen records suggestion text/rationale
3. Human user decides whether to act externally

## Schema Surfaces

Robinhood integration writes to these SQL tables via `src/intelligence/denizen-db.js`:

- `denizen_watchlist_symbols`
  - source of persisted watchlist symbols (`org_id`, `npc_key`, `symbol`, `added_at`)
- `denizen_trade_suggestions`
  - suggestion rows with status lifecycle (`pending`, `dismissed`, `acted`)

## Dual-Write JSON Pattern

v1.2 keeps local JSON as first-write + SQL sync:

- Local JSON files:
  - `data/roki-watchlist.json`
  - `data/trade-suggestions.json`
- SQL sync:
  - `syncWatchlistSymbol(...)` to `denizen_watchlist_symbols`
  - `upsertTradeSuggestion(...)` to `denizen_trade_suggestions`

Why this exists:

- Local resilience when DB is unavailable
- Backward compatibility with existing tooling
- Fast local bootstrap defaults

When to retire JSON dual-write:

- DB is guaranteed available in all target environments
- all reads are migrated to SQL-backed APIs
- legacy scripts depending on JSON files are removed
- migration validation confirms no state divergence

## API Reference

| Surface | Method + Path | Purpose | Auth requirement |
|---|---|---|---|
| OAuth connect | `GET /api/market/auth/connect` | Start Robinhood OAuth PKCE flow | Robinhood user login in browser |
| OAuth callback | `GET /api/market/auth/callback` | Complete token exchange | Redirect target from Robinhood |
| OAuth status | `GET /api/market/auth-status` | Check connection state | None (local session check) |
| Quote | `GET /api/market/quote?symbols=...` | Market quotes (Robinhood or free fallback) | Optional (works with fallback feed) |
| Watchlist read | `GET /api/market/watchlist` | Return current watchlist symbols | None |
| Watchlist add | `POST /api/market/watchlist` | Add symbol to watchlist | None |
| Trade suggestions list | `GET /api/trade-suggestions` | Read suggestion queue | None |
| Trade suggestion dismiss | `POST /api/trade-suggestions/:id/dismiss` | Mark suggestion dismissed | None |

## OAuth Preconditions

- `src/integrations/robinhood-mcp.js` configured for OAuth PKCE.
- `data/robinhood-oauth.json` has a `client_id` (token may be empty before first auth).
- Denizen server is running and reachable.
- This flow grants market-read access for Denizen's market observer.

## One-Time OAuth (Localhost)

1. Start Denizen locally (port `8080`).
2. Open `http://localhost:8080/api/market/auth/connect`.
3. Login to Robinhood and approve OAuth.
4. Confirm with `GET http://localhost:8080/api/market/auth-status` and verify `"authenticated": true`.
5. Optional smoke: `node apps/office/scripts/robinhood-live-smoke.js`.

## One-Time OAuth (Cloud)

1. Open `https://denizen.dolonia.cloud/api/market/auth/connect`.
2. Complete OAuth approval.
3. Validate: `https://denizen.dolonia.cloud/api/market/auth-status`.
4. Optional smoke from shell:
   - `$env:DENIZEN_URL='https://denizen.dolonia.cloud'`
   - `node apps/office/scripts/robinhood-live-smoke.js`

## Notes

- `ROBINHOOD_API_TOKEN` can override stored OAuth token for non-interactive runs.
- If unauthenticated, smoke script exits `0` and prints reconnect instructions.
- Quote fetching can fall back to free market data when Robinhood MCP access is unavailable.

## Related Integration Docs

- [MiroFish Prediction](MIROFISH_PREDICTION.md)
- [Federal Pipeline](FEDERAL_PIPELINE.md)
- [Job CRM](JOB_CRM.md)
- [Jelly Integration](JELLY_INTEGRATION.md)
- [Architecture](ARCHITECTURE.md)
- [Session Log 2026-06-05](SESSION_2026-06-05.md)

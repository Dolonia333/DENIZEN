# Naya Discord integration — 2026-07-15

## Integrated upstream commits

- `dd89b34` — Discord OAuth identity/link flow.
- `7925d5f` — smooth voice-channel movement, live layout rebuild, and auto-warp.
- `d38d23b` — avatar closet, layered sprite baking, bot commands, and map UI.

## Review fixes added before deployment

- Link-mode OAuth now requires a valid Denizen session and token before the
  redirect is created, and the callback derives identity ownership from that
  authenticated session instead of trusting URL identity values.
- Only Discord-verified email addresses participate in identity matching.
- OAuth refuses to run without a server-side signing key.
- Public avatar writes require the linked session owner; callers cannot edit a
  different Discord user ID.
- The localhost presence avatar API is read-only, preventing browser-based
  localhost writes.
- Anonymous PNG requests only bake avatars that have a saved custom profile,
  preventing unbounded default-avatar file creation.
- `jimp@0.22.10` is a pinned direct runtime dependency for the sprite baker.
- `ws` is upgraded to the patched 8.21 line.

## Verification

- `npm test`: 172 files, 1,234 tests, 0 failures.
- Focused Discord OAuth, avatar baking, and integration-security tests: 28
  tests, 0 failures.
- JavaScript syntax checks pass for every changed JavaScript file.
- `npm audit --omit=dev`: no high or critical findings. Seven moderate Jimp
  dependency findings remain without an upstream fix; avatar decoding is
  restricted to bundled project assets rather than user-uploaded images.

## Production requirements

1. Apply `supabase/migrations/20260715000001_discord_user_id_index.sql`.
2. Configure Discord client ID, client secret, bot token, guild settings, and a
   long random `DENIZEN_SESSION_SIGNING_KEY` in the ignored production env.
3. Register
   `https://<host>/api/visitor/auth/discord/callback` in the Discord Developer
   Portal.
4. Preserve `data/discord-avatars/` across container replacements.
5. Verify the main container and Discord presence service are healthy before
   promotion.

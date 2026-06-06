# Robinhood Live OAuth (Denizen / Roki)

This runbook enables live Robinhood MCP market connectivity for Roki without placing orders.

## Preconditions

- `denizen/src/robinhood-mcp.js` is configured for OAuth PKCE.
- `denizen/data/robinhood-oauth.json` has a `client_id` (no token needed yet).
- Denizen server is running and reachable.
- This flow only grants read-oriented market access used by Denizen's trading spine.

## One-Time OAuth (Localhost)

1. Start Denizen locally (port `8080`).
2. Open this URL in your browser:
   - `http://localhost:8080/api/market/auth/connect`
3. Log into Robinhood and approve OAuth.
4. After redirect, confirm:
   - `GET http://localhost:8080/api/market/auth-status`
   - Response should include `"authenticated": true`.
5. Run live smoke:
   - `node denizen/scripts/robinhood-live-smoke.js`

## One-Time OAuth (denizen.dolonia.cloud)

Production/cloud uses the same connect route on the deployed host:

1. Open:
   - `https://denizen.dolonia.cloud/api/market/auth/connect`
2. Complete Robinhood approval.
3. Validate status:
   - `https://denizen.dolonia.cloud/api/market/auth-status`
4. For smoke from a shell, set base URL and run:
   - PowerShell:
     - `$env:DENIZEN_URL='https://denizen.dolonia.cloud'`
     - `node denizen/scripts/robinhood-live-smoke.js`

## Notes

- Denizen does **not** place real orders. It writes watchlist updates and trade suggestions only.
- `ROBINHOOD_API_TOKEN` can be provided as an override for non-interactive runs.
- If unauthenticated, the smoke script exits `0` and prints the OAuth connect URL plus next-step instructions.

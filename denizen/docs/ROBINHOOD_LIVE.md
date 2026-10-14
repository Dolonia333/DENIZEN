# Robinhood Live OAuth (Denizen / Roki / Grok)

This runbook enables Robinhood MCP market connectivity for **Roki** and **Grok**.

## Modes

| Mode | How | What happens |
|------|-----|----------------|
| **Read-only (default)** | OAuth connected, `ROBINHOOD_LIVE_TRADING` unset/false | Quotes, portfolio, positions, order history, suggestions |
| **Paper** | `trade-suggest` buy/sell without live flag | Fills on Roki's fake ledger (`roki-paper-broker.js`) |
| **Live** | `ROBINHOOD_LIVE_TRADING=1` + MCP `place_equity_order` with `confirm=true` | Real Agentic-account equity orders via Robinhood `place_equity_order` |

Implementation: `src/robinhood-mcp.js`, `src/denizen-mcp-market-tools.js`.

## Live trading opt-in

Live orders are **off by default**. To allow Grok (or Roki) to trade through Denizen MCP:

1. Complete OAuth (below) so Denizen holds a Robinhood token.
2. On the Denizen host: `ROBINHOOD_LIVE_TRADING=1` (also accepts `true` / `yes` / `on`).
3. Mint an MCP token for **grok** with **Full** scope (includes `trade`), or explicitly grant `trade`.
4. From Grok MCP (`/mcp/npc/grok`):
   - Prefer `review_equity_order` first
   - Then `place_equity_order` with `symbol`, `side`, `quantity` or `amount`, and **`confirm: true`**

Example MCP args:

```json
{
  "symbol": "AAPL",
  "side": "buy",
  "amount": 25,
  "order_type": "market",
  "confirm": true
}
```

Without the env flag, `place_equity_order` returns an error and `trade-suggest` with `execute`/`liveTrade` stays blocked.

Robinhood may also require **Trade approvals** off in the Agentic account Agent settings for unattended fills — see [Trading with your agent](https://robinhood.com/us/en/support/articles/trading-with-your-agent/).

## Grok Integration

Grok is a market NPC alongside Roki:

- Market tools on `/mcp/npc/grok` (same set as Roki)
- Skills: `market-watch`, `get-quote`, `trade-suggest`
- Live path: Denizen MCP → `robinhood-mcp.placeEquityOrder` → Robinhood MCP `place_equity_order`

See [GROK_DENIZEN_AUTONOMY.md](GROK_DENIZEN_AUTONOMY.md).

## Roki Integration

Roki remains the default office market watcher:

- watchlist persistence defaults to `npc_key = roki`
- paper ledger for suggested buy/sell when live is off
- same MCP market tools when using `/mcp/npc/roki`

## Schema Surfaces

Robinhood integration writes to these SQL tables via `src/denizen-db.js`:

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

## MCP market tools (Roki + Grok)

| Tool | Scope | Notes |
|------|-------|-------|
| `get_market_quote` | `read` | Robinhood or free feed |
| `get_market_portfolio` | `read` | Requires OAuth |
| `get_market_positions` | `read` | Requires OAuth |
| `get_equity_orders` | `read` | Requires OAuth |
| `market_watch` | `read` | Watchlist observation |
| `list_trade_suggestions` | `read` | Local suggestion queue |
| `get_watchlist` | `read` | Symbols |
| `review_equity_order` | `read` | Simulate / pre-trade warnings |
| `place_equity_order` | `trade` | Live; needs `ROBINHOOD_LIVE_TRADING=1` + `confirm=true` |

## OAuth Preconditions

- `src/robinhood-mcp.js` configured for OAuth PKCE.
- `data/robinhood-oauth.json` has a `client_id` (token may be empty before first auth).
- Denizen server is running and reachable.

## One-Time OAuth (Localhost)

1. Start Denizen locally (port `8080`).
2. Open `http://localhost:8080/api/market/auth/connect`.
3. Login to Robinhood and approve OAuth.
4. Confirm with `GET http://localhost:8080/api/market/auth-status` and verify `"authenticated": true`.
5. Optional smoke: `node denizen/scripts/robinhood-live-smoke.js`.

## One-Time OAuth (Cloud)

1. Open `https://denizen.dolonia.cloud/api/market/auth/connect`.
2. Complete OAuth approval.
3. Validate: `https://denizen.dolonia.cloud/api/market/auth-status`.
4. Optional smoke from shell:
   - `$env:DENIZEN_URL='https://denizen.dolonia.cloud'`
   - `node denizen/scripts/robinhood-live-smoke.js`

## Notes

- `ROBINHOOD_API_TOKEN` can override stored OAuth token for non-interactive runs.
- `ROBINHOOD_LIVE_TRADING` must be set on the **server** process — not in the Grok client alone.
- If unauthenticated, smoke script exits `0` and prints reconnect instructions.
- Quote fetching can fall back to free market data when Robinhood MCP access is unavailable.

## Related Integration Docs

- [Grok Denizen Autonomy](GROK_DENIZEN_AUTONOMY.md)
- [NPC MCP Gateway](NPC_MCP_GATEWAY.md)
- [MiroFish Prediction](MIROFISH_PREDICTION.md)
- [Jelly Integration](JELLY_INTEGRATION.md)

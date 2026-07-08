# MiroFish Prediction Integration (v1.2)

MiroFish is Denizen's external forecasting service for intake conversion, lead close probability, and federal bid probability.

This integration is optional and non-blocking: when MiroFish is unavailable, Denizen falls back to built-in heuristics so prediction writes keep flowing.

## Configuration

- `MIROFISH_ENABLED`
  - Enables remote MiroFish forecasting when truthy.
  - If unset or falsey (`0`, `false`, `no`, `off`), Denizen uses heuristic fallback only.
- `MIROFISH_BASE_URL`
  - Base URL for MiroFish.
  - Defaults to `http://localhost:5001`.

Config parsing lives in `src/intelligence/mirofish-prediction.js` via `getConfig()`.

## API Endpoints

These routes are exposed by `src/routes/intelligence-routes.js`:

- `GET /api/intelligence/mirofish-status`
  - Returns `{ ok, enabled, baseUrl, available }`
  - `available` performs health checks against `GET /api/health` and `GET /health` on the configured MiroFish base URL.
- `POST /api/intelligence/mirofish-sync`
  - Triggers sync maintenance (`runMiroFishMaintenance`) for the current org.
  - Returns `503` when the Denizen DB intelligence layer is unavailable.

## Fallback Behavior (Heuristic Mode)

If either of these is true, Denizen uses heuristics:

- `MIROFISH_ENABLED` is false/off.
- MiroFish is enabled but health checks or forecast requests fail/time out.

Fallback behavior is implemented in `_heuristicFallback()` and tagged with:

- `modelKey: "heuristic_v0"`
- `metadata.source: "mirofish_fallback"`
- `metadata.fallback_reason: "mirofish_unavailable"`

Heuristics vary by entity type:

- `intake`: priority score, budget range, service category, recommended tier
- `lead`: status, source, company
- `rfp`: value range, requirement count, set-aside type, due date window

## Prediction Persistence

Forecasts are normalized and written to `denizen_predictions` through `recordPrediction()` in `src/intelligence/denizen-prediction-loop.js`.

MiroFish-backed records use:

- `model_key = "mirofish_v1"`
- `model_version = <service version or default "1.0.0">`
- `prediction_type`:
  - `intake.close_probability`
  - `lead.close_probability`
  - `rfp.bid_probability`
- `entity_type`:
  - `intake_form` for intake entities
  - `lead` for leads
  - `rfp` for federal opportunities

Sync logic avoids duplicate noise by skipping entities with recent (`24h`) `mirofish_v1` predictions.

## Current and Future Runtime

- Current expected host pattern: external or local service defined by `MIROFISH_BASE_URL`
- Future default target: run MiroFish locally at `http://localhost:5001` for dev/staging parity

## Related Integration Docs

- [Federal Pipeline](FEDERAL_PIPELINE.md)
- [Job CRM](JOB_CRM.md)
- [Robinhood Live](ROBINHOOD_LIVE.md)
- [Jelly Integration](JELLY_INTEGRATION.md)
- [Architecture](ARCHITECTURE.md)
- [Session Log 2026-06-05](SESSION_2026-06-05.md)

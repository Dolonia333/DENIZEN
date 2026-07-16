# Dolonia conversation data (Denizen = product #1)

Dolonia is building a **data company**. Denizen is the first product that *emits* quality conversation intelligence so AI can talk to different people better — and so Dolonia owns a durable, multi-product warehouse.

## Mental model

```text
Discord / office chats
    → privacy pass (hash user, redact secrets)
    → local hot cache (files)
    → quality score (0–1)
    → Supabase warehouse (dolonia_conv_*)
    → adaptive replies + future data products
```

| Layer | Role |
|-------|------|
| **Product** | `product_key = denizen` (first); more products later |
| **Local files** | Fast sense/theme cache under `data/` |
| **Warehouse** | Supabase tables `dolonia_conv_*` |
| **Quality gate** | `quality_score` + `is_quality` (≥ 0.45) |

## Tables

| Table | Purpose |
|-------|---------|
| `dolonia_products` | Product catalog |
| `dolonia_conv_events` | Append-only scored events |
| `dolonia_conv_person_styles` | Hashed person style profiles |
| `dolonia_conv_communities` | Guild / community voice |
| `dolonia_conv_themes` | Topic rollups |
| `dolonia_conv_quality_daily` | Daily aggregates for dashboards |

Migration: `supabase/migrations/20260716000001_dolonia_conversation_data.sql`

## APIs

- `GET /api/dolonia/conversation-quality` — warehouse + local scorecard  
- `GET /api/data/conversation-quality` — alias  
- `POST /api/dolonia/conversation-retain` — purge events older than keep days (default 90)

## Env

```bash
SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=...
DOLONIA_DATA=1                 # default on when URL set
DOLONIA_PRODUCT_KEY=denizen
DOLONIA_CONV_KEEP_DAYS=90
```

## Privacy

- **Never** store raw Discord user snowflakes in warehouse (`user_hash` only)
- Bodies optional + redacted upstream
- RLS: `service_role` write; authenticated can read daily quality + products only

## Discord UX

`,sense` — styles, themes, warehouse status  
`,sense me` / `,sense types` / `,sense topics`

## Next products

Add a row to `dolonia_products` and dual-write with a new `product_key`. Same schema, same quality pipeline.

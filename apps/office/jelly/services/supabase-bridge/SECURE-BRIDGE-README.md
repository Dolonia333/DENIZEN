# Secure Supabase Bridge

A secure HTTP bridge connecting the OpenClaw agent to a local Supabase instance. Zero pip dependencies (Python 3.12+ stdlib only).

## Architecture

```
Agent (curl via bash tool)
  |  HTTP + Bearer AGENT_TOKEN
  v
secure-bridge.py (127.0.0.1:18790)
  |  validates: token, table whitelist, JSON schema
  |  translates: PostgREST query params
  v
Supabase PostgREST (192.168.1.237:8000/rest/v1/...)
```

## Quick Start

### 1. Run the SQL schema

Open your Supabase dashboard at `http://192.168.1.237:8000`, go to the SQL Editor, and paste the contents of `rfp-schema-secure.sql`. Click Run.

This creates three tables: `documents`, `key_value`, `logs` with RLS enabled.

### 2. Configure the bridge

```bash
cd supabase-bridge
cp .env.secure.template .env.secure
```

Edit `.env.secure`:
- Set `SUPABASE_ANON_KEY` to your Supabase anon key (NOT the service role key)
- Generate a strong token: `python -c "import secrets; print(secrets.token_urlsafe(32))"`
- Set `AGENT_TOKEN` to the generated value

### 3. Start the bridge

```bash
python secure-bridge.py
```

Or with the project venv:
```bash
..\.venv\Scripts\python.exe secure-bridge.py
```

### 4. Test it

```bash
curl http://localhost:18790/health -H "Authorization: Bearer YOUR_TOKEN"
```

### 5. Set AGENT_TOKEN for the OpenClaw agent

The agent needs the same `AGENT_TOKEN` in its environment so the `supabase-bridge` skill can authenticate. Set it in the gateway's shell environment before starting.

## API Reference

All endpoints require `Authorization: Bearer <AGENT_TOKEN>`.

### GET /health

Returns bridge status and Supabase reachability.

### GET /tables

Returns the list of whitelisted tables.

### POST /query

Read data from a table.

```json
{
  "table": "documents",
  "select": ["id", "title", "category"],
  "filters": {"category": {"eq": "notes"}},
  "order": {"created_at": "desc"},
  "limit": 10
}
```

### POST /insert

Insert rows (max 100 per call).

```json
{
  "table": "documents",
  "rows": [
    {"title": "Meeting Notes", "category": "notes", "data": {"content": "..."}}
  ]
}
```

### POST /update

Update rows. Filters required (prevents accidental mass update).

```json
{
  "table": "documents",
  "filters": {"id": {"eq": "uuid-here"}},
  "data": {"title": "Updated Title"}
}
```

### POST /delete

Delete rows. Filters required.

```json
{
  "table": "documents",
  "filters": {"id": {"eq": "uuid-here"}}
}
```

## Security Model

| Layer | Protection |
|-------|-----------|
| Network | Binds to 127.0.0.1 only |
| Auth | Bearer token, timing-safe comparison |
| Tables | Whitelist enforced (configurable) |
| Operators | Only eq/neq/gt/gte/lt/lte/like/ilike/is/in |
| SQL | No raw SQL — PostgREST REST API only |
| Writes | UPDATE/DELETE require non-empty filters |
| Limits | Max 100 rows insert, 1000 query results |
| Database | Postgres RLS enabled on all tables |

## CLI Mode

One-off operations without the server running (requires server to be running separately):

```bash
python secure-bridge.py --cli health
python secure-bridge.py --cli tables
python secure-bridge.py --cli query documents
python secure-bridge.py --cli insert documents '{"title":"test"}'
python secure-bridge.py --cli update documents '{"id":{"eq":"uuid"}}' '{"title":"new"}'
python secure-bridge.py --cli delete documents '{"id":{"eq":"uuid"}}'
```

## Troubleshooting

**"AGENT_TOKEN is not set"** — Create `.env.secure` from the template and fill in all required values.

**"Supabase not reachable"** — Check that Supabase is running at the configured URL. Try `curl http://192.168.1.237:8000/rest/v1/` manually.

**403 "Table not allowed"** — The table isn't in `ALLOWED_TABLES`. Edit `.env.secure` to add it.

**401 "Unauthorized"** — The Bearer token doesn't match `AGENT_TOKEN` in `.env.secure`.

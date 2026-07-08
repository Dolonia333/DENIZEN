---
name: supabase-bridge
description: "Read and write data to a local Supabase database via the secure bridge proxy. Use for storing documents, key-value pairs, and activity logs."
metadata: {"openclaw":{"emoji":"DB","requires":{"bins":["curl"],"env":["AGENT_TOKEN"]},"primaryEnv":"AGENT_TOKEN"}}
---

# Supabase Bridge

Secure proxy to a local Supabase/PostgreSQL database. All requests go through `http://localhost:18790` with Bearer token auth.

## Health check

```bash
curl -s http://localhost:18790/health \
  -H "Authorization: Bearer $AGENT_TOKEN"
```

## List tables

```bash
curl -s http://localhost:18790/tables \
  -H "Authorization: Bearer $AGENT_TOKEN"
```

## Query (read rows)

```bash
curl -s -X POST http://localhost:18790/query \
  -H "Authorization: Bearer $AGENT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "table": "documents",
    "select": ["id", "title", "category", "data"],
    "filters": {"category": {"eq": "notes"}},
    "order": {"created_at": "desc"},
    "limit": 10
  }'
```

Filters use `{column: {operator: value}}`. Operators: `eq`, `neq`, `gt`, `gte`, `lt`, `lte`, `like`, `ilike`, `is`, `in`.

For `in`, pass a list: `{"id": {"in": ["uuid1", "uuid2"]}}`.

Omit `filters` to get all rows. Omit `select` to get all columns.

## Insert rows

```bash
curl -s -X POST http://localhost:18790/insert \
  -H "Authorization: Bearer $AGENT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "table": "documents",
    "rows": [
      {"title": "Meeting Notes", "category": "notes", "data": {"content": "discussed Q2 goals"}}
    ]
  }'
```

Max 100 rows per call. Returns inserted rows with generated IDs.

## Update rows

```bash
curl -s -X POST http://localhost:18790/update \
  -H "Authorization: Bearer $AGENT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "table": "documents",
    "filters": {"id": {"eq": "some-uuid"}},
    "data": {"title": "Updated Title"}
  }'
```

Filters are required (prevents accidental mass updates).

## Delete rows

```bash
curl -s -X POST http://localhost:18790/delete \
  -H "Authorization: Bearer $AGENT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "table": "documents",
    "filters": {"id": {"eq": "some-uuid"}}
  }'
```

Filters are required.

## Key-value storage

Set a key:
```bash
curl -s -X POST http://localhost:18790/insert \
  -H "Authorization: Bearer $AGENT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"table": "key_value", "rows": [{"key": "user_prefs", "value": {"theme": "dark"}}]}'
```

Get a key:
```bash
curl -s -X POST http://localhost:18790/query \
  -H "Authorization: Bearer $AGENT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"table": "key_value", "filters": {"key": {"eq": "user_prefs"}}}'
```

## Log an event

```bash
curl -s -X POST http://localhost:18790/insert \
  -H "Authorization: Bearer $AGENT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"table": "logs", "rows": [{"event": "task_completed", "level": "info", "detail": {"task": "summarize email"}}]}'
```

Logs are append-only (no update/delete).

## Tables

| Table | Purpose | Key columns |
|-------|---------|-------------|
| `documents` | Structured data | id (UUID), title, category, data (JSON), tags |
| `key_value` | Simple KV store | key (TEXT), value (JSON) |
| `logs` | Activity log | event, level (debug/info/warn/error), detail (JSON) |

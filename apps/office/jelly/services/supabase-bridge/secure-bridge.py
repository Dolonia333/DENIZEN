#!/usr/bin/env python3
"""
Secure HTTP bridge between OpenClaw agent and a local Supabase instance.

Uses Python stdlib only (zero pip dependencies).
Proxies validated requests to Supabase PostgREST, enforcing:
  - Bearer token auth on every request
  - Table whitelist
  - Operator whitelist
  - JSON schema validation
  - Required filters on UPDATE/DELETE
  - Row limits

Usage:
  python secure-bridge.py                              # start server
  python secure-bridge.py --port 18790                 # custom port
  python secure-bridge.py --cli health                 # CLI: health check
  python secure-bridge.py --cli query documents        # CLI: query table
  python secure-bridge.py --cli insert documents '{"title":"test"}'
"""

import hmac
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from http.server import HTTPServer, BaseHTTPRequestHandler
from pathlib import Path
from threading import Thread
from datetime import datetime, timezone

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

VERSION = "1.0.0"

ALLOWED_OPERATORS = frozenset(
    ["eq", "neq", "gt", "gte", "lt", "lte", "like", "ilike", "is", "in"]
)

MAX_INSERT_ROWS = 100
MAX_QUERY_LIMIT = 1000
DEFAULT_QUERY_LIMIT = 100


def load_env_file(path: str) -> dict[str, str]:
    """Load KEY=VALUE pairs from a file, ignoring comments and blanks."""
    env: dict[str, str] = {}
    try:
        with open(path) as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#"):
                    continue
                key, _, value = line.partition("=")
                if _:
                    env[key.strip()] = value.strip()
    except FileNotFoundError:
        pass
    return env


def get_config() -> dict[str, str]:
    """Build config from .env.secure file + OS environment (OS wins)."""
    bridge_dir = Path(__file__).resolve().parent
    file_env = load_env_file(str(bridge_dir / ".env.secure"))
    # OS env overrides file
    for key in list(file_env.keys()):
        if key in os.environ:
            file_env[key] = os.environ[key]
    # Also pull keys only in OS env
    for key in [
        "SUPABASE_URL",
        "SUPABASE_ANON_KEY",
        "AGENT_TOKEN",
        "BRIDGE_HOST",
        "BRIDGE_PORT",
        "ALLOWED_TABLES",
        "LOG_LEVEL",
        "LOG_TO_SUPABASE",
    ]:
        if key in os.environ and key not in file_env:
            file_env[key] = os.environ[key]
    return file_env


CFG = get_config()

SUPABASE_URL = CFG.get("SUPABASE_URL", "").rstrip("/")
SUPABASE_ANON_KEY = CFG.get("SUPABASE_ANON_KEY", "")
AGENT_TOKEN = CFG.get("AGENT_TOKEN", "")
BRIDGE_HOST = CFG.get("BRIDGE_HOST", "127.0.0.1")
BRIDGE_PORT = int(CFG.get("BRIDGE_PORT", "18790"))
ALLOWED_TABLES = frozenset(
    t.strip() for t in CFG.get("ALLOWED_TABLES", "documents,key_value,logs").split(",") if t.strip()
)
DEMO_ORG_SLUG = CFG.get("DEMO_ORG_SLUG", "acme").strip().lower()
DEMO_BLOCKED_TABLES = frozenset(
    t.strip()
    for t in CFG.get(
        "DEMO_BLOCKED_TABLES",
        "intake_forms,leads,clients,rfps,rfp_documents,rfp_requirements,"
        "proposal_outlines,past_performance,workflow_runs,rfp_comments,"
        "denizen_intake_funnel,denizen_rfp_velocity",
    ).split(",")
    if t.strip()
)
LOG_LEVEL = CFG.get("LOG_LEVEL", "INFO").upper()

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def log(level: str, msg: str) -> None:
    levels = {"DEBUG": 0, "INFO": 1, "WARN": 2, "ERROR": 3}
    if levels.get(level, 1) >= levels.get(LOG_LEVEL, 1):
        ts = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        print(f"[{ts}] [{level}] {msg}", file=sys.stderr)


def check_auth(headers) -> bool:
    """Timing-safe Bearer token check."""
    if not AGENT_TOKEN:
        return False
    auth = headers.get("Authorization", "")
    if not auth.lower().startswith("bearer "):
        return False
    token = auth[7:].strip()
    return hmac.compare_digest(token, AGENT_TOKEN)


def validate_table(table: str) -> bool:
    return isinstance(table, str) and table in ALLOWED_TABLES


def org_slug_from_headers(headers) -> str:
    return (headers.get("X-Org-Slug") or headers.get("x-org-slug") or "").strip().lower()


def validate_org_table(headers, table: str) -> str | None:
    """Return error message when demo org requests a blocked business table."""
    slug = org_slug_from_headers(headers)
    if slug == DEMO_ORG_SLUG and table in DEMO_BLOCKED_TABLES:
        return f"Table '{table}' blocked for demo org '{slug}'"
    return None


def build_filters(filters: dict) -> list[str]:
    """Translate {column: {op: value}} to PostgREST query params."""
    params = []
    for col, ops in filters.items():
        if not isinstance(col, str) or not col.isidentifier():
            continue
        if not isinstance(ops, dict):
            continue
        for op, val in ops.items():
            if op not in ALLOWED_OPERATORS:
                continue
            # For 'in' operator, value should be a list → "(v1,v2,v3)"
            if op == "in" and isinstance(val, list):
                val = "(" + ",".join(str(v) for v in val) + ")"
            params.append(f"{col}={op}.{val}")
    return params


def call_postgrest(
    method: str,
    path: str,
    query_params: list[str] | None = None,
    body: str | None = None,
    extra_headers: dict[str, str] | None = None,
) -> tuple[int, dict | list | str]:
    """Send a request to Supabase PostgREST and return (status, parsed_json)."""
    url = f"{SUPABASE_URL}/rest/v1/{path}"
    if query_params:
        url += "?" + "&".join(query_params)

    headers = {
        "apikey": SUPABASE_ANON_KEY,
        "Authorization": f"Bearer {SUPABASE_ANON_KEY}",
        "Content-Type": "application/json",
    }
    if extra_headers:
        headers.update(extra_headers)

    data = body.encode("utf-8") if body else None
    req = urllib.request.Request(url, data=data, headers=headers, method=method)

    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            raw = resp.read().decode("utf-8")
            try:
                parsed = json.loads(raw) if raw else []
            except json.JSONDecodeError:
                parsed = raw
            return resp.status, parsed
    except urllib.error.HTTPError as e:
        raw = e.read().decode("utf-8", errors="replace")
        try:
            parsed = json.loads(raw)
        except json.JSONDecodeError:
            parsed = {"error": raw}
        return e.code, parsed
    except Exception as e:
        return 502, {"error": str(e)}


# ---------------------------------------------------------------------------
# Request handler
# ---------------------------------------------------------------------------


class BridgeHandler(BaseHTTPRequestHandler):
    """HTTP request handler for the secure bridge."""

    def log_message(self, fmt, *args):
        log("INFO", f"{self.address_string()} {fmt % args}")

    # ---- auth + body helpers ----

    def _require_auth(self) -> bool:
        if not check_auth(self.headers):
            self._json_response(401, {"error": "Unauthorized"})
            return False
        return True

    def _read_json(self) -> dict | None:
        length = int(self.headers.get("Content-Length", 0))
        if length == 0:
            self._json_response(400, {"error": "Empty request body"})
            return None
        if length > 1_048_576:  # 1 MB limit
            self._json_response(413, {"error": "Body too large"})
            return None
        try:
            raw = self.rfile.read(length)
            return json.loads(raw)
        except json.JSONDecodeError:
            self._json_response(400, {"error": "Invalid JSON"})
            return None

    def _json_response(self, status: int, data) -> None:
        body = json.dumps(data, default=str).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    # ---- routing ----

    def do_GET(self):
        path = self.path.split("?")[0].rstrip("/")
        if not self._require_auth():
            return
        if path == "/health":
            self._handle_health()
        elif path == "/tables":
            self._handle_tables()
        else:
            self._json_response(404, {"error": "Not found"})

    def do_POST(self):
        path = self.path.split("?")[0].rstrip("/")
        if not self._require_auth():
            return
        body = self._read_json()
        if body is None:
            return
        if path == "/query":
            self._handle_query(body)
        elif path == "/insert":
            self._handle_insert(body)
        elif path == "/update":
            self._handle_update(body)
        elif path == "/delete":
            self._handle_delete(body)
        else:
            self._json_response(404, {"error": "Not found"})

    # ---- endpoint handlers ----

    def _handle_health(self):
        # Quick reachability check
        status, result = call_postgrest("GET", "")
        reachable = status < 500
        self._json_response(
            200 if reachable else 503,
            {
                "status": "ok" if reachable else "degraded",
                "bridge_version": VERSION,
                "supabase_reachable": reachable,
                "tables": sorted(ALLOWED_TABLES),
            },
        )

    def _handle_tables(self):
        self._json_response(200, {"tables": sorted(ALLOWED_TABLES)})

    def _handle_query(self, body: dict):
        # Validate
        table = body.get("table")
        if not table or not isinstance(table, str):
            self._json_response(400, {"error": "Missing or invalid 'table'"})
            return
        if not validate_table(table):
            self._json_response(403, {"error": f"Table '{table}' not allowed"})
            return
        org_err = validate_org_table(self.headers, table)
        if org_err:
            self._json_response(403, {"error": org_err})
            return

        select = body.get("select", ["*"])
        if not isinstance(select, list):
            self._json_response(400, {"error": "'select' must be a list"})
            return

        limit = body.get("limit", DEFAULT_QUERY_LIMIT)
        if not isinstance(limit, int) or limit < 1:
            limit = DEFAULT_QUERY_LIMIT
        limit = min(limit, MAX_QUERY_LIMIT)

        offset = body.get("offset", 0)
        if not isinstance(offset, int) or offset < 0:
            offset = 0

        # Build query params
        params = [f"select={','.join(select)}"]

        filters = body.get("filters", {})
        if isinstance(filters, dict):
            params.extend(build_filters(filters))

        order = body.get("order", {})
        if isinstance(order, dict):
            for col, direction in order.items():
                if isinstance(col, str) and col.isidentifier() and direction in ("asc", "desc"):
                    params.append(f"order={col}.{direction}")

        params.append(f"limit={limit}")
        if offset > 0:
            params.append(f"offset={offset}")

        status, result = call_postgrest("GET", table, params, extra_headers={"Prefer": "count=exact"})
        self._json_response(status, {"data": result, "count": len(result) if isinstance(result, list) else 0})

    def _handle_insert(self, body: dict):
        table = body.get("table")
        if not table or not isinstance(table, str):
            self._json_response(400, {"error": "Missing or invalid 'table'"})
            return
        if not validate_table(table):
            self._json_response(403, {"error": f"Table '{table}' not allowed"})
            return
        org_err = validate_org_table(self.headers, table)
        if org_err:
            self._json_response(403, {"error": org_err})
            return

        rows = body.get("rows")
        if not isinstance(rows, list) or len(rows) == 0:
            self._json_response(400, {"error": "'rows' must be a non-empty list"})
            return
        if len(rows) > MAX_INSERT_ROWS:
            self._json_response(400, {"error": f"Max {MAX_INSERT_ROWS} rows per insert"})
            return
        if not all(isinstance(r, dict) for r in rows):
            self._json_response(400, {"error": "Each row must be an object"})
            return

        status, result = call_postgrest(
            "POST",
            table,
            body=json.dumps(rows),
            extra_headers={"Prefer": "return=representation"},
        )
        resp_status = 201 if status < 300 else status
        self._json_response(
            resp_status,
            {"data": result, "count": len(result) if isinstance(result, list) else 0},
        )

    def _handle_update(self, body: dict):
        table = body.get("table")
        if not table or not isinstance(table, str):
            self._json_response(400, {"error": "Missing or invalid 'table'"})
            return
        if not validate_table(table):
            self._json_response(403, {"error": f"Table '{table}' not allowed"})
            return
        org_err = validate_org_table(self.headers, table)
        if org_err:
            self._json_response(403, {"error": org_err})
            return

        filters = body.get("filters", {})
        if not isinstance(filters, dict) or len(filters) == 0:
            self._json_response(400, {"error": "'filters' required and must not be empty for UPDATE"})
            return

        data = body.get("data", {})
        if not isinstance(data, dict) or len(data) == 0:
            self._json_response(400, {"error": "'data' required and must not be empty"})
            return

        params = build_filters(filters)
        if not params:
            self._json_response(400, {"error": "No valid filters produced"})
            return

        status, result = call_postgrest(
            "PATCH",
            table,
            params,
            body=json.dumps(data),
            extra_headers={"Prefer": "return=representation"},
        )
        self._json_response(
            status,
            {"data": result, "count": len(result) if isinstance(result, list) else 0},
        )

    def _handle_delete(self, body: dict):
        table = body.get("table")
        if not table or not isinstance(table, str):
            self._json_response(400, {"error": "Missing or invalid 'table'"})
            return
        if not validate_table(table):
            self._json_response(403, {"error": f"Table '{table}' not allowed"})
            return
        org_err = validate_org_table(self.headers, table)
        if org_err:
            self._json_response(403, {"error": org_err})
            return

        filters = body.get("filters", {})
        if not isinstance(filters, dict) or len(filters) == 0:
            self._json_response(400, {"error": "'filters' required and must not be empty for DELETE"})
            return

        params = build_filters(filters)
        if not params:
            self._json_response(400, {"error": "No valid filters produced"})
            return

        status, result = call_postgrest(
            "DELETE",
            table,
            params,
            extra_headers={"Prefer": "return=representation"},
        )
        self._json_response(
            status,
            {"data": result, "count": len(result) if isinstance(result, list) else 0},
        )


# ---------------------------------------------------------------------------
# CLI mode
# ---------------------------------------------------------------------------


def cli_main(args: list[str]) -> None:
    """Simple CLI for one-off operations."""
    if not args:
        print("Usage: secure-bridge.py --cli <command> [table] [json-data]")
        print("Commands: health, tables, query, insert, update, delete")
        sys.exit(1)

    cmd = args[0]
    headers = {"Authorization": f"Bearer {AGENT_TOKEN}", "Content-Type": "application/json"}
    base = f"http://{BRIDGE_HOST}:{BRIDGE_PORT}"

    if cmd == "health":
        req = urllib.request.Request(f"{base}/health", headers=headers)
    elif cmd == "tables":
        req = urllib.request.Request(f"{base}/tables", headers=headers)
    elif cmd in ("query", "insert", "update", "delete"):
        if len(args) < 2:
            print(f"Usage: --cli {cmd} <table> [json-body]")
            sys.exit(1)
        table = args[1]
        if cmd == "query":
            body_data = {"table": table}
            if len(args) > 2:
                body_data["filters"] = json.loads(args[2])
        elif cmd == "insert":
            if len(args) < 3:
                print("Usage: --cli insert <table> '<json-row>'")
                sys.exit(1)
            row = json.loads(args[2])
            body_data = {"table": table, "rows": [row] if isinstance(row, dict) else row}
        elif cmd == "update":
            if len(args) < 4:
                print("Usage: --cli update <table> '<filters-json>' '<data-json>'")
                sys.exit(1)
            body_data = {"table": table, "filters": json.loads(args[2]), "data": json.loads(args[3])}
        elif cmd == "delete":
            if len(args) < 3:
                print("Usage: --cli delete <table> '<filters-json>'")
                sys.exit(1)
            body_data = {"table": table, "filters": json.loads(args[2])}
        body = json.dumps(body_data).encode("utf-8")
        req = urllib.request.Request(f"{base}/{cmd}", data=body, headers=headers, method="POST")
    else:
        print(f"Unknown command: {cmd}")
        sys.exit(1)

    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            print(json.dumps(json.loads(resp.read()), indent=2))
    except urllib.error.HTTPError as e:
        print(f"HTTP {e.code}:", file=sys.stderr)
        print(e.read().decode("utf-8", errors="replace"))
        sys.exit(1)
    except urllib.error.URLError as e:
        print(f"Connection error: {e.reason}", file=sys.stderr)
        print(f"Is the bridge running at {base}?", file=sys.stderr)
        sys.exit(1)


# ---------------------------------------------------------------------------
# Server startup
# ---------------------------------------------------------------------------


def check_prerequisites() -> list[str]:
    """Return a list of issues, empty if all good."""
    issues = []
    if not SUPABASE_URL:
        issues.append("SUPABASE_URL is not set")
    if not SUPABASE_ANON_KEY:
        issues.append("SUPABASE_ANON_KEY is not set")
    if not AGENT_TOKEN:
        issues.append("AGENT_TOKEN is not set")
    if len(AGENT_TOKEN) < 16:
        issues.append("AGENT_TOKEN is too short (min 16 chars)")
    return issues


def run_server(host: str, port: int) -> None:
    issues = check_prerequisites()
    if issues:
        for i in issues:
            log("ERROR", i)
        log("ERROR", "Fix the above and restart. See .env.secure.template.")
        sys.exit(1)

    # Test Supabase connectivity
    log("INFO", f"Testing Supabase at {SUPABASE_URL} ...")
    status, _ = call_postgrest("GET", "")
    if status >= 500:
        log("WARN", f"Supabase not reachable (HTTP {status}). Starting in degraded mode.")
    else:
        log("INFO", "Supabase reachable.")

    server = HTTPServer((host, port), BridgeHandler)
    log("INFO", f"Secure bridge v{VERSION} listening on http://{host}:{port}")
    log("INFO", f"Tables: {', '.join(sorted(ALLOWED_TABLES))}")
    log("INFO", f"Supabase: {SUPABASE_URL}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        log("INFO", "Shutting down.")
        server.shutdown()


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    args = sys.argv[1:]

    # Parse --cli mode
    if "--cli" in args:
        idx = args.index("--cli")
        cli_args = args[idx + 1 :]
        cli_main(cli_args)
        sys.exit(0)

    # Parse --port
    host = BRIDGE_HOST
    port = BRIDGE_PORT
    if "--port" in args:
        idx = args.index("--port")
        if idx + 1 < len(args):
            port = int(args[idx + 1])
    if "--host" in args:
        idx = args.index("--host")
        if idx + 1 < len(args):
            host = args[idx + 1]

    if "--server" in args or not args or args == []:
        run_server(host, port)
    else:
        run_server(host, port)

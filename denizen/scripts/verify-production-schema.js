'use strict';

const { spawnSync } = require('node:child_process');

const requiredTables = [
  'denizen_schema_migrations',
  'denizen_job_applications',
  'denizen_watchlist_symbols',
  'denizen_trade_suggestions',
  'denizen_mcp_tokens',
];

function getBaseUrl() {
  const value = (process.env.SUPABASE_URL || '').trim();
  if (!value) {
    throw new Error('SUPABASE_URL is required for REST schema checks.');
  }
  return value.replace(/\/+$/, '');
}

function getApiKey() {
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || '').trim();
  if (!key) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY or SUPABASE_ANON_KEY is required for REST schema checks.');
  }
  return key;
}

async function headTable(baseUrl, apiKey, table) {
  const column = table === 'denizen_schema_migrations' ? 'version' : 'id';
  const encoded = encodeURIComponent(column);
  const url = `${baseUrl}/rest/v1/${table}?select=${encoded}&limit=1`;
  const response = await fetch(url, {
    method: 'HEAD',
    headers: {
      apikey: apiKey,
      Authorization: `Bearer ${apiKey}`,
      Prefer: 'count=exact',
    },
  });

  return {
    name: `rest_head_${table}`,
    status: response.ok ? 'PASS' : 'FAIL',
    detail: {
      table,
      url,
      statusCode: response.status,
      contentRange: response.headers.get('content-range'),
    },
  };
}

function runOptionalDbVerification(dbUrl) {
  if (!dbUrl) {
    return {
      name: 'db_function_and_tables',
      status: 'SKIP',
      detail: { reason: 'SUPABASE_DB_URL not set; skipping optional DB verification.' },
    };
  }

  const sql = [
    'select json_build_object(',
    "'denizen_user_can_access_org_exists', exists (",
    "  select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace",
    "  where n.nspname = 'public' and p.proname = 'denizen_user_can_access_org'",
    '),',
    "'denizen_resolve_mcp_token_exists', exists (",
    "  select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace",
    "  where n.nspname = 'public' and p.proname = 'denizen_resolve_mcp_token'",
    '),',
    "'mcp_rpc_search_path_ok', (",
    "  select coalesce(",
    "    (select 'extensions' = any(string_to_array(",
    "      replace(replace(proconfig[1], 'search_path=', ''), ' ', ''), ','",
    "    )) from pg_proc p join pg_namespace n on n.oid = p.pronamespace",
    "    where n.nspname = 'public' and p.proname = 'denizen_resolve_mcp_token' and proconfig is not null),",
    "    false)",
    '),',
    "'trading_tables', json_build_object(",
    "'denizen_watchlist_symbols', to_regclass('public.denizen_watchlist_symbols') is not null,",
    "'denizen_trade_suggestions', to_regclass('public.denizen_trade_suggestions') is not null",
    ')',
    ')::text;',
  ].join(' ');

  const psqlResult = spawnSync(
    'psql',
    [dbUrl, '-t', '-A', '-v', 'ON_ERROR_STOP=1', '-c', sql],
    { encoding: 'utf8' },
  );

  if (psqlResult.error) {
    return {
      name: 'db_function_and_tables',
      status: 'SKIP',
      detail: { reason: `psql unavailable: ${psqlResult.error.message}` },
    };
  }

  if (psqlResult.status !== 0) {
    return {
      name: 'db_function_and_tables',
      status: 'FAIL',
      detail: {
        reason: (psqlResult.stderr || psqlResult.stdout || 'psql failed').trim(),
      },
    };
  }

  let parsed;
  try {
    parsed = JSON.parse(String(psqlResult.stdout || '').trim());
  } catch (err) {
    return {
      name: 'db_function_and_tables',
      status: 'FAIL',
      detail: { reason: `Unable to parse psql JSON output: ${err.message}` },
    };
  }

  const ok =
    parsed.denizen_user_can_access_org_exists === true &&
    parsed.denizen_resolve_mcp_token_exists === true &&
    parsed.mcp_rpc_search_path_ok === true &&
    parsed.trading_tables?.denizen_watchlist_symbols === true &&
    parsed.trading_tables?.denizen_trade_suggestions === true;

  return {
    name: 'db_function_and_tables',
    status: ok ? 'PASS' : 'FAIL',
    detail: parsed,
  };
}

async function main() {
  const baseUrl = getBaseUrl();
  const apiKey = getApiKey();
  const checks = [];

  for (const table of requiredTables) {
    checks.push(await headTable(baseUrl, apiKey, table));
  }

  checks.push(runOptionalDbVerification(process.env.SUPABASE_DB_URL || ''));

  const summary = {
    total: checks.length,
    passed: checks.filter((c) => c.status === 'PASS').length,
    failed: checks.filter((c) => c.status === 'FAIL').length,
    skipped: checks.filter((c) => c.status === 'SKIP').length,
  };

  const report = {
    timestamp: new Date().toISOString(),
    status: summary.failed > 0 ? 'FAIL' : 'PASS',
    summary,
    checks,
  };

  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (summary.failed > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  const report = {
    timestamp: new Date().toISOString(),
    status: 'FAIL',
    summary: { total: 0, passed: 0, failed: 1, skipped: 0 },
    checks: [],
    error: err.message,
  };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  process.exit(1);
});

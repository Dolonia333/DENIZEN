param(
  [string]$DbUrl = $env:SUPABASE_DB_URL,
  [string]$EnvFilePath = '',
  [switch]$SkipHttpVerification
)

$ErrorActionPreference = 'Stop'

$root = Split-Path $PSScriptRoot -Parent
if (-not $EnvFilePath) {
  $EnvFilePath = Join-Path $root '.env.production'
}

$report = [ordered]@{
  timestamp = (Get-Date).ToString('o')
  status = 'IN_PROGRESS'
  steps = @()
  errors = @()
}

function Add-Step {
  param(
    [string]$Name,
    [string]$Status,
    [object]$Detail
  )

  $script:report.steps += [ordered]@{
    name = $Name
    status = $Status
    detail = $Detail
  }
}

function Import-EnvFile {
  param([string]$Path)

  if (-not (Test-Path $Path)) {
    return $false
  }

  Get-Content -Path $Path | ForEach-Object {
    $line = $_.Trim()
    if (-not $line -or $line.StartsWith('#')) { return }
    $parts = $line -split '=', 2
    if ($parts.Count -ne 2) { return }
    $key = $parts[0].Trim()
    $value = $parts[1].Trim()

    if (
      ($value.StartsWith('"') -and $value.EndsWith('"')) -or
      ($value.StartsWith("'") -and $value.EndsWith("'"))
    ) {
      $value = $value.Substring(1, $value.Length - 2)
    }

    if (-not [string]::IsNullOrWhiteSpace($key) -and [string]::IsNullOrEmpty([Environment]::GetEnvironmentVariable($key, 'Process'))) {
      [Environment]::SetEnvironmentVariable($key, $value, 'Process')
    }
  }

  return $true
}

function Test-LocalDockerDbUrl {
  param([string]$Url)
  return $Url -match '127\.0\.0\.1:54322|localhost:54322'
}

function Invoke-PsqlJson {
  param(
    [string]$ConnectionString,
    [string]$Query
  )

  if (Get-Command psql -ErrorAction SilentlyContinue) {
    $raw = (& psql "$ConnectionString" -t -A -v ON_ERROR_STOP=1 -c $Query 2>&1) -join "`n"
    if ($LASTEXITCODE -ne 0) {
      throw "psql verification failed: $raw"
    }
    return ($raw.Trim() | ConvertFrom-Json)
  }

  if (Test-LocalDockerDbUrl -Url $ConnectionString) {
    $container = $env:SUPABASE_DB_CONTAINER
    if (-not $container) { $container = 'supabase_db_Desktop' }
    $env:PGPASSWORD = 'postgres'
    $raw = (docker exec -e PGPASSWORD=postgres $container psql -U postgres -d postgres -t -A -v ON_ERROR_STOP=1 -c $Query 2>&1) -join "`n"
    if ($LASTEXITCODE -ne 0) {
      throw "docker psql verification failed: $raw"
    }
    return ($raw.Trim() | ConvertFrom-Json)
  }

  throw 'psql not found in PATH. Install PostgreSQL client tools or use local Docker DB URL (127.0.0.1:54322).'
}

function Invoke-DenizenSmoke {
  param([string]$BaseUrl)

  $base = $BaseUrl.TrimEnd('/')
  $checks = @(
    @{ Name = 'health'; Path = '/api/health' },
    @{ Name = 'visitor_ping'; Path = '/api/visitor/ping' },
    @{ Name = 'prediction_summary'; Path = '/api/intelligence/prediction-summary' },
    @{ Name = 'trade_suggestions'; Path = '/api/trade-suggestions' }
  )

  $results = @()
  foreach ($check in $checks) {
    try {
      $resp = Invoke-WebRequest -Uri "$base$($check.Path)" -Method GET -UseBasicParsing -TimeoutSec 20
      $ok = $resp.StatusCode -ge 200 -and $resp.StatusCode -lt 300
      $results += [ordered]@{
        name = $check.Name
        status = if ($ok) { 'PASS' } else { 'FAIL' }
        detail = [ordered]@{
          statusCode = $resp.StatusCode
          endpoint = "$base$($check.Path)"
        }
      }
    } catch {
      $results += [ordered]@{
        name = $check.Name
        status = 'FAIL'
        detail = [ordered]@{
          endpoint = "$base$($check.Path)"
          error = $_.Exception.Message
        }
      }
    }
  }

  return $results
}

try {
  $envLoaded = Import-EnvFile -Path $EnvFilePath
  Add-Step -Name 'load_env_file' -Status 'PASS' -Detail @{
    envFilePath = $EnvFilePath
    found = $envLoaded
  }

  if (-not $DbUrl) {
    $DbUrl = $env:SUPABASE_DB_URL
  }

  if (-not $DbUrl) {
    throw "SUPABASE_DB_URL is required. Set it in your shell environment or define it in '$EnvFilePath'."
  }

  $applyScript = Join-Path $PSScriptRoot 'apply-all-migrations.ps1'
  if (-not (Test-Path $applyScript)) {
    throw "Migration runner not found: $applyScript"
  }

  $prevEap = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  $applyOutput = (& $applyScript -DbUrl $DbUrl 2>&1) | ForEach-Object { "$_" }
  $applyExit = $LASTEXITCODE
  $ErrorActionPreference = $prevEap
  if ($applyExit -ne 0) {
    throw "apply-all-migrations.ps1 failed (exit $applyExit).`n$($applyOutput -join "`n")"
  }

  Add-Step -Name 'apply_migrations' -Status 'PASS' -Detail @{
    output = $applyOutput
  }

  $sqlVerificationQuery = @"
with required(version) as (
  values
    ('20260606000012'),
    ('20260606000013'),
    ('20260606000014'),
    ('20260606000015'),
    ('20260622000001'),
    ('20260622000002')
),
found as (
  select version from public.denizen_schema_migrations
  where version in (select version from required)
),
missing as (
  select r.version
  from required r
  left join found f on f.version = r.version
  where f.version is null
)
select json_build_object(
  'required_versions_present', (select count(*) from missing) = 0,
  'missing_versions', coalesce((select json_agg(version) from missing), '[]'::json),
  'denizen_user_can_access_org_exists', exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'denizen_user_can_access_org'
  ),
  'denizen_resolve_mcp_token_exists', exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'denizen_resolve_mcp_token'
  ),
  'mcp_rpc_search_path_ok', (
    select coalesce(
      (select 'extensions' = any(string_to_array(
        replace(replace(proconfig[1], 'search_path=', ''), ' ', ''), ','
      ))
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname = 'denizen_resolve_mcp_token'
        and proconfig is not null),
      false)
  ),
  'mcp_tokens_table_exists', to_regclass('public.denizen_mcp_tokens') is not null,
  'trading_tables', json_build_object(
    'denizen_watchlist_symbols', to_regclass('public.denizen_watchlist_symbols') is not null,
    'denizen_trade_suggestions', to_regclass('public.denizen_trade_suggestions') is not null
  )
)::text;
"@

  $sqlVerification = Invoke-PsqlJson -ConnectionString $DbUrl -Query $sqlVerificationQuery
  $sqlPass = (
    $sqlVerification.required_versions_present -eq $true -and
    $sqlVerification.denizen_user_can_access_org_exists -eq $true -and
    $sqlVerification.denizen_resolve_mcp_token_exists -eq $true -and
    $sqlVerification.mcp_rpc_search_path_ok -eq $true -and
    $sqlVerification.mcp_tokens_table_exists -eq $true -and
    $sqlVerification.trading_tables.denizen_watchlist_symbols -eq $true -and
    $sqlVerification.trading_tables.denizen_trade_suggestions -eq $true
  )
  $sqlStatus = if ($sqlPass) { 'PASS' } else { 'FAIL' }
  Add-Step -Name 'verify_schema_sql' -Status $sqlStatus -Detail $sqlVerification

  $verifyScript = Join-Path $PSScriptRoot 'verify-production-schema.js'
  if ($SkipHttpVerification) {
    Add-Step -Name 'verify_schema_http' -Status 'SKIP' -Detail @{ reason = 'SkipHttpVerification was specified.' }
  } elseif (-not (Test-Path $verifyScript)) {
    Add-Step -Name 'verify_schema_http' -Status 'SKIP' -Detail @{ reason = "Script not found: $verifyScript" }
  } elseif (-not $env:SUPABASE_URL) {
    Add-Step -Name 'verify_schema_http' -Status 'SKIP' -Detail @{ reason = 'SUPABASE_URL is not set.' }
  } elseif (-not $env:SUPABASE_SERVICE_ROLE_KEY -and -not $env:SUPABASE_ANON_KEY) {
    Add-Step -Name 'verify_schema_http' -Status 'SKIP' -Detail @{ reason = 'Need SUPABASE_SERVICE_ROLE_KEY or SUPABASE_ANON_KEY for REST checks.' }
  } else {
    if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
      throw 'Node.js is required to run verify-production-schema.js.'
    }

    $verifyRaw = (& node $verifyScript 2>&1) -join "`n"
    if (-not $verifyRaw) {
      throw 'verify-production-schema.js returned empty output.'
    }

    $verifyJson = $verifyRaw | ConvertFrom-Json
    $verifyPass = $verifyJson.summary.failed -eq 0
    $httpStatus = if ($verifyPass) { 'PASS' } else { 'FAIL' }
    Add-Step -Name 'verify_schema_http' -Status $httpStatus -Detail $verifyJson
  }

  if ($env:DENIZEN_URL) {
    $smoke = Invoke-DenizenSmoke -BaseUrl $env:DENIZEN_URL
    $smokePass = (($smoke | Where-Object { $_.status -eq 'FAIL' } | Measure-Object).Count -eq 0)
    $smokeStatus = if ($smokePass) { 'PASS' } else { 'FAIL' }
    Add-Step -Name 'post_deploy_smoke' -Status $smokeStatus -Detail @{
      denizenUrl = $env:DENIZEN_URL
      checks = $smoke
    }
  } else {
    Add-Step -Name 'post_deploy_smoke' -Status 'SKIP' -Detail @{ reason = 'DENIZEN_URL is not set.' }
  }
}
catch {
  $report.errors += $_.Exception.Message
}
finally {
  $hasFail = (($report.steps | Where-Object { $_.status -eq 'FAIL' } | Measure-Object).Count -gt 0) -or ($report.errors.Count -gt 0)
  $report.status = if ($hasFail) { 'FAIL' } else { 'PASS' }
  $report.summary = [ordered]@{
    total = $report.steps.Count
    passed = ($report.steps | Where-Object { $_.status -eq 'PASS' } | Measure-Object).Count
    failed = ($report.steps | Where-Object { $_.status -eq 'FAIL' } | Measure-Object).Count
    skipped = ($report.steps | Where-Object { $_.status -eq 'SKIP' } | Measure-Object).Count
  }

  $json = $report | ConvertTo-Json -Depth 15
  Write-Output $json

  if ($hasFail) {
    exit 1
  }
}

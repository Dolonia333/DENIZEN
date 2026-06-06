# Apply Denizen schema migrations from 000012+ in deterministic order.
# - 000012 runs as postgres
# - 000013 runs as supabase_admin
# - 000014+ infer role from filename/header (defaults to postgres)
#
# Local Docker usage:
#   .\scripts\apply-all-migrations.ps1
#
# Production / remote Supabase usage (requires psql in PATH):
#   $env:SUPABASE_DB_URL = "postgresql://postgres:<password>@<host>:5432/postgres?sslmode=require"
#   .\scripts\apply-all-migrations.ps1 -DbUrl $env:SUPABASE_DB_URL
#
# Notes:
# - Script is additive and idempotent if SQL files are idempotent.
# - Never store secrets in this file; pass credentials via environment variables.

param(
  [string]$DbUrl = $env:SUPABASE_DB_URL,
  [string]$ContainerName = 'supabase_db_Desktop'
)

$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$migrationDir = Join-Path $root 'supabase\migrations'

if (-not (Test-Path $migrationDir)) {
  throw "Migration directory not found: $migrationDir"
}

function Get-MigrationVersion {
  param([string]$FileName)
  $m = [regex]::Match($FileName, '^(\d{14})_')
  if (-not $m.Success) { return $null }
  return [int64]$m.Groups[1].Value
}

function Resolve-MigrationRole {
  param(
    [int64]$Version,
    [string]$FilePath
  )

  if ($Version -eq 20260606000012) { return 'postgres' }
  if ($Version -eq 20260606000013) { return 'supabase_admin' }

  $name = [IO.Path]::GetFileName($FilePath).ToLowerInvariant()
  if ($name -match 'admin') { return 'supabase_admin' }

  $header = (Get-Content -Path $FilePath -TotalCount 30) -join "`n"
  if ($header -match '(?i)apply as\s+supabase_admin' -or $header -match '(?i)owned by supabase_admin') {
    return 'supabase_admin'
  }
  return 'postgres'
}

function Invoke-MigrationViaDocker {
  param(
    [string]$FilePath,
    [string]$Role
  )

  $env:PGPASSWORD = 'postgres'
  $prevEap = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  $output = Get-Content -Path $FilePath -Raw |
    docker exec -i -e PGPASSWORD=postgres $ContainerName psql -v ON_ERROR_STOP=1 -U $Role -d postgres 2>&1
  $exitCode = $LASTEXITCODE
  $ErrorActionPreference = $prevEap
  if ($exitCode -ne 0) {
    throw ($output | Out-String).Trim()
  }
}

function Test-LocalDockerDbUrl {
  param([string]$Url)
  return $Url -match '127\.0\.0\.1:54322|localhost:54322'
}

function Invoke-MigrationViaDbUrl {
  param(
    [string]$FilePath,
    [string]$Role
  )

  if (-not (Get-Command psql -ErrorAction SilentlyContinue)) {
    if (Test-LocalDockerDbUrl -Url $DbUrl) {
      Invoke-MigrationViaDocker -FilePath $FilePath -Role $Role
      return
    }
    throw "psql not found in PATH. Install PostgreSQL client tools, use local Docker (127.0.0.1:54322), or run without -DbUrl."
  }

  $sql = Get-Content -Path $FilePath -Raw
  $payload = "set role $Role;`n$sql"
  $payload | psql "$DbUrl" -v ON_ERROR_STOP=1 | Out-Null
}

$targets = Get-ChildItem -Path $migrationDir -Filter '*.sql' -File |
  ForEach-Object {
    $version = Get-MigrationVersion -FileName $_.Name
    if ($null -eq $version) { return }
    [PSCustomObject]@{
      File = $_
      Version = $version
    }
  } |
  Where-Object {
    $_.Version -eq 20260606000012 -or
    $_.Version -eq 20260606000013 -or
    $_.Version -ge 20260606000014
  } |
  Sort-Object Version

if (-not $targets -or $targets.Count -eq 0) {
  throw "No matching migrations found (expected 000012, 000013, and 000014+)."
}

Write-Host ("Applying {0} migration(s) from {1}" -f $targets.Count, $migrationDir)
if ($DbUrl) {
  Write-Host "Target: SUPABASE_DB_URL (remote/prod mode)"
} else {
  Write-Host ("Target: Docker container '{0}' (local mode)" -f $ContainerName)
}

foreach ($target in $targets) {
  $filePath = $target.File.FullName
  $role = Resolve-MigrationRole -Version $target.Version -FilePath $filePath
  Write-Host (" -> {0} as {1}" -f $target.File.Name, $role)

  if ($DbUrl) {
    Invoke-MigrationViaDbUrl -FilePath $filePath -Role $role
  } else {
    Invoke-MigrationViaDocker -FilePath $filePath -Role $role
  }
}

Write-Host "All targeted migrations applied successfully."

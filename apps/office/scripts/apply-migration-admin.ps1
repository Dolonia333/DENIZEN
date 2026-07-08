# Apply supabase_admin-owned migrations (platform website tables).
# Usage: .\scripts\apply-migration-admin.ps1 migrations\20260606000013_platform_tables_admin.sql

param(
  [Parameter(Mandatory = $true)]
  [string]$MigrationFile
)

$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$sqlPath = Join-Path $root $MigrationFile
if (-not (Test-Path $sqlPath)) { throw "Migration not found: $sqlPath" }

$env:PGPASSWORD = 'postgres'
Get-Content $sqlPath | docker exec -i -e PGPASSWORD=postgres supabase_db_Desktop psql -U supabase_admin -d postgres
Write-Host "Applied $MigrationFile as supabase_admin"

# Prepare self-hosted Supabase for Dolonia (Synology NAS + supabase.dolonia.cloud)
# Follows: https://supabase.com/docs/guides/self-hosting/docker

$ErrorActionPreference = 'Stop'
$here = $PSScriptRoot

function Set-EnvValue {
    param([string]$Path, [string]$Key, [string]$Value)
    $lines = Get-Content -Path $Path
    $pattern = "^\s*$([regex]::Escape($Key))="
    $replacement = "$Key=$Value"
    $found = $false
    $out = foreach ($line in $lines) {
        if ($line -match $pattern) {
            $found = $true
            $replacement
        } else {
            $line
        }
    }
    if (-not $found) { $out += $replacement }
    Set-Content -Path $Path -Value $out -Encoding utf8
}

Write-Host "==> Preparing Supabase project in $here"

if (-not (Test-Path (Join-Path $here 'docker-compose.yml'))) {
    throw 'docker-compose.yml not found. Run infra/setup-supabase-nas.ps1 first.'
}

$envFile = Join-Path $here '.env'
if (-not (Test-Path $envFile)) {
    Copy-Item (Join-Path $here '.env.example') $envFile
    Write-Host 'Created .env from .env.example'
}

$wslPath = '/mnt/c/' + ($here -replace '^[A-Za-z]:\\', '' -replace '\\', '/')

$needsKeys = (Get-Content $envFile -Raw) -match 'your-super-secret-and-long-postgres-password'
if ($needsKeys) {
    Write-Host '==> Generating secrets (generate-keys.sh)'
    bash -lc "cd '$wslPath' && sh utils/generate-keys.sh --update-env"
    Write-Host '==> Generating asymmetric auth keys (add-new-auth-keys.sh)'
    bash -lc "cd '$wslPath' && sh utils/add-new-auth-keys.sh --update-env"
} else {
    Write-Host '==> .env already has generated secrets — updating URLs only'
}

# Letters+numbers only for POSTGRES_PASSWORD per Supabase docs (URL encoding)
$pgPass = -join ((65..90) + (97..122) + (48..57) | Get-Random -Count 32 | ForEach-Object { [char]$_ })
$dashUser = 'dolonia'
$dashPass = -join ((65..90) + (97..122) | Get-Random -Count 16 | ForEach-Object { [char]$_ })

Set-EnvValue -Path $envFile -Key 'POSTGRES_PASSWORD' -Value $pgPass
Set-EnvValue -Path $envFile -Key 'DASHBOARD_USERNAME' -Value $dashUser
Set-EnvValue -Path $envFile -Key 'DASHBOARD_PASSWORD' -Value $dashPass
Set-EnvValue -Path $envFile -Key 'SUPABASE_PUBLIC_URL' -Value 'https://supabase.dolonia.cloud'
Set-EnvValue -Path $envFile -Key 'API_EXTERNAL_URL' -Value 'https://supabase.dolonia.cloud'
Set-EnvValue -Path $envFile -Key 'SITE_URL' -Value 'https://denizen.dolonia.cloud'
Set-EnvValue -Path $envFile -Key 'POOLER_TENANT_ID' -Value 'dolonia'

$credentials = Join-Path $here 'DOLONIA_CREDENTIALS.txt'
$envContent = Get-Content $envFile -Raw
function Get-EnvLine([string]$key) {
    if ($envContent -match "(?m)^$key=(.+)$") { return $Matches[1].Trim() }
    return ''
}

@(
    'Dolonia self-hosted Supabase credentials'
    'Generated: ' + (Get-Date -Format 'yyyy-MM-dd HH:mm:ss')
    'DO NOT COMMIT THIS FILE'
    ''
    '=== Synology Studio (basic auth) ==='
    "URL (local LAN): http://<NAS-IP>:8000"
    'URL (public): https://supabase.dolonia.cloud'
    "Username: $dashUser"
    "Password: $dashPass"
    ''
    '=== Denizen .env (on your PC) ==='
    'SUPABASE_URL=https://supabase.dolonia.cloud'
    "SUPABASE_ANON_KEY=$(Get-EnvLine 'ANON_KEY')"
    "SUPABASE_SERVICE_ROLE_KEY=$(Get-EnvLine 'SERVICE_ROLE_KEY')"
    'DENIZEN_DB_ENABLED=true'
    ''
    '=== denizen/.env.production (migrations) ==='
    "SUPABASE_URL=https://supabase.dolonia.cloud"
    "SUPABASE_ANON_KEY=$(Get-EnvLine 'ANON_KEY')"
    "SUPABASE_SERVICE_ROLE_KEY=$(Get-EnvLine 'SERVICE_ROLE_KEY')"
    "SUPABASE_DB_URL=postgres://postgres.${(Get-EnvLine 'POOLER_TENANT_ID')}:$pgPass@<NAS-IP>:5432/postgres"
    'DENIZEN_URL=https://denizen.dolonia.cloud'
    ''
    '=== Postgres (session mode via Supavisor) ==='
    "postgres://postgres.$((Get-EnvLine 'POOLER_TENANT_ID')):$pgPass@<NAS-IP>:5432/postgres"
) | Set-Content -Path $credentials -Encoding utf8

Write-Host ''
Write-Host 'Done. Credentials written to DOLONIA_CREDENTIALS.txt (gitignored).'
Write-Host 'Next: copy infra/supabase-project to Synology and start the stack.'
Write-Host 'See SYNOLOGY.md in this folder.'

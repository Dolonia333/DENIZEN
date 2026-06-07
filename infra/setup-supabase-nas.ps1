# Fetch official Supabase docker compose + prepare Dolonia NAS config
# Docs: https://supabase.com/docs/guides/self-hosting/docker

$ErrorActionPreference = 'Stop'
$infra = $PSScriptRoot
$upstream = Join-Path $infra 'supabase-upstream'
$project = Join-Path $infra 'supabase-project'

if (-not (Test-Path $upstream)) {
    Write-Host '==> Cloning Supabase docker config (sparse)...'
    git clone --depth 1 --filter=blob:none --sparse https://github.com/supabase/supabase.git $upstream
    Push-Location $upstream
    git sparse-checkout set docker
    git checkout
    Pop-Location
} else {
    Write-Host '==> Updating Supabase upstream...'
    Push-Location $upstream
    git pull --ff-only
    Pop-Location
}

Write-Host '==> Syncing docker files to supabase-project...'
if (Test-Path $project) {
    Get-ChildItem $project -Exclude '.env','DOLONIA_CREDENTIALS.txt','volumes' | Remove-Item -Recurse -Force
} else {
    New-Item -ItemType Directory -Path $project | Out-Null
}
Copy-Item -Recurse -Force (Join-Path $upstream 'docker\*') $project

& (Join-Path $project 'prepare-dolonia.ps1')

Write-Host ''
Write-Host 'Supabase NAS package ready at: infra/supabase-project'

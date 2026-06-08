<#
.SYNOPSIS
  Stage Denizen desktop build outputs for manual upload to the update server.

.DESCRIPTION
  Copies dist/* and latest*.yml into a local folder tree ready to sync to
  https://denizen.dolonia.cloud/desktop/updates/

  Stable builds produce latest.yml / latest-mac.yml / latest-linux.yml.
  Beta builds produce latest-beta.yml / latest-mac-beta.yml / latest-linux-beta.yml.
  Upload the contents of the staged folder to the remote updates path (flat layout).

.PARAMETER DistDir
  Path to electron-builder output (default: ../dist relative to this script).

.PARAMETER OutDir
  Root folder for staged uploads (default: ../updates-publish).

.PARAMETER Channel
  Release channel label used for the local staging subfolder (stable or beta).

.EXAMPLE
  npm run build:win
  .\scripts\publish-update-manifest.ps1 -Channel stable

.EXAMPLE
  $env:DENIZEN_UPDATE_CHANNEL = "beta"
  npm run build:win
  .\scripts\publish-update-manifest.ps1 -Channel beta
#>
[CmdletBinding()]
param(
    [string]$DistDir = (Join-Path $PSScriptRoot ".." "dist"),
    [string]$OutDir = (Join-Path $PSScriptRoot ".." "updates-publish"),
    [ValidateSet("stable", "beta")]
    [string]$Channel = "stable"
)

$ErrorActionPreference = "Stop"

$resolvedDist = Resolve-Path -Path $DistDir
$targetRoot = Join-Path $OutDir $Channel
New-Item -ItemType Directory -Force -Path $targetRoot | Out-Null

$files = Get-ChildItem -Path $resolvedDist -File | Sort-Object Name

if (-not $files -or $files.Count -eq 0) {
    throw "No build artifacts found in $resolvedDist. Run npm run build:* first."
}

foreach ($file in $files) {
    Copy-Item -Path $file.FullName -Destination $targetRoot -Force
}

Write-Host ""
Write-Host "Staged $($files.Count) file(s) in: $targetRoot"
Write-Host "Upload these files to: https://denizen.dolonia.cloud/desktop/updates/"
Write-Host ""
Get-ChildItem -Path $targetRoot | Sort-Object Name | Format-Table Name, @{ Label = "Size (KB)"; Expression = { [math]::Round($_.Length / 1KB, 1) } }, LastWriteTime

<#
.SYNOPSIS
  Stage Denizen desktop build outputs for a manual GitHub Release upload.

.DESCRIPTION
  Copies installers and latest*.yml into a flat local folder ready to attach
  to a GitHub Release.

  Stable builds produce latest.yml / latest-mac.yml / latest-linux.yml.
  Beta builds produce latest-beta.yml / latest-mac-beta.yml / latest-linux-beta.yml.
  Upload the contents of the staged folder to the matching GitHub Release.

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
    [string]$DistDir = "",
    [string]$OutDir = "",
    [ValidateSet("stable", "beta")]
    [string]$Channel = "stable"
)

$ErrorActionPreference = "Stop"

$scriptRoot = if ($PSScriptRoot) {
    $PSScriptRoot
} else {
    Split-Path -Parent $MyInvocation.MyCommand.Path
}

if (-not $DistDir) {
    $DistDir = Join-Path (Join-Path $scriptRoot "..") "dist-build"
}
if (-not $OutDir) {
    $OutDir = Join-Path (Join-Path $scriptRoot "..") "updates"
}

$resolvedDist = Resolve-Path -Path $DistDir
# electron-updater expects the manifests and binaries together in one release.
$targetRoot = $OutDir
New-Item -ItemType Directory -Force -Path $targetRoot | Out-Null

$files = Get-ChildItem -Path $resolvedDist -File | Where-Object {
    $_.Name -match '^(latest.*\.ya?ml)$' -or $_.Extension -in '.exe', '.blockmap', '.AppImage', '.dmg', '.zip'
} | Sort-Object Name

if (-not $files -or $files.Count -eq 0) {
    throw "No update artifacts found in $resolvedDist. Run npm run build:* first."
}

foreach ($file in $files) {
    Copy-Item -Path $file.FullName -Destination $targetRoot -Force
}

Write-Host ""
Write-Host "Staged $($files.Count) file(s) in: $targetRoot"
Write-Host "Attach these files to the matching GitHub Release."
Write-Host ""
Get-ChildItem -Path $targetRoot | Sort-Object Name | Format-Table Name, @{ Label = "Size (KB)"; Expression = { [math]::Round($_.Length / 1KB, 1) } }, LastWriteTime

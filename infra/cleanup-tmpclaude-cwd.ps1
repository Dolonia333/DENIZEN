# Remove Claude Code shell cwd markers left in the repo root.
# Safe to run anytime — files are ephemeral and already gitignored.
param(
    [string]$Root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
)

$pattern = Join-Path $Root "tmpclaude-*-cwd"
$files = @(Get-ChildItem $pattern -ErrorAction SilentlyContinue)
$count = $files.Count

if ($count -eq 0) {
    Write-Host "No tmpclaude-*-cwd files under $Root"
    exit 0
}

$files | Remove-Item -Force
Write-Host "Removed $count tmpclaude-*-cwd file(s) from $Root"

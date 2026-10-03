param([string]$Target = '', [switch]$InstallScheduledTask)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'NEXEN_STORAGE.ps1')

function Get-NexenStartScript {
    $parts = foreach ($name in @('Assert-NexenOutputPath','New-NexenDirectory','Set-NexenStorageEnvironment')) {
        'function ' + $name + ' {' + [Environment]::NewLine + (Get-Command $name -CommandType Function).Definition + [Environment]::NewLine + '}'
    }
    $body = @'
$ErrorActionPreference = 'Stop'
$nexenRoot = Assert-NexenOutputPath $PSScriptRoot
Set-NexenStorageEnvironment $nexenRoot
Set-Location -LiteralPath $nexenRoot
$python = Assert-NexenOutputPath (Join-Path $nexenRoot '.venv\Scripts\python.exe')
$entry = Assert-NexenOutputPath (Join-Path $nexenRoot 'nexen.py')
if (-not [IO.File]::Exists($python) -or -not [IO.File]::Exists($entry)) { throw 'The local NEXEN installation is incomplete.' }
& $python -B $entry serve
if ($LASTEXITCODE -ne 0) { throw "NEXEN exited with code $LASTEXITCODE." }
'@
    return ($parts -join ([Environment]::NewLine + [Environment]::NewLine)) + [Environment]::NewLine + $body
}

function Get-NexenCopyPlan {
    param([string]$Source, [string]$Destination)
    $sourcePath = [IO.Path]::GetFullPath($Source)
    $destinationPath = Get-NexenInstallTarget $Destination
    $pending = [Collections.Generic.List[object]]::new()
    $files = [Collections.Generic.List[object]]::new()
    foreach ($item in Get-ChildItem -LiteralPath $sourcePath -File -Force) {
        if ($item.Name -eq 'START_NEXEN.ps1') { continue }
        if ($item.Extension -in @('.py','.pyw','.html','.ps1') -or $item.Name -in @('requirements.txt','.env.example')) { $files.Add($item) }
    }
    # Never import runtime DBs, logs, work products, caches or a source virtualenv.
    foreach ($name in @('config','world-assets','vendor','harnesses','workflows')) {
        $folder = Join-Path $sourcePath $name
        if (-not (Test-Path -LiteralPath $folder)) { continue }
        $queue = [Collections.Generic.Queue[string]]::new(); $queue.Enqueue($folder)
        while ($queue.Count) {
            $directory = $queue.Dequeue()
            $directoryItem = Get-Item -LiteralPath $directory -Force
            if ($directoryItem.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Install source directories cannot be reparse points.' }
            foreach ($item in Get-ChildItem -LiteralPath $directory -Force) {
                if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Install source entries cannot be reparse points.' }
                if ($item.PSIsContainer) { $queue.Enqueue($item.FullName) } else { $files.Add($item) }
            }
        }
    }
    foreach ($item in $files) {
        if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Install source files cannot be reparse points.' }
        $relative = $item.FullName.Substring($sourcePath.TrimEnd('\').Length + 1)
        $output = Assert-NexenOutputPath (Join-Path $destinationPath $relative)
        if ([IO.File]::Exists($output)) {
            if ($relative.StartsWith('config\', [StringComparison]::OrdinalIgnoreCase)) { continue }
            if ((Get-FileHash -LiteralPath $item.FullName -Algorithm SHA256).Hash -ne (Get-FileHash -LiteralPath $output -Algorithm SHA256).Hash) {
                throw "An existing program file differs: $relative. Use a fresh folder or a reviewed upgrade; existing files have been preserved."
            }
            continue
        }
        if ([IO.Directory]::Exists($output)) { throw "A directory conflicts with an install file: $relative" }
        $pending.Add([pscustomobject]@{Source=$item.FullName;Destination=$output})
    }
    return $pending.ToArray()
}

Write-Host '=== NEXEN AUTONOMY INSTALLER (H:/F: OUTPUT ONLY) ===' -ForegroundColor Cyan
$Target = Get-NexenInstallTarget $Target
$Source = Split-Path -Parent $MyInvocation.MyCommand.Path
$copyPlan = @(Get-NexenCopyPlan $Source $Target)
$startPath = Assert-NexenOutputPath (Join-Path $Target 'START_NEXEN.ps1')
$start = Get-NexenStartScript
if ([IO.File]::Exists($startPath) -and [IO.File]::ReadAllText($startPath).Trim() -ne $start.Trim()) {
    throw 'An existing START_NEXEN.ps1 differs. Use a fresh folder or a reviewed launcher update; it has been preserved.'
}
New-NexenDirectory $Target | Out-Null
Set-NexenStorageEnvironment $Target
Write-Host '[1/7] Copying missing application files; preserving data and configuration...'
foreach ($item in $copyPlan) {
    New-NexenDirectory ([IO.Path]::GetDirectoryName($item.Destination)) | Out-Null
    Assert-NexenOutputPath $item.Destination | Out-Null
    [IO.File]::Copy($item.Source, $item.Destination, $false)
}
Set-Location -LiteralPath $Target
Write-Host '[2/7] Finding Python 3.11+...'
$python = $null
foreach ($candidate in @('py','python','python3')) {
    try {
        & $candidate -B -c 'import sys; sys.exit(0 if sys.version_info >= (3, 11) else 1)' *> $null
        if ($LASTEXITCODE -eq 0) { $python = $candidate; break }
    } catch {}
}
if (-not $python) { throw 'Python 3.11+ is required. No fallback installation was started.' }
$venv = Assert-NexenOutputPath (Join-Path $Target '.venv')
$venvPython = Assert-NexenOutputPath (Join-Path $venv 'Scripts\python.exe')
Write-Host '[3/7] Creating the H:/F: virtual environment...'
if (-not [IO.File]::Exists($venvPython)) {
    & $python -B -m venv $venv
    if ($LASTEXITCODE -ne 0) { throw "Virtual environment creation failed ($LASTEXITCODE)." }
}
Assert-NexenOutputPath $venvPython | Out-Null
Write-Host '[4/7] Installing dependencies with an H:/F: cache...'
& $venvPython -B -m pip --isolated --cache-dir $env:PIP_CACHE_DIR install --upgrade pip
if ($LASTEXITCODE -ne 0) { throw "pip upgrade failed ($LASTEXITCODE)." }
& $venvPython -B -m pip --isolated --cache-dir $env:PIP_CACHE_DIR install -r (Join-Path $Target 'requirements.txt')
if ($LASTEXITCODE -ne 0) { throw "Dependency installation failed ($LASTEXITCODE)." }
Write-Host '[5/7] Creating application state directories...'
foreach ($relative in @('data','data\jarvis','data\generated_workflows','logs')) { New-NexenDirectory (Join-Path $Target $relative) | Out-Null }
Write-Host '[6/7] Initializing DB + Tool Fabric...'
& $venvPython -B (Join-Path $Target 'nexen.py') tools
if ($LASTEXITCODE -ne 0) { throw "NEXEN initialization failed ($LASTEXITCODE)." }
if (-not [IO.File]::Exists($startPath)) {
    Assert-NexenOutputPath $startPath | Out-Null
    $stream = [IO.File]::Open($startPath, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write)
    try { $bytes = [Text.UTF8Encoding]::new($false).GetBytes($start); $stream.Write($bytes, 0, $bytes.Length) } finally { $stream.Dispose() }
}
if ($InstallScheduledTask) {
    # Retain the old switch for compatibility; use metadata instead of a C: Startup file.
    $watchdogInstaller = Assert-NexenOutputPath (Join-Path $Target 'INSTALL_LOCAL_WATCHDOG.ps1')
    if (-not [IO.File]::Exists($watchdogInstaller)) { throw 'The guarded watchdog installer is missing; logon registration was not changed.' }
    & $watchdogInstaller
} else { Write-Host '[7/7] Logon registration skipped; add -InstallScheduledTask to enable the guarded HKCU Run launcher.' }
Write-Host 'NEXEN INSTALL COMPLETE' -ForegroundColor Green
Write-Host "Path: $Target"
Write-Host "Start: $startPath"
Write-Host 'Dashboard: http://127.0.0.1:8788'

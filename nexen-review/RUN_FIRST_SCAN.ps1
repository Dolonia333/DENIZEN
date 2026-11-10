$ErrorActionPreference = 'Stop'

function Invoke-NexenScanStage {
    param([string]$Python, [string]$Entry, [string]$Stage)
    & $Python -B $Entry $Stage
    if ($LASTEXITCODE -ne 0) {
        throw "NEXEN $Stage failed with exit code $LASTEXITCODE. Later stages were not started."
    }
}

function Invoke-NexenFirstScan {
    param([string]$ApplicationRoot = $PSScriptRoot)
    . (Join-Path $PSScriptRoot 'NEXEN_STORAGE.ps1')
    $scanRoot = Assert-NexenOutputPath -Path $ApplicationRoot
    if (-not (Test-Path -LiteralPath $scanRoot -PathType Container)) {
        throw 'The NEXEN application folder is unavailable; no fallback drive is permitted.'
    }
    $entry = Join-Path $scanRoot 'nexen.py'
    if (-not (Test-Path -LiteralPath $entry -PathType Leaf)) {
        throw 'The NEXEN application entry point is missing.'
    }
    # Verified D: venv remains a read-only dependency during the F: migration.
    $candidates = @('D:\yum\NEXEN_Autonomy_v0.1\.venv\Scripts\python.exe',
                    (Join-Path $scanRoot '.venv\Scripts\python.exe'))
    $python = $candidates | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -First 1
    if (-not $python) { throw 'No verified local Python environment is available. No install or scan was started.' }
    Set-NexenStorageEnvironment -Root $scanRoot
    Push-Location -LiteralPath $scanRoot
    try {
        foreach ($stage in @('scan', 'tools', 'compile', 'jarvis')) {
            Invoke-NexenScanStage -Python $python -Entry $entry -Stage $stage
        }
    } finally {
        Pop-Location
    }
}

if ($MyInvocation.InvocationName -ne '.') { Invoke-NexenFirstScan }

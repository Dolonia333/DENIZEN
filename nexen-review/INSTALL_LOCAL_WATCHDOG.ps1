param([switch]$StartNow, [switch]$SkipLogonRegistration)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'NEXEN_STORAGE.ps1')
$watchdogRoot = Get-NexenInstallTarget $PSScriptRoot
$watchdogPython = Assert-NexenOutputPath (Join-Path $watchdogRoot '.venv\Scripts\pythonw.exe')
$watchdogScript = Assert-NexenOutputPath (Join-Path $watchdogRoot 'local_watchdog.py')
$watchdogState = Assert-NexenOutputPath (Join-Path $watchdogRoot 'data\watchdog')
if (-not [IO.File]::Exists($watchdogPython) -or -not [IO.File]::Exists($watchdogScript)) {
    throw 'The fixed H:/F: Python runtime or watchdog script is missing. No fallback runtime was launched.'
}
$watchdogLauncher = Assert-NexenOutputPath (Join-Path $watchdogRoot 'START_LOCAL_WATCHDOG.ps1')
$launcher = @'
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'NEXEN_STORAGE.ps1')
$watchdogRoot = Get-NexenInstallTarget $PSScriptRoot
Set-NexenStorageEnvironment $watchdogRoot
$watchdogPython = Assert-NexenOutputPath (Join-Path $watchdogRoot '.venv\Scripts\pythonw.exe')
$watchdogScript = Assert-NexenOutputPath (Join-Path $watchdogRoot 'local_watchdog.py')
$watchdogState = New-NexenDirectory (Join-Path $watchdogRoot 'data\watchdog')
if (-not [IO.File]::Exists($watchdogPython) -or -not [IO.File]::Exists($watchdogScript)) { throw 'The fixed watchdog runtime is missing.' }
$out = Assert-NexenOutputPath (Join-Path $watchdogState ('bootstrap-'+[guid]::NewGuid().ToString('N')+'.stdout.log'))
$err = Assert-NexenOutputPath ($out.Replace('.stdout.log','.stderr.log'))
$watchdogLaunch = @{
    FilePath=$watchdogPython; ArgumentList=@('-B', ('"'+$watchdogScript+'"'));
    WorkingDirectory=$watchdogRoot; WindowStyle='Hidden'; PassThru=$true;
    RedirectStandardOutput=$out; RedirectStandardError=$err
}
$watchdogProcess = Start-Process @watchdogLaunch
Write-Output ('Started hidden watchdog launcher PID '+$watchdogProcess.Id+'. The watchdog singleton prevents duplicate supervisors.')
'@
if ([IO.File]::Exists($watchdogLauncher) -and [IO.File]::ReadAllText($watchdogLauncher).Trim() -ne $launcher.Trim()) {
    throw 'An existing watchdog launcher differs. It was preserved; review the launcher before replacing it.'
}
New-NexenDirectory $watchdogState | Out-Null
if (-not [IO.File]::Exists($watchdogLauncher)) {
    Assert-NexenOutputPath $watchdogLauncher | Out-Null
    $stream=[IO.File]::Open($watchdogLauncher,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write)
    try {$bytes=[Text.UTF8Encoding]::new($false).GetBytes($launcher);$stream.Write($bytes,0,$bytes.Length)} finally {$stream.Dispose()}
}
$registration = if ($SkipLogonRegistration) { $null } else { Register-NexenUserLogon $watchdogLauncher }
$receipt = Assert-NexenOutputPath (Join-Path $watchdogState ('startup-'+[guid]::NewGuid().ToString('N')+'.json'))
[ordered]@{
    prepared_at=[DateTime]::UtcNow.ToString('o');kind='guarded_local_watchdog_launcher';
    launcher=$watchdogLauncher;executable=$watchdogPython;registration=$registration;
    application_outputs='H:/F: only';windows_managed_registration_metadata=($null -ne $registration);
    needs_awake_windows=$true;survives_logout_or_shutdown=$false
} | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $receipt -Encoding UTF8
if ($StartNow) { & $watchdogLauncher }
Write-Output ('Prepared local watchdog launcher: '+$watchdogLauncher)

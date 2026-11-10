# NEXEN application output policy: H:/F: only. Does not sandbox Windows or other applications.

function Register-NexenUserLogon {
    param([string]$Launcher)
    $checked = Assert-NexenOutputPath $Launcher
    if (-not [IO.File]::Exists($checked) -or [IO.Path]::GetExtension($checked) -ne '.ps1') { throw 'The guarded H:/F: launcher is missing.' }
    $registryPath = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
    $valueName = 'NEXEN Local Autonomy'
    $shell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
    $desired = '"' + $shell + '" -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + $checked + '"'
    $properties = Get-ItemProperty -LiteralPath $registryPath -ErrorAction SilentlyContinue
    $existing = if ($properties) { $properties.PSObject.Properties[$valueName] } else { $null }
    if ($existing -and $existing.Value -ne $desired) { throw 'An existing NEXEN logon value points elsewhere; it was preserved. Review it before changing the launch target.' }
    if (-not $existing) {
        New-Item -Path $registryPath -Force | Out-Null
        New-ItemProperty -LiteralPath $registryPath -Name $valueName -Value $desired -PropertyType String -ErrorAction Stop | Out-Null
    }
    Write-Host 'Logon startup registered as Windows-managed HKCU metadata. NEXEN launcher/cache/output files stay on H:/F:.'
    return [pscustomobject]@{kind='current_user_logon_registry';registry=$registryPath;value_name=$valueName;command=$desired;launcher=$checked;windows_managed_metadata=$true}
}
function Assert-NexenOutputPath {
    param([Parameter(Mandatory=$true)][string]$Path)
    if ($Path -notmatch '^[FfHh]:[\\/]') { throw 'NEXEN output requires an absolute local H: or F: path.' }
    $normalized = $Path.Replace('/', '\')
    foreach ($part in $normalized.Substring(3).Split('\')) {
        if (-not $part) { continue }
        if ($part -in @('.', '..') -or $part -match '[<>:"|?*\x00-\x1f]' -or $part -match '[ .]$' -or
            $part -match '^(?i:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)') {
            throw 'NEXEN output contains a traversal, device, stream or invalid Windows path segment.'
        }
    }
    $full = [IO.Path]::GetFullPath($normalized)
    $drive = [IO.Path]::GetPathRoot($full)
    if ($drive -notin @('H:\', 'F:\') -or -not [IO.Directory]::Exists($drive)) {
        throw 'The selected H: or F: drive is unavailable; no other drive will be used.'
    }
    if ([IO.DriveInfo]::new($drive).DriveType -eq [IO.DriveType]::Network) { throw 'Mapped network outputs are not permitted.' }
    # Get-Item -Force inspects existing reparse entries, including dangling links.
    $current = $full
    while ($current) {
        try {
            $item = Get-Item -LiteralPath $current -Force -ErrorAction Stop
            if ($item.PSProvider.Name -ne 'FileSystem' -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
                throw 'NEXEN output cannot traverse a symlink, junction or other reparse point.'
            }
        } catch [System.Management.Automation.ItemNotFoundException] {}
        if ($current -eq $drive) { break }
        $current = [IO.Path]::GetDirectoryName($current)
    }
    return $full
}

function Get-NexenInstallTarget {
    param([string]$Requested)
    if ($Requested) { $selected = Assert-NexenOutputPath $Requested }
    elseif ([IO.Directory]::Exists('F:\')) { $selected = Assert-NexenOutputPath 'F:\NEXEN_AUTONOMY' }
    elseif ([IO.Directory]::Exists('H:\')) { $selected = Assert-NexenOutputPath 'H:\NEXEN_AUTONOMY' }
    else { throw 'H: and F: are unavailable. Attach an allowed drive before installing NEXEN.' }
    if ($selected.TrimEnd('\') -eq [IO.Path]::GetPathRoot($selected).TrimEnd('\')) { throw 'Choose a NEXEN folder, not an entire drive root.' }
    return $selected
}

function New-NexenDirectory {
    param([string]$Path)
    $checked = Assert-NexenOutputPath $Path
    [IO.Directory]::CreateDirectory($checked) | Out-Null
    Assert-NexenOutputPath $checked | Out-Null
    return $checked
}

function Set-NexenStorageEnvironment {
    param([string]$Root)
    $storage = Join-Path (Assert-NexenOutputPath $Root) '.nexen-runtime'
    $folders = @{
        TEMP='temp'; TMP='temp'; TMPDIR='temp'; BUN_TMPDIR='temp';
        PIP_CACHE_DIR='cache\pip'; UV_CACHE_DIR='cache\uv'; npm_config_cache='cache\npm';
        XDG_CACHE_HOME='cache\xdg'; XDG_CONFIG_HOME='profile\xdg-config';
        XDG_DATA_HOME='profile\xdg-data'; XDG_STATE_HOME='profile\xdg-state';
        USERPROFILE='profile'; APPDATA='profile\roaming'; LOCALAPPDATA='profile\local';
        PYTHONUSERBASE='profile\python'; HF_HOME='cache\huggingface';
        TORCH_HOME='cache\torch'; PLAYWRIGHT_BROWSERS_PATH='cache\playwright'
    }
    foreach ($relative in $folders.Values) { Assert-NexenOutputPath (Join-Path $storage $relative) | Out-Null }
    foreach ($name in $folders.Keys) {
        $directory = New-NexenDirectory (Join-Path $storage $folders[$name])
        [Environment]::SetEnvironmentVariable($name, $directory, 'Process')
    }
    $env:PYTHONDONTWRITEBYTECODE = '1'
    $env:PYTHONNOUSERSITE = '1'
    # Process environment only; never overwrite PowerShell's automatic $HOME variable.
    [Environment]::SetEnvironmentVariable('HOME', $env:USERPROFILE, 'Process')
    [Environment]::SetEnvironmentVariable('HOMEDRIVE', [IO.Path]::GetPathRoot($env:USERPROFILE).TrimEnd('\'), 'Process')
    [Environment]::SetEnvironmentVariable('HOMEPATH', $env:USERPROFILE.Substring(2), 'Process')
}

"""Exercise the PowerShell scan orchestration with a fake stage executor."""
from pathlib import Path
import json
import os
import shutil
import subprocess
import tempfile
import unittest

BASE = Path(__file__).resolve().parent
SHELL = Path(os.environ.get('SystemRoot', 'C:/Windows')) / 'System32/WindowsPowerShell/v1.0/powershell.exe'


class ScanWrapperTests(unittest.TestCase):
    def setUp(self):
        parent = Path('H:/NEXEN/work/tests')
        parent.mkdir(parents=True, exist_ok=True)
        self.temp = tempfile.TemporaryDirectory(prefix='scan-wrapper-', dir=parent)
        self.root = Path(self.temp.name)
        for name in ('RUN_FIRST_SCAN.ps1', 'NEXEN_STORAGE.ps1'):
            shutil.copyfile(BASE / name, self.root / name)
        (self.root / 'nexen.py').write_text('raise RuntimeError("No real scan may run in this test")\n', encoding='utf-8')
        python = self.root / '.venv/Scripts/python.exe'
        python.parent.mkdir(parents=True)
        python.write_bytes(b'fixture only; not executable')

    def tearDown(self):
        self.temp.cleanup()

    def run_fixture(self, extra='', requested='$PSScriptRoot'):
        driver = self.root / 'fixture.ps1'
        driver.write_text(r'''
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'RUN_FIRST_SCAN.ps1')
$script:realStage = (Get-Command Invoke-NexenScanStage).ScriptBlock
$script:steps = [Collections.Generic.List[string]]::new()
function Invoke-NexenScanStage {
    param([string]$Python, [string]$Entry, [string]$Stage)
    $script:steps.Add($Stage)
    foreach ($key in @('TEMP','TMP','APPDATA','LOCALAPPDATA','USERPROFILE','XDG_CACHE_HOME','PIP_CACHE_DIR','npm_config_cache')) {
        $value = [Environment]::GetEnvironmentVariable($key, 'Process')
        if (-not $value.StartsWith($PSScriptRoot + '\.nexen-runtime\')) { throw "Bad fixture child storage: $key" }
    }
    if ($env:PYTHONDONTWRITEBYTECODE -ne '1') { throw 'Bytecode guard missing' }
    if ($Entry -ne (Join-Path $PSScriptRoot 'nexen.py')) { throw 'Unexpected entry point' }
    if ($Stage -eq $env:NEXEN_FIXTURE_FAIL_STAGE) { throw 'Fixture stage failed' }
}
$before = (Get-Location).Path
try {
    EXTRA
    Invoke-NexenFirstScan -ApplicationRoot REQUESTED
    $result = 'ok'
} catch { $result = 'blocked' }
[pscustomobject]@{status=$result;steps=@($script:steps);location_preserved=((Get-Location).Path -eq $before)} | ConvertTo-Json -Compress
'''.replace('EXTRA', extra).replace('REQUESTED', requested), encoding='utf-8')
        env = os.environ.copy()
        env.pop('NEXEN_FIXTURE_FAIL_STAGE', None)
        for key in ('TEMP', 'TMP', 'APPDATA', 'LOCALAPPDATA', 'USERPROFILE'):
            env[key] = str(self.root)
        result = subprocess.run([str(SHELL), '-NoProfile', '-NonInteractive', '-File', str(driver)],
                                cwd=self.root, env=env, capture_output=True, text=True,
                                timeout=30, creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
        self.assertEqual(result.returncode, 0, result.stderr)
        return json.loads(result.stdout)

    def test_fixed_stages_use_guarded_environment_and_preserve_location(self):
        result = self.run_fixture()
        self.assertEqual(result, {'status': 'ok', 'steps': ['scan', 'tools', 'compile', 'jarvis'], 'location_preserved': True})

    def test_failure_does_not_run_later_stages(self):
        result = self.run_fixture("$env:NEXEN_FIXTURE_FAIL_STAGE = 'tools'")
        self.assertEqual(result['status'], 'blocked')
        self.assertEqual(result['steps'], ['scan', 'tools'])
        self.assertTrue(result['location_preserved'])

    def test_c_output_root_fails_before_stage_dispatch(self):
        result = self.run_fixture(requested="'C:\\nexen-must-not-create'")
        self.assertEqual(result['status'], 'blocked')
        self.assertEqual(result['steps'], [])

    def test_missing_entry_fails_before_stage_dispatch(self):
        (self.root / 'nexen.py').unlink()
        result = self.run_fixture()
        self.assertEqual(result['status'], 'blocked')
        self.assertEqual(result['steps'], [])

    def test_real_stage_stops_on_nonzero_mocked_native_exit(self):
        result = self.run_fixture(r'''
function Invoke-FixturePython { $global:LASTEXITCODE = 7 }
& $script:realStage -Python 'Invoke-FixturePython' -Entry (Join-Path $PSScriptRoot 'nexen.py') -Stage 'scan'
''')
        self.assertEqual(result['status'], 'blocked')
        self.assertEqual(result['steps'], [])


if __name__ == '__main__':
    unittest.main()

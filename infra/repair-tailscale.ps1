# Repair stuck Tailscale on Windows (NoState / duplicate tailscaled).
# Run as Administrator:
#   Set-ExecutionPolicy -Scope Process Bypass -Force
#   & "C:\Users\zionv\OneDrive\Desktop\Denizen\infra\repair-tailscale.ps1"

$ErrorActionPreference = 'Stop'
$ts = Join-Path $env:ProgramFiles 'Tailscale\tailscale.exe'

Write-Host '==> Stopping Tailscale service and GUI...'
Stop-Service Tailscale -Force -ErrorAction SilentlyContinue
taskkill /F /IM tailscaled.exe 2>$null
taskkill /F /IM tailscale-ipn.exe 2>$null
Start-Sleep -Seconds 3

Get-Process tailscaled, tailscale-ipn -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2

$left = @(Get-Process tailscaled -ErrorAction SilentlyContinue).Count
if ($left -gt 0) {
  Write-Host "ERROR: still $left tailscaled process(es). Reboot, then run this script again." -ForegroundColor Red
  exit 1
}

Write-Host '==> Starting Tailscale service (single daemon)...'
Start-Service Tailscale
Start-Sleep -Seconds 6

Write-Host '==> Logging out local state...'
& $ts logout 2>$null

Write-Host '==> Login - open the URL in your browser and approve Dolonia:'
& $ts login

Write-Host '==> Bringing tailnet up...'
& $ts up
Start-Sleep -Seconds 4

Write-Host ''
Write-Host '==> Status:'
& $ts status
Write-Host ''
Write-Host '==> This machine IP:'
& $ts ip -4

Write-Host ''
Write-Host '==> Ping Kali laptop:'
& $ts ping 100.110.205.49

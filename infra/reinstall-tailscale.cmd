@echo off
echo This will uninstall and reinstall Tailscale. Run as Administrator.
echo.
echo BEFORE continuing:
echo   1. Go to https://login.tailscale.com/admin/machines
echo   2. Remove the broken "dolonia" machine
echo.
pause

echo ==^> Uninstalling Tailscale...
winget uninstall --id Tailscale.Tailscale --accept-source-agreements --silent 2>nul
taskkill /F /IM tailscaled.exe 2>nul
taskkill /F /IM tailscale-ipn.exe 2>nul

echo.
echo ==^> REBOOT NOW, then run these commands in Admin CMD:
echo.
echo   winget install --id Tailscale.Tailscale --accept-package-agreements
echo   "C:\Program Files\Tailscale\tailscale.exe" login
echo   "C:\Program Files\Tailscale\tailscale.exe" up
echo   "C:\Program Files\Tailscale\tailscale.exe" ping <KALI_TAILSCALE_IP>
echo.
pause

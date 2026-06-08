@echo off
echo ==^> Ensure IP Helper is running...
sc query iphlpsvc | find "RUNNING" >nul || net start iphlpsvc

echo ==^> Stopping Tailscale...
net stop Tailscale
taskkill /F /IM tailscaled.exe 2>nul
taskkill /F /IM tailscale-ipn.exe 2>nul
timeout /t 5 /nobreak >nul

echo ==^> Starting Tailscale...
net start Tailscale
timeout /t 8 /nobreak >nul

echo ==^> Set Tailscale adapter to Private network...
powershell -NoProfile -Command "Set-NetConnectionProfile -InterfaceAlias 'Tailscale' -NetworkCategory Private -ErrorAction SilentlyContinue"

echo ==^> Login - open URL in browser:
"C:\Program Files\Tailscale\tailscale.exe" logout 2>nul
"C:\Program Files\Tailscale\tailscale.exe" login
"C:\Program Files\Tailscale\tailscale.exe" up
timeout /t 6 /nobreak >nul

echo.
echo ==^> Status:
"C:\Program Files\Tailscale\tailscale.exe" status
echo.
echo ==^> This IP:
"C:\Program Files\Tailscale\tailscale.exe" ip -4
echo.
echo ==^> Ping Kali:
"C:\Program Files\Tailscale\tailscale.exe" ping 100.110.205.49

echo.
echo If still NoState: REBOOT, then run reinstall-tailscale.cmd
pause

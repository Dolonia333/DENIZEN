@echo off
:: Start OpenClaw Gateway + Supabase Bridge
:: Run this script to start both services persistently.
:: They will keep running even after this window closes.

if "%AGENT_TOKEN%"=="" (
    echo ERROR: AGENT_TOKEN is not set. Set it in your environment first.
    exit /b 1
)

echo Starting Supabase Bridge on port 18790...
start "Supabase Bridge" /min cmd /c "cd /d C:\Users\zionv\OneDrive\Desktop\Denizen\openclaw\supabase-bridge && python secure-bridge.py"

echo Starting OpenClaw Gateway on port 18789...
start "OpenClaw Gateway" /min cmd /c "cd /d C:\Users\zionv\OneDrive\Desktop\Denizen\openclaw && set AGENT_TOKEN=%AGENT_TOKEN% && npm start -- gateway"

timeout /t 5 /nobreak >nul

echo.
echo Checking services...
netstat -ano | findstr "LISTENING" | findstr "18789 18790"
echo.
echo Both services should be running in minimized windows.
echo Close those windows to stop them.
pause

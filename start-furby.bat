@echo off
setlocal EnableDelayedExpansion
title Furby Boom Launcher
cd /d "%~dp0"

echo.
echo ==========================================
echo   Furby Boom - Virtual Pet Launcher
echo ==========================================
echo.

if not exist "English Boom - Audio" goto no_assets
if not exist "English Boom - Images" goto no_assets
echo [OK] Asset folders found

where node >nul 2>nul
if errorlevel 1 goto no_node
for /f "delims=" %%v in ('node -v') do set "NODE_VER=%%v"
echo [OK] Node.js !NODE_VER!

if exist "manifest.json" goto have_manifest
echo [..] Building manifest.json (first run only) ...
node tools\build-manifest.js
if errorlevel 1 goto build_failed
echo [OK] manifest.json created
goto port_search

:have_manifest
echo [OK] manifest.json found

:port_search
set PORT=8080
:try_port
netstat -ano | findstr /R /C:":!PORT! .*LISTENING" >nul 2>nul
if not errorlevel 1 (
    set /a PORT=PORT+1
    if !PORT! gtr 8090 goto no_port
    goto try_port
)
echo [OK] Port !PORT! is free

echo.
echo [..] Starting server on port !PORT! ...
start "Furby Boom Server" cmd /c "node tools\server.js !PORT!"

set TRIES=0
:wait_server
set /a TRIES=TRIES+1
timeout /t 1 /nobreak >nul 2>nul
powershell -NoProfile -Command "try { Invoke-WebRequest -UseBasicParsing -Uri 'http://localhost:!PORT!' -TimeoutSec 1 ^| Out-Null; exit 0 } catch { exit 1 }" >nul 2>nul
if not errorlevel 1 goto server_ready
if !TRIES! lss 15 goto wait_server
echo [WARN] Server slow, opening browser anyway

:server_ready
start "" "http://localhost:!PORT!"
echo.
echo [OK] Browser opened: http://localhost:!PORT!
echo      To open companion, use:  http://localhost:!PORT!/companion.html
echo      To stop: close the "Furby Boom Server" window.
timeout /t 4 /nobreak >nul 2>nul
exit /b 0

:no_assets
echo [ERROR] Asset folders not found.
echo Place this .bat next to "English Boom - Audio" and "English Boom - Images".
pause
exit /b 1

:no_node
echo [ERROR] Node.js not found. Install from https://nodejs.org
pause
exit /b 1

:build_failed
echo [ERROR] Failed to build manifest.json
pause
exit /b 1

:no_port
echo [ERROR] No free port in range 8080-8090
pause
exit /b 1
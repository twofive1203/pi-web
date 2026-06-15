@echo off
setlocal

set "ROOT=%~dp0.."

if /I "%~1"=="--help" goto help
if /I "%~1"=="-h" goto help
if /I "%~1"=="sessiond" goto sessiond
if /I "%~1"=="web" goto web
if /I "%~1"=="client" goto client
if /I "%~1"=="plugins" goto plugins
if not "%~1"=="" goto unknown

cd /d "%ROOT%" || exit /b 1
where bun >nul 2>nul
if errorlevel 1 (
  echo Bun is required for the OMP session daemon. Install Bun, then rerun this script.
  exit /b 1
)


echo Building plugins once before starting watchers...
call npm run build:plugins || exit /b %ERRORLEVEL%

echo Starting pi-web for Windows with OMP runtime.
echo Session daemon: http://127.0.0.1:8704
echo Web/API:        http://127.0.0.1:8504
echo Vite UI:        see the pi-web UI window output
echo.

start "pi-web sessiond OMP" "%COMSPEC%" /k ""%~f0" sessiond"
start "pi-web web API OMP" "%COMSPEC%" /k ""%~f0" web"
start "pi-web Vite UI" "%COMSPEC%" /k ""%~f0" client"
start "pi-web plugin watcher" "%COMSPEC%" /k ""%~f0" plugins"

echo Started 4 windows. Close those windows or press Ctrl+C inside each one to stop.
exit /b 0

:sessiond
cd /d "%ROOT%" || exit /b 1
set "PI_WEB_AGENT_RUNTIME=omp"
set "PI_WEB_SESSIOND_PORT=8704"
call npm run dev:sessiond:omp
exit /b %ERRORLEVEL%

:web
cd /d "%ROOT%" || exit /b 1
set "PI_WEB_SESSIOND_URL=http://127.0.0.1:8704"
call npx tsx watch scripts/start-omp-web.mjs
exit /b %ERRORLEVEL%

:client
cd /d "%ROOT%" || exit /b 1
call npm run dev:client
exit /b %ERRORLEVEL%

:plugins
cd /d "%ROOT%" || exit /b 1
call npm run dev:plugins
exit /b %ERRORLEVEL%

:help
echo Usage:
echo   scripts\start-windows.cmd
echo   npm run dev:windows
echo.
echo Starts the OMP-adapted local dev stack on Windows:
echo Requires Bun on PATH for the OMP session daemon.
echo   - session daemon on 127.0.0.1:8704
echo   - web/API on 127.0.0.1:8504
echo   - Vite client
echo   - plugin watcher
echo.
echo Optional internal modes: sessiond, web, client, plugins.
exit /b 0

:unknown
echo Unknown argument: %~1
echo Run scripts\start-windows.cmd --help for usage.
exit /b 2

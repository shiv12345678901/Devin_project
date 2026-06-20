@echo off
setlocal

:: ─── TextBro — One-click launcher ─────────────────────────────────────────
:: Double-click this file to start both backend and frontend, then open the
:: app in your default browser.

set "ROOT=%~dp0"
set "BACKEND_DIR=%ROOT%backend"
set "FRONTEND_DIR=%ROOT%frontend"
set "BACKEND_PORT=5055"
set "FRONTEND_PORT=5173"
set "BACKEND_URL=http://127.0.0.1:%BACKEND_PORT%"
set "FRONTEND_URL=http://127.0.0.1:%FRONTEND_PORT%"

echo.
echo  ========================================
echo       TextBro - Starting App
echo  ========================================
echo.

:: ─── Kill any existing processes on our ports ──────────────────────────────
echo [1/5] Clearing ports %BACKEND_PORT% and %FRONTEND_PORT%...
for /f "tokens=5" %%a in ('netstat -aon 2^>nul ^| findstr ":%BACKEND_PORT% " ^| findstr "LISTENING"') do (
    taskkill /F /PID %%a >nul 2>&1
)
for /f "tokens=5" %%a in ('netstat -aon 2^>nul ^| findstr ":%FRONTEND_PORT% " ^| findstr "LISTENING"') do (
    taskkill /F /PID %%a >nul 2>&1
)
timeout /t 2 /nobreak >nul

:: ─── Start Backend ─────────────────────────────────────────────────────────
echo [2/5] Starting backend on %BACKEND_URL%...

:: Create a small helper script so the backend window activates venv properly
(
echo @echo off
echo cd /d "%BACKEND_DIR%"
echo set "PORT=%BACKEND_PORT%"
echo if exist ".venv\Scripts\activate.bat" call ".venv\Scripts\activate.bat"
echo python start.py
echo echo.
echo echo Backend stopped. Press any key to close.
echo pause ^>nul
) > "%ROOT%_start_backend.bat"

start "TextBro Backend" cmd /c "%ROOT%_start_backend.bat"

:: ─── Wait for backend to be ready ──────────────────────────────────────────
echo [3/5] Waiting for backend...
set ATTEMPTS=0

:wait_backend
set /a ATTEMPTS+=1
if %ATTEMPTS% gtr 60 (
    echo.
    echo  ERROR: Backend did not start within 60 seconds.
    echo  Check the "TextBro Backend" window for errors.
    echo.
    pause
    exit /b 1
)
timeout /t 1 /nobreak >nul

:: Use PowerShell to check if backend is responding (works on all Windows 10+)
powershell -NoProfile -Command "try { $r = Invoke-WebRequest -Uri '%BACKEND_URL%/preflight' -UseBasicParsing -TimeoutSec 2; exit 0 } catch { exit 1 }" >nul 2>&1
if errorlevel 1 goto wait_backend

echo        Backend ready.

:: ─── Start Frontend ────────────────────────────────────────────────────────
echo [4/5] Starting frontend on %FRONTEND_URL%...

:: Ensure .env.local has the correct backend URL for Vite proxy
echo VITE_BACKEND_URL=%BACKEND_URL%> "%FRONTEND_DIR%\.env.local"

:: Create a small helper script for the frontend too
(
echo @echo off
echo cd /d "%FRONTEND_DIR%"
echo set "VITE_BACKEND_URL=%BACKEND_URL%"
echo npx vite --host 127.0.0.1 --port %FRONTEND_PORT% --strictPort
) > "%ROOT%_start_frontend.bat"

start "TextBro Frontend" /min cmd /c "%ROOT%_start_frontend.bat"

:: ─── Wait for frontend to be ready ─────────────────────────────────────────
echo [5/5] Waiting for frontend...
set ATTEMPTS=0

:wait_frontend
set /a ATTEMPTS+=1
if %ATTEMPTS% gtr 45 (
    echo.
    echo  ERROR: Frontend did not start within 45 seconds.
    echo  Check the "TextBro Frontend" window for errors.
    echo.
    pause
    exit /b 1
)
timeout /t 1 /nobreak >nul

powershell -NoProfile -Command "try { $r = Invoke-WebRequest -Uri '%FRONTEND_URL%/' -UseBasicParsing -TimeoutSec 2; exit 0 } catch { exit 1 }" >nul 2>&1
if errorlevel 1 goto wait_frontend

echo        Frontend ready.

:: ─── Open browser ──────────────────────────────────────────────────────────
echo.
echo  ----------------------------------------
echo   App running at %FRONTEND_URL%
echo   Opening in browser...
echo  ----------------------------------------
echo.
start "" "%FRONTEND_URL%"

echo  Press any key to stop both servers and exit.
pause >nul

:: ─── Cleanup ───────────────────────────────────────────────────────────────
echo Shutting down...
for /f "tokens=5" %%a in ('netstat -aon 2^>nul ^| findstr ":%BACKEND_PORT% " ^| findstr "LISTENING"') do (
    taskkill /F /PID %%a >nul 2>&1
)
for /f "tokens=5" %%a in ('netstat -aon 2^>nul ^| findstr ":%FRONTEND_PORT% " ^| findstr "LISTENING"') do (
    taskkill /F /PID %%a >nul 2>&1
)

:: Clean up temp scripts
del "%ROOT%_start_backend.bat" >nul 2>&1
del "%ROOT%_start_frontend.bat" >nul 2>&1

echo Done.

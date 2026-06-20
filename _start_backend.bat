@echo off
cd /d "D:\test\Devin_project\backend"
set "PORT=5055"
if exist ".venv\Scripts\activate.bat" call ".venv\Scripts\activate.bat"
python start.py
echo.
echo Backend stopped. Press any key to close.
pause >nul

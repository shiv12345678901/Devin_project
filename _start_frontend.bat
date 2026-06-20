@echo off
cd /d "D:\test\Devin_project\frontend"
set "VITE_BACKEND_URL=http://127.0.0.1:5055"
npx vite --host 127.0.0.1 --port 5173 --strictPort

@echo off
cd /d "%~dp0\.."

timeout /t 1 /nobreak >nul
powershell -NoProfile -Command "$root = (Resolve-Path .).Path; $pattern = [Regex]::Escape($root) + '\\server\\index.js'; Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { $_.CommandLine -and $_.CommandLine -match $pattern } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }"
timeout /t 1 /nobreak >nul

start "DEV SERVER" cmd /c "node scripts\\start-server.js"
start "DEV CLIENT" cmd /c "node node_modules\\vite\\bin\\vite.js"

@echo off
cd /d "%~dp0.."
powershell -NoProfile -WindowStyle Hidden -Command "Start-Process -WindowStyle Hidden -FilePath node -ArgumentList 'scripts\\launcher-server.js' -WorkingDirectory '%cd%'"

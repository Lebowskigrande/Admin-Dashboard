@echo off
cd /d "%~dp0"

rem Start server in its own window
start "DEV SERVER" cmd /c "npm run dev:server"
start "DEV CLIENT" cmd /c "npm run dev:client"

rem Open a separate shell in the project folder
start "PROJECT SHELL" cmd /k "cd /d %~dp0"

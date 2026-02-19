@echo off
echo Starting Atlas Bridge Server...
powershell -ExecutionPolicy Bypass -File "%~dp0start-bridge.ps1"
pause

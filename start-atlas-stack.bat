@echo off
echo Starting Atlas Stack...
powershell -ExecutionPolicy Bypass -File "%~dp0start-atlas-stack.ps1" %*
pause

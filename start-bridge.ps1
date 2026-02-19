# Atlas Bridge Server Startup
# stdio-to-WebSocket adapter for Claude Code <-> Chrome Extension
# Logs to data/logs/atlas-bridge.log for supervisor monitoring

$logDir = "C:\github\atlas\apps\telegram\data\logs"
$logFile = "$logDir\atlas-bridge.log"

New-Item -ItemType Directory -Force -Path $logDir | Out-Null

Write-Host "Starting Atlas Bridge Server..." -ForegroundColor Cyan
Write-Host "WebSocket: ws://localhost:3848" -ForegroundColor DarkGray
Write-Host "Log file: $logFile" -ForegroundColor DarkGray
Write-Host "Follow logs: Get-Content -Wait '$logFile'" -ForegroundColor DarkGray
Write-Host ""

Set-Location C:\github\atlas
& 'C:\Users\jimca\.bun\bin\bun.exe' run packages/bridge/src/server.ts 2>&1 | Tee-Object -FilePath $logFile -Append

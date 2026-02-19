# Atlas Telegram Bot Startup
# Logs to data/logs/atlas-bot.log for supervisor monitoring

$logDir = "C:\github\atlas\apps\telegram\data\logs"
$logFile = "$logDir\atlas-bot.log"

New-Item -ItemType Directory -Force -Path $logDir | Out-Null

Write-Host "Starting Atlas Telegram Bot..." -ForegroundColor Cyan
Write-Host "Log file: $logFile" -ForegroundColor DarkGray
Write-Host "Follow logs: Get-Content -Wait '$logFile'" -ForegroundColor DarkGray
Write-Host ""

Set-Location C:\github\atlas\apps\telegram
& 'C:\Users\jimca\.bun\bin\bun.exe' run start 2>&1 | Tee-Object -FilePath $logFile -Append

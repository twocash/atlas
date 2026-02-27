# Atlas Telegram Bot Startup
# Logs to data/logs/atlas-bot.log for supervisor monitoring

$logDir = "C:\github\atlas\apps\telegram\data\logs"
$logFile = "$logDir\atlas-bot.log"

New-Item -ItemType Directory -Force -Path $logDir | Out-Null

# Load root .env (AnythingLLM and other infra vars live here, not in apps/telegram/.env)
# Bot's dotenv loads apps/telegram/.env internally; this injects root-level vars
$rootEnv = "C:\github\atlas\.env"
if (Test-Path $rootEnv) {
    $loaded = 0
    Get-Content $rootEnv | ForEach-Object {
        $line = $_.Trim()
        if ($line -and -not $line.StartsWith('#')) {
            $eqIndex = $line.IndexOf('=')
            if ($eqIndex -gt 0) {
                $key = $line.Substring(0, $eqIndex).Trim()
                $val = $line.Substring($eqIndex + 1).Trim()
                if (($val.StartsWith('"') -and $val.EndsWith('"')) -or
                    ($val.StartsWith("'") -and $val.EndsWith("'"))) {
                    $val = $val.Substring(1, $val.Length - 2)
                }
                # Only set if not already defined (telegram .env / system env takes precedence)
                if (-not [System.Environment]::GetEnvironmentVariable($key)) {
                    [System.Environment]::SetEnvironmentVariable($key, $val, 'Process')
                    $loaded++
                }
            }
        }
    }
    Write-Host "Loaded $loaded env vars from root .env" -ForegroundColor DarkGray
} else {
    Write-Host "WARNING: $rootEnv not found - RAG and infra features may be unavailable" -ForegroundColor Yellow
}

Write-Host "Starting Atlas Telegram Bot..." -ForegroundColor Cyan
Write-Host "Log file: $logFile" -ForegroundColor DarkGray
Write-Host "Follow logs: Get-Content -Wait '$logFile'" -ForegroundColor DarkGray
Write-Host ""

Set-Location C:\github\atlas\apps\telegram
& 'C:\Users\jimca\.bun\bin\bun.exe' run start 2>&1 | Tee-Object -FilePath $logFile -Append

# Atlas Bridge Server Startup
# stdio-to-WebSocket adapter for Claude Code <-> Chrome Extension
# Logs to data/logs/atlas-bridge.log for supervisor monitoring

$logDir = "C:\github\atlas\apps\telegram\data\logs"
$logFile = "$logDir\atlas-bridge.log"

New-Item -ItemType Directory -Force -Path $logDir | Out-Null

# Load .env from apps/telegram/.env (same source the bot uses via dotenv)
# Bridge has no dotenv loader - we inject env vars here before launch
$envFile = "C:\github\atlas\apps\telegram\.env"
if (Test-Path $envFile) {
    $loaded = 0
    Get-Content $envFile | ForEach-Object {
        $line = $_.Trim()
        # Skip comments and blank lines
        if ($line -and -not $line.StartsWith('#')) {
            $eqIndex = $line.IndexOf('=')
            if ($eqIndex -gt 0) {
                $key = $line.Substring(0, $eqIndex).Trim()
                $val = $line.Substring($eqIndex + 1).Trim()
                # Strip surrounding quotes (single or double)
                if (($val.StartsWith('"') -and $val.EndsWith('"')) -or
                    ($val.StartsWith("'") -and $val.EndsWith("'"))) {
                    $val = $val.Substring(1, $val.Length - 2)
                }
                # Only set if not already defined (system env takes precedence)
                if (-not [System.Environment]::GetEnvironmentVariable($key)) {
                    [System.Environment]::SetEnvironmentVariable($key, $val, 'Process')
                    $loaded++
                }
            }
        }
    }
    Write-Host "Loaded $loaded env vars from .env" -ForegroundColor DarkGray
} else {
    Write-Host "WARNING: $envFile not found - bridge may lack API keys" -ForegroundColor Yellow
}

Write-Host "Starting Atlas Bridge Server..." -ForegroundColor Cyan
Write-Host "WebSocket: ws://localhost:3848" -ForegroundColor DarkGray
Write-Host "Log file: $logFile" -ForegroundColor DarkGray
Write-Host "Follow logs: Get-Content -Wait '$logFile'" -ForegroundColor DarkGray
Write-Host ""

Set-Location C:\github\atlas
& 'C:\Users\jimca\.bun\bin\bun.exe' run packages/bridge/src/server.ts 2>&1 | Tee-Object -FilePath $logFile -Append

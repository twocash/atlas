# Atlas Bridge Server Startup
# stdio-to-WebSocket adapter for Claude Code <-> Chrome Extension
# Logs to data/logs/atlas-bridge.log for supervisor monitoring

$logDir = "C:\github\atlas\apps\telegram\data\logs"
$logFile = "$logDir\atlas-bridge.log"

New-Item -ItemType Directory -Force -Path $logDir | Out-Null

# Load root .env first (AnythingLLM and other infra vars)
# Then telegram .env (API keys, Notion, etc.) - telegram vars take precedence
foreach ($envEntry in @(
    @{ Path = "C:\github\atlas\.env"; Label = "root" },
    @{ Path = "C:\github\atlas\apps\telegram\.env"; Label = "telegram" }
)) {
    $envFile = $envEntry.Path
    $label = $envEntry.Label
    if (Test-Path $envFile) {
        $loaded = 0
        Get-Content $envFile | ForEach-Object {
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
                    # Only set if not already defined (later files and system env take precedence)
                    if (-not [System.Environment]::GetEnvironmentVariable($key)) {
                        [System.Environment]::SetEnvironmentVariable($key, $val, 'Process')
                        $loaded++
                    }
                }
            }
        }
        Write-Host "Loaded $loaded env vars from $label .env" -ForegroundColor DarkGray
    } else {
        Write-Host "WARNING: $envFile not found" -ForegroundColor Yellow
    }
}

Write-Host "Starting Atlas Bridge Server..." -ForegroundColor Cyan
Write-Host "WebSocket: ws://localhost:3848" -ForegroundColor DarkGray
Write-Host "Log file: $logFile" -ForegroundColor DarkGray
Write-Host "Follow logs: Get-Content -Wait '$logFile'" -ForegroundColor DarkGray
Write-Host ""

Set-Location C:\github\atlas
& 'C:\Users\jimca\.bun\bin\bun.exe' run packages/bridge/src/server.ts 2>&1 | Tee-Object -FilePath $logFile -Append

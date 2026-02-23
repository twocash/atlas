# Atlas Stack - Unified Startup
# Launches all 3 components: AnythingLLM, Telegram Bot, Bridge Server
# Each long-running process gets its own terminal window for log visibility.

param(
    [switch]$SkipAnythingLLM,
    [switch]$SkipBot,
    [switch]$SkipBridge
)

$ErrorActionPreference = 'Continue'
$bunExe = 'C:\Users\jimca\.bun\bin\bun.exe'
$atlasRoot = 'C:\github\atlas'

Write-Host ""
Write-Host "  ATLAS STACK STARTUP" -ForegroundColor Cyan
Write-Host "  ===================" -ForegroundColor Cyan
Write-Host ""

# --- 1. AnythingLLM (RAG server) ---

if (-not $SkipAnythingLLM) {
    Write-Host "[1/3] AnythingLLM..." -NoNewline -ForegroundColor White

    # Check if already running
    $ping = $null
    try { $ping = Invoke-RestMethod -Uri "http://localhost:3001/api/ping" -TimeoutSec 3 -ErrorAction SilentlyContinue } catch {}

    if ($ping.online) {
        Write-Host " already running" -ForegroundColor Green
    } else {
        Start-Process 'C:\Users\jimca\AppData\Local\Programs\AnythingLLM\AnythingLLM.exe'
        Write-Host " launched, waiting..." -NoNewline -ForegroundColor Yellow

        $attempts = 0
        $maxAttempts = 12  # 12 x 2.5s = 30s max
        $online = $false
        while ($attempts -lt $maxAttempts) {
            Start-Sleep -Milliseconds 2500
            try {
                $ping = Invoke-RestMethod -Uri "http://localhost:3001/api/ping" -TimeoutSec 3 -ErrorAction SilentlyContinue
                if ($ping.online) { $online = $true; break }
            } catch {}
            $attempts++
            Write-Host "." -NoNewline -ForegroundColor Yellow
        }

        if ($online) {
            Write-Host " online" -ForegroundColor Green
        } else {
            Write-Host " FAILED (continuing anyway - RAG is non-critical)" -ForegroundColor Red
        }
    }
} else {
    Write-Host "[1/3] AnythingLLM... skipped" -ForegroundColor DarkGray
}

# --- 2. Telegram Bot ---

if (-not $SkipBot) {
    Write-Host "[2/3] Telegram Bot..." -NoNewline -ForegroundColor White

    # Check if already running via lock file
    $lockFile = "$atlasRoot\apps\telegram\data\.atlas.lock"
    $alreadyRunning = $false
    if (Test-Path $lockFile) {
        $lockPid = (Get-Content $lockFile -ErrorAction SilentlyContinue).Trim()
        if ($lockPid) {
            $proc = Get-Process -Id $lockPid -ErrorAction SilentlyContinue
            if ($proc) { $alreadyRunning = $true }
        }
    }

    if ($alreadyRunning) {
        Write-Host " already running (PID $lockPid)" -ForegroundColor Green
    } else {
        Start-Process powershell -ArgumentList "-ExecutionPolicy Bypass -File `"$atlasRoot\start-telegram.ps1`""
        Write-Host " terminal opened" -ForegroundColor Green
    }
} else {
    Write-Host "[2/3] Telegram Bot... skipped" -ForegroundColor DarkGray
}

# --- 3. Bridge Server ---

if (-not $SkipBridge) {
    Write-Host "[3/3] Bridge Server..." -NoNewline -ForegroundColor White

    # Check if already running via port
    $bridgeListening = netstat -ano 2>$null | Select-String ":3848.*LISTENING"

    if ($bridgeListening) {
        Write-Host " already running (port 3848)" -ForegroundColor Green
    } else {
        Start-Process powershell -ArgumentList "-ExecutionPolicy Bypass -File `"$atlasRoot\start-bridge.ps1`""
        Write-Host " terminal opened" -ForegroundColor Green
    }
} else {
    Write-Host "[3/3] Bridge Server... skipped" -ForegroundColor DarkGray
}

# --- Summary ---

Write-Host ""
Write-Host "  Stack launched. Use /atlas-supervisor in Claude Code to monitor." -ForegroundColor DarkGray
Write-Host "  Flags: -SkipAnythingLLM  -SkipBot  -SkipBridge" -ForegroundColor DarkGray
Write-Host ""

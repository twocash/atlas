# Install Atlas Startup Tasks - Windows Task Scheduler
# Runs Atlas Telegram Bot and Bridge at system startup (before login)
# Requires: Run as Administrator
#
# Usage: powershell -ExecutionPolicy Bypass -File scripts\install-atlas-startup-tasks.ps1

$ErrorActionPreference = "Stop"

# ── Config ──────────────────────────────────────────────
$atlasRoot = "C:\github\atlas"
$bunExe = "C:\Users\jimca\.bun\bin\bun.exe"
$logDir = "$atlasRoot\apps\telegram\data\logs"
$user = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name  # Auto-detect account

# Startup delay: Docker Desktop + Ollama + AnythingLLM container need time
$startupDelayBot = "PT90S"     # 90 seconds for bot
$startupDelayBridge = "PT120S" # 120 seconds for bridge (after bot)

# ── Preflight ───────────────────────────────────────────

# Check admin
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Host "ERROR: Must run as Administrator" -ForegroundColor Red
    Write-Host "Right-click PowerShell -> Run as Administrator, then re-run this script" -ForegroundColor Yellow
    exit 1
}

if (-not (Test-Path $bunExe)) {
    Write-Host "ERROR: bun not found at $bunExe" -ForegroundColor Red
    exit 1
}

New-Item -ItemType Directory -Force -Path $logDir | Out-Null

# ── Task 1: Atlas Telegram Bot ──────────────────────────

$taskNameBot = "Atlas Telegram Bot"

Write-Host "Creating task: $taskNameBot" -ForegroundColor Cyan

# Remove existing task if present
if (Get-ScheduledTask -TaskName $taskNameBot -ErrorAction SilentlyContinue) {
    Unregister-ScheduledTask -TaskName $taskNameBot -Confirm:$false
    Write-Host "  Removed existing task" -ForegroundColor DarkGray
}

$triggerBot = New-ScheduledTaskTrigger -AtStartup
$triggerBot.Delay = $startupDelayBot

$actionBot = New-ScheduledTaskAction `
    -Execute "powershell.exe" `
    -Argument "-ExecutionPolicy Bypass -WindowStyle Normal -File `"$atlasRoot\start-telegram.ps1`"" `
    -WorkingDirectory $atlasRoot

$settingsBot = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -RestartCount 3 `
    -RestartInterval (New-TimeSpan -Minutes 5) `
    -ExecutionTimeLimit (New-TimeSpan -Days 365)

Register-ScheduledTask `
    -TaskName $taskNameBot `
    -Trigger $triggerBot `
    -Action $actionBot `
    -Settings $settingsBot `
    -Description "Atlas Telegram Bot - cognitive co-pilot. Starts at boot with 90s delay for Docker/Ollama." `
    -RunLevel Highest `
    -User $user `
    -Force | Out-Null

Write-Host "  Registered: $taskNameBot (delay: 90s)" -ForegroundColor Green

# ── Task 2: Atlas Bridge ────────────────────────────────

$taskNameBridge = "Atlas Bridge"

Write-Host "Creating task: $taskNameBridge" -ForegroundColor Cyan

if (Get-ScheduledTask -TaskName $taskNameBridge -ErrorAction SilentlyContinue) {
    Unregister-ScheduledTask -TaskName $taskNameBridge -Confirm:$false
    Write-Host "  Removed existing task" -ForegroundColor DarkGray
}

$triggerBridge = New-ScheduledTaskTrigger -AtStartup
$triggerBridge.Delay = $startupDelayBridge

$actionBridge = New-ScheduledTaskAction `
    -Execute "powershell.exe" `
    -Argument "-ExecutionPolicy Bypass -WindowStyle Normal -File `"$atlasRoot\start-bridge.ps1`"" `
    -WorkingDirectory $atlasRoot

$settingsBridge = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -RestartCount 3 `
    -RestartInterval (New-TimeSpan -Minutes 5) `
    -ExecutionTimeLimit (New-TimeSpan -Days 365)

Register-ScheduledTask `
    -TaskName $taskNameBridge `
    -Trigger $triggerBridge `
    -Action $actionBridge `
    -Settings $settingsBridge `
    -Description "Atlas Bridge - stdio-to-WebSocket adapter. Starts at boot with 120s delay." `
    -RunLevel Highest `
    -User $user `
    -Force | Out-Null

Write-Host "  Registered: $taskNameBridge (delay: 120s)" -ForegroundColor Green

# ── Summary ─────────────────────────────────────────────

Write-Host ""
Write-Host "Startup chain on reboot:" -ForegroundColor Cyan
Write-Host "  1. Windows services (Docker Desktop, Ollama)" -ForegroundColor White
Write-Host "  2. Docker container auto-restart (AnythingLLM)" -ForegroundColor White
Write-Host "  3. +90s  -> Atlas Telegram Bot" -ForegroundColor White
Write-Host "  4. +120s -> Atlas Bridge" -ForegroundColor White
Write-Host ""
Write-Host "Manage tasks:" -ForegroundColor DarkGray
Write-Host "  Start-ScheduledTask -TaskName '$taskNameBot'" -ForegroundColor DarkGray
Write-Host "  Stop-ScheduledTask -TaskName '$taskNameBot'" -ForegroundColor DarkGray
Write-Host "  Get-ScheduledTask -TaskName 'Atlas*' | Format-Table" -ForegroundColor DarkGray
Write-Host ""
Write-Host "Done." -ForegroundColor Green

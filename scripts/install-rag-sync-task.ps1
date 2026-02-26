# install-rag-sync-task.ps1 - Idempotent Task Scheduler installer for RAG Sync
#
# Creates or updates a Windows Task Scheduler job that runs rag-sync.ts every 15 minutes.
# Run as Administrator for "run whether user is logged in or not" capability.
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File scripts\install-rag-sync-task.ps1
#   powershell -ExecutionPolicy Bypass -File scripts\install-rag-sync-task.ps1 -Remove

param(
    [switch]$Remove
)

$TaskName = "Atlas RAG Sync"
$BunPath = "C:\Users\jimca\.bun\bin\bun.exe"
$ScriptPath = "C:\github\atlas\scripts\rag-sync.ts"
$WorkDir = "C:\github\atlas"

# Remove mode
if ($Remove) {
    $existing = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    if ($existing) {
        Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
        Write-Host "[OK] Removed scheduled task: $TaskName"
    } else {
        Write-Host "[INFO] Task not found: $TaskName"
    }
    exit 0
}

# Validate prerequisites
if (-not (Test-Path $BunPath)) {
    Write-Error "Bun not found at $BunPath"
    exit 1
}

if (-not (Test-Path $ScriptPath)) {
    Write-Error "Script not found at $ScriptPath"
    exit 1
}

# Build the task definition
$action = New-ScheduledTaskAction `
    -Execute $BunPath `
    -Argument "run $ScriptPath" `
    -WorkingDirectory $WorkDir

# Every 15 minutes, indefinitely (9999 days is effectively forever, MaxValue overflows Task Scheduler XML)
$trigger = New-ScheduledTaskTrigger `
    -Once `
    -At (Get-Date).Date `
    -RepetitionInterval (New-TimeSpan -Minutes 15) `
    -RepetitionDuration (New-TimeSpan -Days 9999)

$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 10) `
    -RestartCount 3 `
    -RestartInterval (New-TimeSpan -Minutes 5)

# Check if task already exists
$existing = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue

if ($existing) {
    # Update existing task
    Set-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings | Out-Null
    Write-Host "[OK] Updated existing scheduled task: $TaskName"
} else {
    # Create new task
    Register-ScheduledTask `
        -TaskName $TaskName `
        -Action $action `
        -Trigger $trigger `
        -Settings $settings `
        -Description "Sync client documents to AnythingLLM workspaces for RAG retrieval. Runs every 15 minutes." `
        -RunLevel Limited | Out-Null
    Write-Host "[OK] Created scheduled task: $TaskName"
}

Write-Host ""
Write-Host "Task details:"
Write-Host "  Name:      $TaskName"
Write-Host "  Action:    $BunPath run $ScriptPath"
Write-Host "  Schedule:  Every 15 minutes"
Write-Host "  Work dir:  $WorkDir"
Write-Host ""
Write-Host "To run manually:  schtasks /run /tn '$TaskName'"
Write-Host "To check status:  schtasks /query /tn '$TaskName' /fo list"
Write-Host "To remove:        powershell -File scripts\install-rag-sync-task.ps1 -Remove"

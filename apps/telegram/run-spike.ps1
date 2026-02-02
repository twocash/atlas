# Run spike tests with .env loaded
param([string]$TestFile)

# Change to script directory
Set-Location $PSScriptRoot

if (-not $TestFile) {
    Write-Host "Usage: .\run-spike.ps1 <test-file>"
    Write-Host "Example: .\run-spike.ps1 test/classify-first-spike.ts"
    exit 1
}

# Load .env file
$envFile = Join-Path $PSScriptRoot ".env"
if (Test-Path $envFile) {
    Get-Content $envFile | ForEach-Object {
        if ($_ -match '^([^#][^=]*)=(.*)$') {
            $name = $matches[1].Trim()
            $value = $matches[2].Trim()
            [Environment]::SetEnvironmentVariable($name, $value)
            Write-Host "Loaded: $name"
        }
    }
} else {
    Write-Host "Warning: .env file not found at $envFile"
}

# Verify critical env vars
if (-not $env:NOTION_API_KEY) {
    Write-Host "ERROR: NOTION_API_KEY not set"
    exit 1
}

Write-Host "`nRunning spike test: $TestFile`n"
& "$env:USERPROFILE\.bun\bin\bun.exe" $TestFile

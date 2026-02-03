# Comprehensive test suite for Atlas Telegram
# Runs all tests with production environment variables

Set-Location $PSScriptRoot

# Load .env file
$envFile = Join-Path $PSScriptRoot ".env"
if (Test-Path $envFile) {
    Get-Content $envFile | ForEach-Object {
        if ($_ -match '^([^#][^=]*)=(.*)$') {
            $name = $matches[1].Trim()
            $value = $matches[2].Trim()
            [Environment]::SetEnvironmentVariable($name, $value)
        }
    }
    Write-Host "Environment loaded from .env"
} else {
    Write-Host "ERROR: .env file not found"
    exit 1
}

# Verify critical env vars
if (-not $env:NOTION_API_KEY) {
    Write-Host "ERROR: NOTION_API_KEY not set"
    exit 1
}

$bun = "$env:USERPROFILE\.bun\bin\bun.exe"
$failed = @()

Write-Host ""
Write-Host "=========================================="
Write-Host "ATLAS COMPREHENSIVE TEST SUITE"
Write-Host "=========================================="
Write-Host ""

# 1. TypeCheck
Write-Host "1. TYPECHECK - Verifying TypeScript compilation"
Write-Host "-------------------------------------------"
& $bun run typecheck 2>&1
if ($LASTEXITCODE -ne 0) { $failed += "TypeCheck" }
Write-Host ""

# 2. Unit Tests (bun test)
Write-Host "2. UNIT TESTS - Running bun test"
Write-Host "-------------------------------------------"
& $bun test 2>&1
if ($LASTEXITCODE -ne 0) { $failed += "Unit Tests" }
Write-Host ""

# 3. Notion Connection Test
Write-Host "3. NOTION CONNECTION - Testing database access"
Write-Host "-------------------------------------------"
& $bun run src/test-notion.ts 2>&1
if ($LASTEXITCODE -ne 0) { $failed += "Notion Connection" }
Write-Host ""

# 4. Claude Connection Test
Write-Host "4. CLAUDE CONNECTION - Testing API access"
Write-Host "-------------------------------------------"
& $bun run src/test-claude.ts 2>&1
if ($LASTEXITCODE -ne 0) { $failed += "Claude Connection" }
Write-Host ""

# 5. Preflight Check
Write-Host "5. PREFLIGHT CHECK - Critical systems validation"
Write-Host "-------------------------------------------"
& $bun run scripts/preflight-check.ts 2>&1
if ($LASTEXITCODE -ne 0) { $failed += "Preflight Check" }
Write-Host ""

# 6. Health / E2E Tests
Write-Host "6. HEALTH/E2E - Full system health check"
Write-Host "-------------------------------------------"
& $bun run src/health/test-runner.ts 2>&1
if ($LASTEXITCODE -ne 0) { $failed += "Health/E2E Tests" }
Write-Host ""

# 7. Database Schema Validation
Write-Host "7. DB SCHEMA - Validating database schemas"
Write-Host "-------------------------------------------"
if (Test-Path "scripts/validate-db-schema.ts") {
    & $bun run scripts/validate-db-schema.ts 2>&1
    if ($LASTEXITCODE -ne 0) { $failed += "DB Schema Validation" }
} else {
    Write-Host "Schema validation script not found, skipping"
}
Write-Host ""

# Summary
Write-Host "=========================================="
Write-Host "TEST SUMMARY"
Write-Host "=========================================="
if ($failed.Count -eq 0) {
    Write-Host "ALL TESTS PASSED" -ForegroundColor Green
} else {
    Write-Host "FAILURES DETECTED:" -ForegroundColor Red
    foreach ($f in $failed) {
        Write-Host "  - $f" -ForegroundColor Red
    }
}
Write-Host ""

# Run this as Administrator (right-click > Run as Administrator)
# Adds der-tier's SSH key and enables ~/.ssh/authorized_keys for admin users

# 1. Add der-tier key to admin authorized_keys
$key = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIJWGz1w3m2n3ijCvdqOBqpeEo6z6zzicRakVMQ6npTmI jim@DER-TIER"
$adminKeys = "C:\ProgramData\ssh\administrators_authorized_keys"
if (!(Select-String -Path $adminKeys -Pattern "DER-TIER" -Quiet)) {
    Add-Content -Path $adminKeys -Value $key
    Write-Host "Added der-tier key to $adminKeys" -ForegroundColor Green
} else {
    Write-Host "der-tier key already present in $adminKeys" -ForegroundColor Yellow
}

# 2. Comment out admin override so ~/.ssh/authorized_keys also works
$config = "C:\ProgramData\ssh\sshd_config"
$content = Get-Content $config -Raw
if ($content -match "(?m)^Match Group administrators") {
    $content = $content -replace "(?m)^Match Group administrators", "#Match Group administrators"
    $content = $content -replace "(?m)^       AuthorizedKeysFile __PROGRAMDATA__/ssh/administrators_authorized_keys", "#       AuthorizedKeysFile __PROGRAMDATA__/ssh/administrators_authorized_keys"
    Set-Content -Path $config -Value $content
    Write-Host "Disabled admin key override in sshd_config" -ForegroundColor Green
} else {
    Write-Host "Admin override already disabled" -ForegroundColor Yellow
}

# 3. Restart SSH service
Restart-Service sshd
Write-Host "sshd restarted" -ForegroundColor Green
Write-Host ""
Write-Host "Done! From der-tier, run: ssh jimca@grove-node-1" -ForegroundColor Cyan
pause

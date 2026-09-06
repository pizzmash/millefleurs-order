param(
    [Parameter(Mandatory = $true)]
    [string]$Distro,
    [int]$Port = 3001,
    [string]$LanAddress = ''
)
$ErrorActionPreference = 'Stop'
$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $admin) { throw 'Run this script in an Administrator PowerShell window.' }
if ($Port -lt 1024 -or $Port -gt 65535) { throw 'Choose a port between 1024 and 65535.' }
if (-not $LanAddress) {
    $addresses = @(Get-NetIPConfiguration | Where-Object { $_.IPv4DefaultGateway } | ForEach-Object { $_.IPv4Address.IPAddress })
    if ($addresses.Count -ne 1) { throw 'Multiple/no LAN addresses found. Specify -LanAddress explicitly.' }
    $LanAddress = $addresses[0]
}
$parsed = [System.Net.IPAddress]::Parse($LanAddress)
if ($parsed.AddressFamily -ne [System.Net.Sockets.AddressFamily]::InterNetwork) { throw 'LanAddress must be IPv4.' }
$mode = (& wsl.exe -d $Distro -- wslinfo --networking-mode | Out-String).Trim()
if ($LASTEXITCODE -ne 0) { throw 'Cannot determine WSL networking mode.' }
if ($mode -ne 'nat') { throw "This script supports NAT mode only (current: $mode). See README for mirrored networking." }
$addressInfo = (& wsl.exe -d $Distro -- ip -4 -o addr show dev eth0 | Out-String)
if ($LASTEXITCODE -ne 0 -or $addressInfo -notmatch 'inet\s+(\d+\.\d+\.\d+\.\d+)') { throw 'Cannot determine WSL eth0 address.' }
$WslAddress = $Matches[1]
$rules = (& netsh interface portproxy show v4tov4 | Out-String)
$conflict = @($rules -split "`n" | Where-Object { $_ -match "^\s*(0\.0\.0\.0|$([regex]::Escape($LanAddress)))\s+$Port\s+" })
$expected = "^\s*$([regex]::Escape($LanAddress))\s+$Port\s+$([regex]::Escape($WslAddress))\s+$Port\s*$"
if ($conflict -and ($conflict.Count -ne 1 -or $conflict[0] -notmatch $expected)) {
    throw "A different port forwarding rule already uses port $Port. Review it manually; no forwarding changes were made."
}
if (-not $conflict) {
    & netsh interface portproxy add v4tov4 listenaddress=$LanAddress listenport=$Port connectaddress=$WslAddress connectport=$Port
    if ($LASTEXITCODE -ne 0) { throw 'Failed to add port forwarding.' }
}
$ruleName = "Milleflewrs-HomeBar-$Port"
$rule = Get-NetFirewallRule -Name $ruleName -ErrorAction SilentlyContinue
if (-not $rule) {
    New-NetFirewallRule -Name $ruleName -DisplayName "Milleflewrs Home Bar ($Port)" -Direction Inbound -Action Allow -Protocol TCP -LocalPort $Port -LocalAddress $LanAddress -RemoteAddress LocalSubnet -Profile Any | Out-Null
} else {
    Write-Host "Firewall rule $ruleName already exists; its settings were preserved."
}
Write-Host "Guest URL: http://${LanAddress}:$Port"
Write-Host 'Use the same URL for PUBLIC_URL in .env, then restart the app.'
Write-Host "WSL target: ${WslAddress}:$Port. Recheck after WSL restarts."

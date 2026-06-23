param(
    [string]$TaskName = "WAI-EnsureRunning"
)

$ErrorActionPreference = "Stop"

$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw "Run this script as Administrator."
}

$Root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$EnsureScript = Join-Path $PSScriptRoot "ensure-wai-running.ps1"
$powershell = (Get-Command powershell.exe).Source
$command = "`"$powershell`" -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$EnsureScript`""

$prevEap = $ErrorActionPreference
$ErrorActionPreference = "Continue"
foreach ($name in @($TaskName, "${TaskName}-Monitor")) {
    schtasks /Delete /TN $name /F *> $null
}
$ErrorActionPreference = $prevEap

schtasks /Create /TN $TaskName /TR $command /SC ONSTART /RU SYSTEM /RL HIGHEST /F | Out-Null
schtasks /Create /TN "${TaskName}-Monitor" /TR $command /SC MINUTE /MO 5 /RU SYSTEM /RL HIGHEST /F | Out-Null

Import-Module WebAdministration
if (Test-Path "IIS:\Sites\wai") {
    Set-ItemProperty "IIS:\Sites\wai" -Name serverAutoStart -Value $true
}

Set-Service -Name W3SVC -StartupType Automatic -ErrorAction SilentlyContinue
$pgService = Get-Service -Name "postgresql*" -ErrorAction SilentlyContinue | Select-Object -First 1
if ($pgService) {
    Set-Service -Name $pgService.Name -StartupType Automatic
}

& $EnsureScript

Write-Host "Installed scheduled tasks '$TaskName' (startup) and '${TaskName}-Monitor' (every 5 minutes)."
Write-Host "WAI frontend: http://localhost:8081"
Write-Host "WAI backend:  http://localhost:8090"

$ErrorActionPreference = "Stop"

. (Join-Path $PSScriptRoot "wai-env.ps1")

$Root = Get-WaiRoot
$BackendScript = Join-Path $PSScriptRoot "wai-backend.ps1"
$Port = Get-WaiBackendPort -Root $Root

function Ensure-ServiceAutomatic {
    param([string]$Name)

    $service = Get-Service -Name $Name -ErrorAction SilentlyContinue
    if ($service -and $service.StartType -ne "Automatic") {
        Set-Service -Name $Name -StartupType Automatic
    }
    if ($service -and $service.Status -ne "Running") {
        Start-Service -Name $Name
    }
}

Ensure-ServiceAutomatic -Name "W3SVC"
$pgService = Get-Service -Name "postgresql*" -ErrorAction SilentlyContinue | Select-Object -First 1
if ($pgService) {
    Ensure-ServiceAutomatic -Name $pgService.Name
}

$backend = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
if (-not $backend) {
    & $BackendScript -Detached
}

Import-Module WebAdministration -ErrorAction Stop
$site = Get-Website -Name "wai" -ErrorAction SilentlyContinue
if ($site -and $site.State -ne "Started") {
    Start-Website -Name "wai"
}

param(
    [string]$PostgresUser = "postgres",
    [string]$PostgresPassword = "",
    [string]$DatabaseName = "wai",
    [int]$Port = 8081,
    [string]$SiteName = "wai",
    [string]$BackendUrl = "http://localhost:8090",
    [string]$Config = ""
)

$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$DataDir = Join-Path $Root "data"
$RunLocalScript = Join-Path $Root "run-local.ps1"
$SetupIisScript = Join-Path $Root "scripts\setup-iis-wai.ps1"

if ([string]::IsNullOrWhiteSpace($Config)) {
    $Config = Join-Path $Root "wai.yaml"
}

if (-not (Test-Path $RunLocalScript)) {
    throw "Could not find $RunLocalScript."
}
if (-not (Test-Path $SetupIisScript)) {
    throw "Could not find $SetupIisScript."
}

$backendUri = [Uri]$BackendUrl
$backendPort = $backendUri.Port
if ($backendPort -le 0) {
    $backendPort = if ($backendUri.Scheme -eq "https") { 443 } else { 80 }
}

New-Item -ItemType Directory -Force -Path $DataDir | Out-Null

function Start-WaiBackend {
    $runLocalArgs = @{
        PostgresUser = $PostgresUser
        DatabaseName = $DatabaseName
        Config = $Config
        BackendDetached = $true
    }
    if (-not [string]::IsNullOrWhiteSpace($PostgresPassword)) {
        $runLocalArgs.PostgresPassword = $PostgresPassword
    }

    Write-Host "Starting WAI backend on $BackendUrl..."
    & $RunLocalScript @runLocalArgs
    if ($LASTEXITCODE -ne 0) {
        exit $LASTEXITCODE
    }
}

$backend = Get-NetTCPConnection -LocalPort $backendPort -State Listen -ErrorAction SilentlyContinue
if ($backend) {
    $backendProcessId = ($backend | Select-Object -First 1).OwningProcess
    $backendProcess = Get-Process -Id $backendProcessId -ErrorAction SilentlyContinue
    $venvPython = Join-Path $Root ".venv\Scripts\python.exe"

    # The venv python.exe is a launcher on Windows: the process listening on the port is the
    # base interpreter it spawns, so also recognise WAI by its command line ("-m wai").
    $commandLine = (Get-CimInstance Win32_Process -Filter "ProcessId = $backendProcessId" -ErrorAction SilentlyContinue).CommandLine
    $isWaiBackend = $backendProcess -and (
        $backendProcess.Path -eq $venvPython -or
        ($commandLine -and $commandLine -match '(^|\s)-m\s+wai(\s|$)')
    )

    if ($isWaiBackend) {
        Write-Host "Restarting WAI backend on $BackendUrl..."
        Stop-Process -Id $backendProcessId -Force
        for ($i = 0; $i -lt 20; $i++) {
            Start-Sleep -Milliseconds 500
            $backend = Get-NetTCPConnection -LocalPort $backendPort -State Listen -ErrorAction SilentlyContinue
            if (-not $backend) {
                break
            }
        }
        Start-WaiBackend
    } else {
        Write-Warning "Port $backendPort is held by PID $backendProcessId, which is not recognised as the WAI backend; it was NOT restarted, so new backend code is not running."
    }
} else {
    Start-WaiBackend
}

Write-Host "Configuring IIS site '$SiteName' on http://localhost:$Port..."
& $SetupIisScript -Port $Port -SiteName $SiteName -BackendUrl $BackendUrl
if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
}

Write-Host "Installing WAI autostart task..."
& (Join-Path $Root "scripts\install-wai-autostart.ps1")
exit $LASTEXITCODE

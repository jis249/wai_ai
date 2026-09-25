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

    # A dependency upgrade is staged in .venv.next (built and tested while the old backend ran,
    # since Windows locks loaded .pyd files). Swap it in now that the backend is stopped.
    $venvDir = Join-Path $Root ".venv"
    $nextVenv = Join-Path $Root ".venv.next"
    $prevVenv = Join-Path $Root ".venv.prev"
    if (Test-Path (Join-Path $nextVenv "Scripts\python.exe")) {
        Write-Host "Activating upgraded Python environment (.venv.next -> .venv, old kept as .venv.prev)..."
        if (Test-Path $prevVenv) { Remove-Item -Recurse -Force $prevVenv }
        if (Test-Path $venvDir) { Rename-Item $venvDir ".venv.prev" }
        Rename-Item $nextVenv ".venv"
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

    # The venv python.exe is a launcher; the process that owns the port is usually its child
    # (the base interpreter), so also match on the parent's path.
    $parent = $null
    $isWaiBackend = $backendProcess -and $backendProcess.Path -eq $venvPython
    if (-not $isWaiBackend -and $backendProcess -and $backendProcess.ProcessName -like "python*") {
        $parentId = (Get-CimInstance Win32_Process -Filter "ProcessId=$backendProcessId").ParentProcessId
        $parent = Get-Process -Id $parentId -ErrorAction SilentlyContinue
        $isWaiBackend = $parent -and $parent.Path -eq $venvPython
    }

    if ($isWaiBackend) {
        if ($parent) {
            Stop-Process -Id $parent.Id -Force -ErrorAction SilentlyContinue
        }
        Write-Host "Restarting WAI backend on $BackendUrl..."
        Stop-Process -Id $backendProcessId -Force -ErrorAction SilentlyContinue
        for ($i = 0; $i -lt 20; $i++) {
            Start-Sleep -Milliseconds 500
            $backend = Get-NetTCPConnection -LocalPort $backendPort -State Listen -ErrorAction SilentlyContinue
            if (-not $backend) {
                break
            }
        }
        Start-WaiBackend
    } else {
        Write-Host "WAI backend already listening on port $backendPort (PID $backendProcessId)."
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

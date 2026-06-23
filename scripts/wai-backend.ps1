param(
    [switch]$Detached
)

$ErrorActionPreference = "Stop"

. (Join-Path $PSScriptRoot "wai-env.ps1")

$Root = Get-WaiRoot
$Config = Join-Path $Root "wai.yaml"
$EnvFile = Join-Path $Root ".env.local"
$DataDir = Join-Path $Root "data"
$VenvPython = Join-Path $Root ".venv\Scripts\python.exe"
$Port = Get-WaiBackendPort -Root $Root -ConfigPath $Config

Import-WaiEnvFile -Path $EnvFile -OverwriteExisting
New-Item -ItemType Directory -Force -Path $DataDir | Out-Null

if (-not (Test-Path $VenvPython)) {
    throw "Python venv not found at $VenvPython. Run .\run-local.ps1 -BackendDetached once to create it."
}

$listening = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
if ($listening) {
    Write-Host "WAI backend already listening on http://127.0.0.1:$Port"
    exit 0
}

$env:WAI_DEV = "true"
$args = @("-m", "wai", "--config", $Config, "--host", "0.0.0.0", "--port", "$Port")

if ($Detached) {
    $backendLog = Join-Path $DataDir "wai-backend.log"
    $backendErr = Join-Path $DataDir "wai-backend.err.log"
    $process = Start-Process -FilePath $VenvPython `
        -ArgumentList $args `
        -WorkingDirectory $Root `
        -WindowStyle Hidden `
        -RedirectStandardOutput $backendLog `
        -RedirectStandardError $backendErr `
        -PassThru

    for ($i = 0; $i -lt 60; $i++) {
        Start-Sleep -Seconds 1
        $listening = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
        if ($listening) {
            Write-Host "WAI backend started on http://127.0.0.1:$Port (PID $($process.Id))"
            exit 0
        }
        if ($process.HasExited) {
            $message = "WAI backend exited before listening on port $Port."
            if (Test-Path $backendErr) {
                $errorText = Get-Content -Path $backendErr -Raw
                if ($errorText) {
                    $message = "$message`n$errorText"
                }
            }
            throw $message
        }
    }
    throw "WAI backend did not start on port $Port."
}

& $VenvPython @args
exit $LASTEXITCODE

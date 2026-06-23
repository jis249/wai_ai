param(
    [string]$PostgresUser = "postgres",
    [string]$PostgresPassword = "",
    [string]$DatabaseName = "wai",
    [string]$Config = "",
    [switch]$BackendOnly,
    [switch]$BackendDetached,
    [switch]$DevUi
)

$ErrorActionPreference = "Stop"

. (Join-Path $PSScriptRoot "scripts\wai-env.ps1")

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$DataDir = Join-Path $Root "data"
$EnvFile = Join-Path $Root ".env.local"
if ([string]::IsNullOrWhiteSpace($Config)) {
    $Config = Join-Path $Root "wai.yaml"
}
$UiDir = Join-Path $Root "ui"
$VenvPython = Join-Path $Root ".venv\Scripts\python.exe"

function New-Secret {
    $bytes = [byte[]]::new(32)
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try {
        $rng.GetBytes($bytes)
    } finally {
        $rng.Dispose()
    }
    [Convert]::ToBase64String($bytes)
}

function Read-LocalEnv {
    if (-not (Test-Path $EnvFile)) {
        return @{}
    }

    $values = @{}
    Get-Content $EnvFile | ForEach-Object {
        if ($_ -match '^\s*([^#][^=]+)=(.*)$') {
            $values[$matches[1].Trim()] = $matches[2].Trim()
        }
    }
    $values
}

function Set-OllamaPerformanceDefaults {
    param([hashtable]$Values)

    $defaults = @{
        OLLAMA_FLASH_ATTENTION = "1"
        OLLAMA_KEEP_ALIVE = "24h"
        OLLAMA_MAX_LOADED_MODELS = "1"
        OLLAMA_NUM_PARALLEL = "1"
        OLLAMA_HOST = "127.0.0.1:11434"
    }

    foreach ($entry in $defaults.GetEnumerator()) {
        if (-not $Values.ContainsKey($entry.Name)) {
            $Values[$entry.Name] = $entry.Value
        }
    }
}

function Get-PostgresTool {
    param([string]$Name)

    $cmd = Get-Command $Name -ErrorAction SilentlyContinue
    if ($cmd) {
        return $cmd.Source
    }

    $commonPaths = @(
        "C:\Program Files\PostgreSQL\18\bin\$Name",
        "C:\Program Files\PostgreSQL\17\bin\$Name",
        "C:\Program Files\PostgreSQL\16\bin\$Name",
        "C:\Program Files\PostgreSQL\15\bin\$Name"
    )

    foreach ($path in $commonPaths) {
        if (Test-Path $path) {
            return $path
        }
    }

    throw "$Name was not found. Install PostgreSQL client tools or add them to PATH."
}

function Test-PostgresPort {
    try {
        $client = New-Object System.Net.Sockets.TcpClient
        $client.Connect("127.0.0.1", 5432)
        $client.Close()
        return $true
    } catch {
        return $false
    }
}

function Ensure-PostgresDatabase {
    param(
        [string]$User,
        [string]$Password,
        [string]$DbName
    )

    if (-not (Test-PostgresPort)) {
        throw "PostgreSQL is not accepting connections on 127.0.0.1:5432. Start the PostgreSQL Windows service."
    }

    $psql = Get-PostgresTool "psql.exe"
    $env:PGPASSWORD = $Password
    $exists = & $psql -h 127.0.0.1 -p 5432 -U $User -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='$DbName'"
    if ($exists -ne "1") {
        Write-Host "Creating PostgreSQL database '$DbName'..."
        & $psql -h 127.0.0.1 -p 5432 -U $User -d postgres -c "CREATE DATABASE $DbName;"
    }
}

function Ensure-PythonEnv {
    if (-not (Test-Path $VenvPython)) {
        Write-Host "Creating Python virtual environment..."
        python -m venv (Join-Path $Root ".venv")
        & $VenvPython -m pip install --upgrade pip
        & $VenvPython -m pip install -e $Root
    }
}

function Get-ProxyPort {
    param([string]$ConfigPath)
    if (-not (Test-Path $ConfigPath)) {
        return 8090
    }
    $match = Select-String -Path $ConfigPath -Pattern '^\s*port:\s*(\d+)\s*$' | Select-Object -First 1
    if ($match -and $match.Matches.Groups.Count -gt 1) {
        return [int]$match.Matches.Groups[1].Value
    }
    return 8090
}

function Start-BackendDetached {
    param([int]$Port = 8090)

    & (Join-Path $Root "scripts\wai-backend.ps1") -Detached
}

New-Item -ItemType Directory -Force -Path $DataDir | Out-Null

$envValues = Read-LocalEnv
if (-not $envValues.ContainsKey("WAI_ADMIN_KEY")) {
    $envValues["WAI_ADMIN_KEY"] = New-Secret
}
if (-not $envValues.ContainsKey("WAI_ENCRYPTION_KEY")) {
    $envValues["WAI_ENCRYPTION_KEY"] = New-Secret
}
if (-not $envValues.ContainsKey("POSTGRES_PASSWORD")) {
    if (-not [string]::IsNullOrWhiteSpace($PostgresPassword)) {
        $envValues["POSTGRES_PASSWORD"] = $PostgresPassword
    } else {
        throw "Set POSTGRES_PASSWORD in .env.local or pass -PostgresPassword."
    }
}
Set-OllamaPerformanceDefaults -Values $envValues

$envValues.GetEnumerator() |
    Sort-Object Name |
    ForEach-Object { "$($_.Name)=$($_.Value)" } |
    Set-Content -Path $EnvFile -Encoding ASCII

foreach ($entry in $envValues.GetEnumerator()) {
    [Environment]::SetEnvironmentVariable($entry.Key, $entry.Value, "Process")
}

if (-not (Get-Command ollama -ErrorAction SilentlyContinue)) {
    Write-Warning "Ollama is not installed or is not on PATH."
} else {
    try {
        Invoke-RestMethod -Uri "http://localhost:11434/api/tags" -TimeoutSec 2 | Out-Null
    } catch {
        Start-Process -FilePath "ollama" -ArgumentList "serve" -WindowStyle Minimized
        Start-Sleep -Seconds 3
    }
}

Ensure-PythonEnv

if (-not $envValues.ContainsKey("POSTGRES_PASSWORD")) {
    throw "POSTGRES_PASSWORD is required for PostgreSQL."
}

& $VenvPython (Join-Path $Root "scripts\db\ensure_pg_db.py")
if ($LASTEXITCODE -ne 0) { throw "Failed to ensure PostgreSQL database exists." }

try {
    Ensure-PostgresDatabase -User $PostgresUser -Password $envValues["POSTGRES_PASSWORD"] -DbName $DatabaseName
} catch {
    Write-Warning "psql/pg_isready not available; database was ensured via Python script."
}

$Port = Get-ProxyPort -ConfigPath $Config

if ($BackendDetached) {
    Write-Host "Starting wai backend in the background..."
    Write-Host "API: http://localhost:$Port"
    Write-Host "Database: PostgreSQL localhost:5432/$DatabaseName"
    Start-BackendDetached -Port $Port
    exit 0
}

if ($BackendOnly) {
    Write-Host "Starting wai backend locally..."
    Write-Host "API: http://localhost:$Port"
    Write-Host "Database: PostgreSQL localhost:5432/$DatabaseName"
    $env:WAI_DEV = "true"
    & $VenvPython -m wai --config $Config --host 0.0.0.0 --port $Port
    exit $LASTEXITCODE
}

Start-BackendDetached -Port $Port

Write-Host "WAI backend: http://localhost:$Port"
Write-Host "WAI frontend (IIS): http://localhost:8081"
Write-Host "Database: PostgreSQL 127.0.0.1:5432/$DatabaseName"
Write-Host ""
Write-Host "Deploy or refresh IIS with: .\run-iis-local.ps1"
Write-Host "Dev UI with hot reload:   .\run-local.ps1 -DevUi"

if (-not $DevUi) {
    exit 0
}

Write-Host "WAI dev UI: http://127.0.0.1:5173"
Write-Host "Backend API: http://localhost:$Port"
Write-Host "IIS frontend: http://localhost:8081 (run .\run-iis-local.ps1 as Admin)"
Push-Location $UiDir
try {
    npm run dev -- --host 127.0.0.1
} finally {
    Pop-Location
}

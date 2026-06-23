function Import-WaiEnvFile {
    param(
        [string]$Path,
        [switch]$OverwriteExisting
    )

    if (-not (Test-Path $Path)) {
        return
    }

    Get-Content $Path | ForEach-Object {
        $line = $_.Trim()
        if (-not $line -or $line.StartsWith("#") -or $line -notmatch "=") {
            return
        }
        $name, $value = $line.Split("=", 2)
        $name = $name.Trim()
        $value = $value.Trim()
        if (-not $name) {
            return
        }
        if ($OverwriteExisting -or -not [Environment]::GetEnvironmentVariable($name, "Process")) {
            [Environment]::SetEnvironmentVariable($name, $value, "Process")
        }
    }
}

function Get-WaiRoot {
    param([string]$ScriptRoot = $PSScriptRoot)
    return (Resolve-Path (Join-Path $ScriptRoot "..")).Path
}

function Get-WaiBackendPort {
    param(
        [string]$Root,
        [string]$ConfigPath = ""
    )

    if ([string]::IsNullOrWhiteSpace($ConfigPath)) {
        $ConfigPath = Join-Path $Root "wai.yaml"
    }
    if (-not (Test-Path $ConfigPath)) {
        return 8090
    }
    $match = Select-String -Path $ConfigPath -Pattern '^\s*port:\s*(\d+)\s*$' | Select-Object -First 1
    if ($match -and $match.Matches.Groups.Count -gt 1) {
        return [int]$match.Matches.Groups[1].Value
    }
    return 8090
}

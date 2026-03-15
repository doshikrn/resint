$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$backendDir = Join-Path $root "backend"
$frontendDir = Join-Path $root "frontend"
$uvicornExe = Join-Path $backendDir ".venv\Scripts\uvicorn.exe"

function Test-PortListening {
    param([int]$Port)
    $conn = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
    return $null -ne $conn
}

if (-not (Test-Path $uvicornExe)) {
    Write-Error "Backend executable not found: $uvicornExe"
}

if (-not (Test-PortListening -Port 8000)) {
    Write-Host "Starting backend on http://127.0.0.1:8000 ..."
    Start-Process -FilePath $uvicornExe -WorkingDirectory $backendDir -ArgumentList "app.main:app", "--host", "127.0.0.1", "--port", "8000" | Out-Null
} else {
    Write-Host "Backend already listening on port 8000"
}

if (-not (Test-PortListening -Port 3000)) {
    Write-Host "Starting frontend on http://127.0.0.1:3000 ..."
    Start-Process -FilePath "C:\Program Files\nodejs\npm.cmd" -WorkingDirectory $frontendDir -ArgumentList "run", "dev", "--", "--port", "3000" | Out-Null
} else {
    Write-Host "Frontend already listening on port 3000"
}

Start-Sleep -Seconds 2

$backendUp = Test-PortListening -Port 8000
$frontendUp = Test-PortListening -Port 3000

Write-Host ""
Write-Host "Status:"
Write-Host "- Backend 8000: $backendUp"
Write-Host "- Frontend 3000: $frontendUp"
Write-Host ""
Write-Host "Open: http://127.0.0.1:3000"
Write-Host "Login: testuser / password"

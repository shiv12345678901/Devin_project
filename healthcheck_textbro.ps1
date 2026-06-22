param(
  [int]$BackendPort = 5055,
  [int]$FrontendPort = 5173
)

$ErrorActionPreference = "Stop"

$BackendUrl = "http://127.0.0.1:$BackendPort"
$FrontendUrl = "http://127.0.0.1:$FrontendPort"

function Test-Endpoint {
  param(
    [string]$Name,
    [string]$Url
  )

  try {
    $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 5
    $ok = $response.StatusCode -ge 200 -and $response.StatusCode -lt 500
    if ($ok) {
      Write-Host "[OK]   $Name ($($response.StatusCode))" -ForegroundColor Green
      return $true
    }
    Write-Host "[FAIL] $Name ($($response.StatusCode))" -ForegroundColor Red
    return $false
  } catch {
    Write-Host "[FAIL] $Name - $($_.Exception.Message)" -ForegroundColor Red
    return $false
  }
}

Write-Host ""
Write-Host "TextBro Health Check"
Write-Host "Backend:  $BackendUrl"
Write-Host "Frontend: $FrontendUrl"
Write-Host ""

$checks = @(
  (Test-Endpoint "Frontend shell" "$FrontendUrl/"),
  (Test-Endpoint "Backend preflight" "$BackendUrl/preflight"),
  (Test-Endpoint "Library list" "$BackendUrl/list"),
  (Test-Endpoint "History" "$BackendUrl/history"),
  (Test-Endpoint "Publish videos" "$BackendUrl/youtube/videos")
)

if ($checks -contains $false) {
  Write-Host ""
  Write-Host "One or more checks failed. Run start.bat or inspect the backend/frontend windows." -ForegroundColor Yellow
  exit 1
}

Write-Host ""
Write-Host "All checks passed." -ForegroundColor Green

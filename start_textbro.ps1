param(
  [int]$BackendPort = 5055,
  [int]$FrontendPort = 5173
)

$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$BackendDir = Join-Path $Root "backend"
$FrontendDir = Join-Path $Root "frontend"
$BackendUrl = "http://127.0.0.1:$BackendPort"
$FrontendUrl = "http://127.0.0.1:$FrontendPort"
$WindowsTerminal = Get-Command wt.exe -ErrorAction SilentlyContinue

function Stop-PortListeners {
  param([int[]]$Ports)

  foreach ($port in $Ports) {
    $listeners = Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue
    foreach ($listener in $listeners) {
      try {
        Stop-Process -Id $listener.OwningProcess -Force -ErrorAction SilentlyContinue
      } catch {
        Write-Host "Could not stop process $($listener.OwningProcess) on port $port"
      }
    }
  }
}

function Wait-Http {
  param(
    [string]$Url,
    [int]$TimeoutSeconds = 45
  )

  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    try {
      $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 3
      if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 500) {
        return
      }
    } catch {
      Start-Sleep -Milliseconds 700
    }
  }
  throw "Timed out waiting for $Url"
}

function Start-AppTerminal {
  param(
    [string]$Title,
    [string]$Command,
    [switch]$KeepOpen
  )

  if ($WindowsTerminal) {
    $profileCommand = if ($KeepOpen) {
      "powershell.exe -NoExit -NoProfile -ExecutionPolicy Bypass -Command `"$Command`""
    } else {
      "powershell.exe -NoProfile -ExecutionPolicy Bypass -Command `"$Command`""
    }
    Start-Process -FilePath $WindowsTerminal.Source -ArgumentList @(
      "new-tab",
      "--title", $Title,
      "--suppressApplicationTitle",
      $profileCommand
    )
    return
  }

  $args = @("-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", $Command)
  if ($KeepOpen) {
    $args = @("-NoExit") + $args
  }
  Start-Process -FilePath powershell.exe -ArgumentList $args -WindowStyle Normal
}

Write-Host "Starting TextBro..."
Write-Host "Stopping old dev servers on ports $BackendPort and $FrontendPort..."
Stop-PortListeners -Ports @($BackendPort, $FrontendPort)
Start-Sleep -Seconds 1

Write-Host "Starting backend on $BackendUrl..."
$backendCommand = "`$Host.UI.RawUI.WindowTitle='TextBro Backend'; `$env:PORT='$BackendPort'; cd '$BackendDir'; python start.py"
Start-AppTerminal -Title "TextBro Backend" -Command $backendCommand -KeepOpen

Wait-Http "$BackendUrl/preflight"

Write-Host "Starting frontend on $FrontendUrl..."
$frontendCommand = "`$Host.UI.RawUI.WindowTitle='TextBro Frontend'; `$env:VITE_BACKEND_URL='$BackendUrl'; cd '$FrontendDir'; npm.cmd run dev -- --host 127.0.0.1 --port $FrontendPort --strictPort *> frontend.dev.log"
Start-AppTerminal -Title "TextBro Frontend" -Command $frontendCommand

Wait-Http "$FrontendUrl/"

Write-Host "Opening $FrontendUrl"
Start-Process $FrontendUrl

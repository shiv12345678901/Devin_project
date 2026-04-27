param(
  [string]$ShortcutPath = "",
  [switch]$Desktop
)

$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$Launcher = Join-Path $Root "start_textbro.ps1"
$Icon = Join-Path $Root "assets\textbro.ico"

if (-not (Test-Path $Launcher)) {
  throw "Launcher not found: $Launcher"
}

if (-not (Test-Path $Icon)) {
  throw "Icon not found: $Icon"
}

if (-not $ShortcutPath) {
  $folder = if ($Desktop) {
    [Environment]::GetFolderPath("Desktop")
  } else {
    $Root
  }
  $ShortcutPath = Join-Path $folder "TextBro.lnk"
}

$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($ShortcutPath)
$shortcut.TargetPath = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"
$shortcut.Arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$Launcher`""
$shortcut.WorkingDirectory = $Root
$shortcut.IconLocation = $Icon
$shortcut.Description = "Start TextBro"
$shortcut.Save()

Write-Host "Created shortcut: $ShortcutPath"

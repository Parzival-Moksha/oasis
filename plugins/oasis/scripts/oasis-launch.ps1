# The Oasis plugin's launcher (Windows): /oasis in Claude Code runs this (hooks/register.ts).
# Starts whichever of the two servers isn't listening yet, each in its own window, waits for the world to answer,
# then opens the village in the default browser. Running it twice is harmless.
#   ENGINE  pnpm dev:engine  127.0.0.1:4530  runs agents, the voice helper and the Claude Code bridge
#   WORLD   pnpm dev         127.0.0.1:4516  the Oasis page and the plugin's MCP server
# Exit codes: 0 opened, 2 the Oasis folder wasn't found, 3 the world didn't come up in time.
param(
    [string]$OasisHome = '',
    [string]$Url = 'http://localhost:4516/?profile=village',
    [int]$WaitSeconds = 120
)
$ErrorActionPreference = 'Stop'

# The Oasis checkout: given, or $env:OASIS_HOME, or the repo this plugin folder sits in (<repo>\plugins\oasis\scripts).
if (-not $OasisHome) { $OasisHome = $env:OASIS_HOME }
if (-not $OasisHome) { $OasisHome = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path }
$package = Join-Path $OasisHome 'package.json'
if (-not (Test-Path $package) -or -not (Select-String -Path $package -Pattern '"dev:engine"' -Quiet)) {
    Write-Output "The Oasis was not found at $OasisHome (no package.json with dev:engine). Set OASIS_HOME to its folder."
    exit 2
}

function Test-Port([int]$port) {
    $c = New-Object System.Net.Sockets.TcpClient
    try { $c.Connect('127.0.0.1', $port); return $true } catch { return $false } finally { $c.Close() }
}

function Start-OasisWindow([string]$title, [string]$script, [int]$port) {
    if (Test-Port $port) { Write-Output "$title was already running on port $port."; return }
    $cmd = "`$Host.UI.RawUI.WindowTitle = 'OASIS // $title :$port'; Write-Host '  OASIS $title on port $port. Close this window to stop it.' -ForegroundColor Cyan; Set-Location '$OasisHome'; pnpm $script"
    Start-Process powershell.exe -WorkingDirectory $OasisHome -ArgumentList @('-NoLogo', '-NoExit', '-ExecutionPolicy', 'Bypass', '-Command', $cmd) | Out-Null
    Write-Output "$title started in its own window (port $port)."
}

Start-OasisWindow -title 'ENGINE' -script 'dev:engine' -port 4530
Start-OasisWindow -title 'WORLD' -script 'dev' -port 4516

$deadline = (Get-Date).AddSeconds($WaitSeconds)
while (-not (Test-Port 4516)) {
    if ((Get-Date) -gt $deadline) { Write-Output "The world did not answer on port 4516 within $WaitSeconds seconds. Look at the OASIS // WORLD window."; exit 3 }
    Start-Sleep -Milliseconds 500
}
# OASIS_NO_OPEN=1 (tests): everything but the browser tab.
if ($env:OASIS_NO_OPEN) { Write-Output "The Oasis is running at $Url"; exit 0 }
Start-Process $Url
Write-Output "Opened $Url"
exit 0

# The Oasis as an app (the "Oasis app" desktop icon runs this through oasis-app.vbs, so no window shows):
#   1. starts the supervisor (scripts/oasis-supervisor.mjs) if it isn't running: it runs the agent engine and the page
#      server with no windows, keeps their logs in logs\, and starts one again if it stops;
#   2. opens the Oasis in its own window (Chrome's or Edge's app window: no tabs, no address bar), at once, on a small
#      "starting" page that switches to the village when the page server answers.
# Running it twice is harmless: one supervisor, a second window. The old launcher (the "OASIS" icon,
# C:\7c_oasis\scripts\oasis-launch.ps1, two visible windows) still works as a fallback.
# Mission: C:\7c_oasis\docs\missions\oasis-app.md
param([string]$Url = 'http://localhost:4516/?profile=village')
$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path

function Test-Port([int]$port) {
    $c = New-Object System.Net.Sockets.TcpClient
    try { $c.Connect('127.0.0.1', $port); return $true } catch { return $false } finally { $c.Close() }
}

if (-not (Test-Port 4531)) {
    $logs = Join-Path $repo 'logs'
    New-Item -ItemType Directory -Force $logs | Out-Null
    $node = (Get-Command node -ErrorAction Stop).Source
    Start-Process -FilePath $node -ArgumentList "`"$repo\scripts\oasis-supervisor.mjs`"" -WorkingDirectory $repo -WindowStyle Hidden `
        -RedirectStandardOutput (Join-Path $logs 'supervisor.log') -RedirectStandardError (Join-Path $logs 'supervisor.err.log') | Out-Null
}

# The app window: Chrome, else Edge. Opens the "starting" page when the page server isn't up yet.
$browsers = @(
    "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
    "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
    "$env:LocalAppData\Google\Chrome\Application\chrome.exe",
    "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
    "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe"
)
$browser = $browsers | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
$target = $Url
if (-not (Test-Port 4516)) {
    $starting = Join-Path $repo 'scripts\oasis-starting.html'
    $target = ([System.Uri]$starting).AbsoluteUri + '#' + [System.Uri]::EscapeDataString($Url)
}
if ($browser) { Start-Process -FilePath $browser -ArgumentList "--app=$target" }
else { Start-Process $Url }

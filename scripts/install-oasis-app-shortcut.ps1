# Puts the "Oasis app" icon on the desktop: the Oasis as its own window, its servers out of sight
# (scripts\oasis-app.vbs -> oasis-app.ps1 -> the supervisor). The old "OASIS" icon (two windows) is left as it is.
#   powershell -ExecutionPolicy Bypass -File C:\af_oasis\scripts\install-oasis-app-shortcut.ps1
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$desktop = [Environment]::GetFolderPath('Desktop')
# Not "Oasis.lnk": Windows names are case-blind, and "OASIS.lnk" is the old two-window launcher.
$link = Join-Path $desktop 'Oasis app.lnk'
$shell = New-Object -ComObject WScript.Shell
$s = $shell.CreateShortcut($link)
$s.TargetPath = "$env:SystemRoot\System32\wscript.exe"
$s.Arguments = "`"$repo\scripts\oasis-app.vbs`""
$s.WorkingDirectory = $repo
$s.IconLocation = "$repo\public\icons\oasis-local.ico,0"
$s.Description = 'The Oasis, in its own window; the engine and the page server run hidden (restart them in Settings > Agents).'
$s.Save()
Write-Output "Made $link"

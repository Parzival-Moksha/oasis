' The "Oasis app" desktop icon's target: runs scripts\oasis-app.ps1 with no window at all (a PowerShell started from a
' shortcut flashes its console even when hidden; through WScript nothing shows).
Set fso = CreateObject("Scripting.FileSystemObject")
here = fso.GetParentFolderName(WScript.ScriptFullName)
CreateObject("WScript.Shell").Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & here & "\oasis-app.ps1""", 0, False

Set WshShell = CreateObject("WScript.Shell")
projectDir = "D:\Hermes Project\math-adventure"
psScript = projectDir & "\scripts\launch.ps1"
cmd = "powershell.exe -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & psScript & """"
WshShell.Run cmd, 0, False

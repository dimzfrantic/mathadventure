$wsh = New-Object -ComObject WScript.Shell
$desktop = [System.Environment]::GetFolderPath('Desktop')
$shortcutPath = Join-Path $desktop "Math Adventure.lnk"
$shortcut = $wsh.CreateShortcut($shortcutPath)
$shortcut.TargetPath = "wscript.exe"
$shortcut.Arguments = "`"D:\Hermes Project\math-adventure\scripts\launch.vbs`""
$shortcut.WorkingDirectory = "D:\Hermes Project\math-adventure"
$shortcut.Description = "Buka Math Adventure (Auto Start Server)"
$shortcut.IconLocation = "shell32.dll,24"
$shortcut.Save()
Write-Output "SHORTCUT_CREATED_SUCCESS"

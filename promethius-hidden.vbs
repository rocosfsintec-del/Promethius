' Launches run-promethius.bat with NO visible console window (used by the boot task).
Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")
root = fso.GetParentFolderName(WScript.ScriptFullName)
sh.Run """" & root & "\run-promethius.bat""", 0, False

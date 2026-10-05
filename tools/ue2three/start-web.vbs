Option Explicit
Dim shell, files, repo, pythonw, app, chrome, url, request, attempt, poll, ready
Set shell = CreateObject("WScript.Shell")
Set files = CreateObject("Scripting.FileSystemObject")
repo = files.GetAbsolutePathName(files.GetParentFolderName(files.GetParentFolderName(files.GetParentFolderName(WScript.ScriptFullName))))
pythonw = "C:\Python312\pythonw.exe"
app = repo & "\tools\ue2three\ue2three.py"
chrome = "C:\Program Files\Google\Chrome\Application\chrome.exe"
url = "http://127.0.0.1:8766/"
shell.CurrentDirectory = repo
ready = False
For attempt = 1 To 2
    On Error Resume Next
    Set request = CreateObject("WinHttp.WinHttpRequest.5.1")
    request.Open "GET", url, False
    request.Send
    ready = (Err.Number = 0 And request.Status = 200)
    Err.Clear
    On Error GoTo 0
    If ready Then Exit For
    shell.Run Chr(34) & pythonw & Chr(34) & " " & Chr(34) & app & Chr(34) & " dashboard --workspace " & Chr(34) & repo & "\.local\ue2three" & Chr(34) & " --port 8766", 0, False
    For poll = 1 To 30
        WScript.Sleep 500
        On Error Resume Next
        Set request = CreateObject("WinHttp.WinHttpRequest.5.1")
        request.Open "GET", url, False
        request.Send
        ready = (Err.Number = 0 And request.Status = 200)
        Err.Clear
        On Error GoTo 0
        If ready Then Exit For
    Next
    Exit For
Next
If files.FileExists(chrome) Then
    shell.Run Chr(34) & chrome & Chr(34) & " --new-window " & url, 1, False
Else
    shell.Run url, 1, False
End If

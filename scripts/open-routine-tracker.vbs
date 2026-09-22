' 주간 루틴 트래커를 "앱처럼" (주소창/탭 없이) 여는 실행 스크립트
' 더블클릭하면 바로 실행되고, 시작프로그램 폴더에 넣으면 PC 켤 때 자동으로 열립니다.

Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")

appPath = "C:\Users\jeong\dev\weekly-routine-tracker\index.html"
fileUrl = "file:///" & Replace(appPath, "\", "/")

candidates = Array( _
  "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe", _
  "C:\Program Files\Microsoft\Edge\Application\msedge.exe", _
  "C:\Program Files\Google\Chrome\Application\chrome.exe", _
  shell.ExpandEnvironmentStrings("%LOCALAPPDATA%") & "\Google\Chrome\Application\chrome.exe" _
)

browserPath = ""
For Each c In candidates
  If fso.FileExists(c) Then
    browserPath = c
    Exit For
  End If
Next

If browserPath <> "" Then
  ' --app 모드: 주소창/탭 없는 미니 창으로 열려서 위젯처럼 보입니다
  shell.Run """" & browserPath & """ --app=" & fileUrl, 1, False
Else
  ' Edge/Chrome을 못 찾으면 기본 브라우저로 그냥 엽니다
  shell.Run """" & appPath & """", 1, False
End If

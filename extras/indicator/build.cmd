@echo off
rem Builds SparkIndicator.exe with the C# compiler that ships with Windows (.NET Framework 4.8).
rem Nothing to install. Stop the indicator first (stop_indicator.cmd) or the exe is locked.
setlocal
set FW=%WINDIR%\Microsoft.NET\Framework64\v4.0.30319
set OUT=%~dp0SparkIndicator.exe
if not "%~1"=="" set OUT=%~1
"%FW%\csc.exe" /nologo /target:winexe /platform:x64 /optimize+ /warn:4 ^
  /out:"%OUT%" ^
  /win32manifest:"%~dp0src\app.manifest" ^
  /lib:"%FW%\WPF" ^
  /r:PresentationFramework.dll /r:PresentationCore.dll /r:WindowsBase.dll /r:System.Xaml.dll /r:System.Web.Extensions.dll ^
  "%~dp0src\Native.cs" "%~dp0src\Program.cs" "%~dp0src\Herdr.cs" "%~dp0src\Ui.cs" "%~dp0src\Controller.cs"
exit /b %ERRORLEVEL%

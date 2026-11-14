@echo off
rem Removes what install.cmd added for the Spark look. Double-click this file.
rem It runs uninstall.ps1 (next to it) with Windows PowerShell, for this one run only: nothing
rem about PowerShell is changed on the computer, and no administrator rights are needed.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0uninstall.ps1" %*
set RESULT=%ERRORLEVEL%
if "%~1"=="" pause
exit /b %RESULT%

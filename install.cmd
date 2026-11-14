@echo off
rem Installs the Spark look for the Herdr app. Double-click this file.
rem It runs install.ps1 (next to it) with Windows PowerShell, for this one run only: nothing
rem about PowerShell is changed on the computer, and no administrator rights are needed.
rem Options are passed through, for example:  install.cmd -Force   or   install.cmd -NoIndicator
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1" %*
set RESULT=%ERRORLEVEL%
if "%~1"=="" pause
exit /b %RESULT%

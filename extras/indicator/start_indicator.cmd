@echo off
rem Double-click to start the Spark indicator.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start_indicator.ps1" %*

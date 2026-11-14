@echo off
rem Double-click to stop the Spark indicator (only its own process).
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0stop_indicator.ps1"

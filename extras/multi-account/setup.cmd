@echo off
rem Runs setup.sh in your default WSL distro (where Claude Code is installed).
rem Extra arguments pass through: setup.cmd --dry-run, setup.cmd --uninstall
cd /d "%~dp0"
wsl.exe -e bash ./setup.sh %*
pause

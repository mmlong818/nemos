@echo off
setlocal
cd /d "%~dp0"
if not exist "%~dp0client\dist\portable\Nemos Companion\Nemos Companion.exe" (
  powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0client\Build-NemosCompanion.ps1"
  if errorlevel 1 pause & exit /b 1
)
start "" "%~dp0client\dist\portable\Nemos Companion\Nemos Companion.exe"

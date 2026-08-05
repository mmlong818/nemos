@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"
if not exist "%~dp0client\dist\portable\小丑鱼\小丑鱼.exe" (
  powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0client\Build-Clownfish.ps1"
  if errorlevel 1 pause & exit /b 1
)
start "" "%~dp0client\dist\portable\小丑鱼\小丑鱼.exe"

@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Start-Vantage-Demo.ps1" %*
if errorlevel 1 (
  echo.
  echo The demo could not start. Read the message above or see README.md.
  pause
)
endlocal

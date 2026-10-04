@echo off
chcp 65001 >nul
setlocal

set "ELECTRON_RUN_AS_NODE="
set "DIR=C:\Users\Administrator\WorkBuddy\2026-09-30-23-40-39\countdown-electron\"
set "EXE=%DIR%node_modules\electron\dist\electron.exe"

if not exist "%EXE%" (
  echo [ERROR] electron.exe not found:
  echo %EXE%
  echo.
  pause
  exit /b 1
)

start "" "%EXE%" "%DIR%."
exit /b 0

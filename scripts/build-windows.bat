@echo off
setlocal

cd /d "%~dp0\.."

if not exist "frontend\package.json" (
  echo Missing frontend\package.json
  exit /b 1
)

if not exist "src-tauri\tauri.conf.json" (
  echo Missing src-tauri\tauri.conf.json
  exit /b 1
)

cd /d "frontend"
if exist "package-lock.json" (
  if not exist "node_modules" (
    call npm ci
    if errorlevel 1 exit /b 1
  )
) else (
  if not exist "node_modules" (
    call npm install
    if errorlevel 1 exit /b 1
  )
)

call npm run build
if errorlevel 1 exit /b 1

cd /d "..\src-tauri"
call cargo tauri build
if errorlevel 1 exit /b 1

exit /b 0

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
  if "%CI%"=="true" (
    call npm ci
    if errorlevel 1 exit /b 1
  ) else (
    if not exist "node_modules" (
      call npm ci
      if errorlevel 1 exit /b 1
    )
  )
) else (
  if not exist "node_modules" (
    call npm install
    if errorlevel 1 exit /b 1
  )
)

cd /d ".."
call npm --prefix frontend exec tauri -- build --ci %*
if errorlevel 1 exit /b 1

exit /b 0

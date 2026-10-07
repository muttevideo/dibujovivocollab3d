@echo off
setlocal
cd /d "%~dp0"
title DibujoVivo 3D - Instalar
where node >nul 2>&1
if errorlevel 1 (
  echo Necesitas Node.js 22 o superior. Instalalo desde https://nodejs.org
  pause
  exit /b 1
)
where npm >nul 2>&1
if errorlevel 1 (
  echo npm no esta disponible. Reinstala Node.js incluyendo npm.
  pause
  exit /b 1
)
echo Instalando dependencias de DibujoVivo 3D...
if exist package-lock.json (
  call npm ci
) else (
  call npm install
)
if errorlevel 1 (
  echo La instalacion fallo. Revisa tu conexion a Internet.
  pause
  exit /b 1
)
echo.
echo Instalacion completa. Ejecuta run.bat y abre http://localhost:3000
if /i not "%~1"=="--no-pause" pause
exit /b 0

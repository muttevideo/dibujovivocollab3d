@echo off
setlocal
cd /d "%~dp0"
title DibujoVivo 3D - Servidor
where node >nul 2>&1
if errorlevel 1 (
  echo Necesitas Node.js 22 o superior. Instalalo desde https://nodejs.org
  pause
  exit /b 1
)
if not exist node_modules\socket.io\package.json (
  echo Primero ejecuta install.bat para instalar las dependencias.
  pause
  exit /b 1
)
if not defined PORT set PORT=3000
echo Abri http://localhost:%PORT% en tu navegador.
echo Mantene esta ventana abierta. Ctrl+C detiene el servidor.
node server.js
if errorlevel 1 (
  echo El servidor termino con un error. Revisa el mensaje anterior.
  pause
  exit /b 1
)
exit /b 0

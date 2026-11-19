@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Pedido Seguro - Sport Champion

where node >nul 2>nul
if errorlevel 1 (
  echo No se encontro Node.js. Instalalo desde https://nodejs.org ^(version LTS^) y vuelve a abrir este archivo.
  pause
  exit /b 1
)

if not exist node_modules (
  echo Instalando dependencias, solo la primera vez...
  call npm install
  if errorlevel 1 (
    echo La instalacion fallo. Revisa tu conexion a internet.
    pause
    exit /b 1
  )
)

if exist whatsapp-config.bat (
  call whatsapp-config.bat
  echo WhatsApp: usando la configuracion de whatsapp-config.bat ^(envios reales^).
) else (
  echo WhatsApp: modo simulacion ^(los avisos se registran pero no salen al celular^).
)

if exist correo-config.bat (
  call correo-config.bat
  echo Correo: usando la configuracion de correo-config.bat ^(envios reales^).
) else (
  echo Correo: modo simulacion ^(los avisos se registran pero no se envian^).
)

echo.
echo Abriendo http://localhost:3000 en tu navegador. Para detener el servidor cierra esta ventana.
start "" http://localhost:3000
call npm run server
pause

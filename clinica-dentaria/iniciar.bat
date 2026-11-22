@echo off
title Clinica Dentaria - Servidor
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo O Node.js nao esta instalado. Instale a versao LTS 22 ou superior em https://nodejs.org e volte a executar.
  pause
  exit /b 1
)
start "" http://localhost:3000
node server.js
pause

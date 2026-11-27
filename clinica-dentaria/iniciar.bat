@echo off
title Clinica Dentaria - Servidor
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo O Node.js nao esta instalado. Instale a versao LTS 22 ou superior em https://nodejs.org e volte a executar.
  pause
  exit /b 1
)
set ENDERECO=http://localhost:3000
if exist "data\certificado.pem" if exist "data\chave.pem" set ENDERECO=https://localhost:3000
if defined HTTPS_CERT if defined HTTPS_KEY set ENDERECO=https://localhost:3000
start "" %ENDERECO%
node server.js
pause

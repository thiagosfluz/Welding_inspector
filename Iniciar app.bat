@echo off
title Inspetor de Solda
cd /d "%~dp0"
where python >nul 2>nul
if errorlevel 1 (
  echo Python nao encontrado. Instale em https://www.python.org/downloads/ e marque "Add python to PATH".
  pause
  exit /b 1
)
python servidor.py
pause

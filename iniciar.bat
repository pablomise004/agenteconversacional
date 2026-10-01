@echo off
rem Arranca Lince (el agente conversacional) en Windows (doble clic).
chcp 65001 >nul
cd /d "%~dp0"
if not exist ".venv\Scripts\python.exe" (
  echo Preparando el entorno de Python ^(solo la primera vez^)...
  py -3 -m venv .venv 2>nul || python -m venv .venv
  if errorlevel 1 (
    echo.
    echo No se ha encontrado Python. Instalalo desde https://www.python.org/downloads/
    echo y marca la casilla "Add python.exe to PATH".
    pause
    exit /b 1
  )
)
echo Comprobando dependencias...
".venv\Scripts\python.exe" -m pip install --disable-pip-version-check --no-input -q -r requirements.txt
if errorlevel 1 (
  echo Error instalando las dependencias. Revisa tu conexion a Internet.
  pause
  exit /b 1
)
".venv\Scripts\python.exe" -m app %*
pause

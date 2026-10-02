@echo off
rem Arranca Lince (el agente conversacional) en Windows: doble clic en este archivo.
rem Los mensajes van sin tildes a proposito: la consola de Windows no siempre las muestra bien.
chcp 65001 >nul
title Lince
cd /d "%~dp0"

rem Abierto desde dentro del ZIP sin descomprimir: Windows solo saca este archivo a una carpeta temporal
if not exist "app\__main__.py" (
  echo.
  echo  Falta el resto de Lince junto a este archivo.
  echo  Seguramente lo has abierto desde dentro del ZIP sin descomprimirlo:
  echo  haz clic derecho en el ZIP, elige "Extraer todo..." y abre iniciar.bat
  echo  desde la carpeta que se crea.
  echo.
  pause
  exit /b 1
)

if not exist ".venv\Scripts\python.exe" (
  echo.
  echo  Preparando Lince por primera vez ^(uno o dos minutos; hace falta Internet^)...
  py -3 -m venv .venv 2>nul || python -m venv .venv
)
if not exist ".venv\Scripts\python.exe" (
  echo.
  echo  No se ha encontrado Python. Instalalo de una de estas dos formas:
  echo   - desde la Microsoft Store: busca Python y pulsa Obtener
  echo   - o desde https://www.python.org/downloads/ marcando la casilla "Add python.exe to PATH"
  echo  Despues vuelve a abrir iniciar.bat.
  echo.
  pause
  exit /b 1
)

rem Lince necesita Python 3.11 o superior; con uno antiguo se borra .venv para rehacerlo con el nuevo
".venv\Scripts\python.exe" -c "import sys; v = sys.version_info; ok = v >= (3, 11); ok or print(f'\n  Tu Python es la version {v.major}.{v.minor} y Lince necesita la 3.11 o superior.\n  Instala la ultima desde https://www.python.org/downloads/ y vuelve a abrir iniciar.bat.\n'); sys.exit(0 if ok else 1)"
if errorlevel 1 (
  rmdir /s /q .venv
  pause
  exit /b 1
)

rem La primera vez (o si falta algo) se instala con el progreso a la vista; despues, en silencio y sin Internet
".venv\Scripts\python.exe" -c "import fastapi, uvicorn, numpy, snowballstemmer, tzdata" 2>nul
if errorlevel 1 (
  echo  Instalando lo que necesita Lince...
  echo.
  ".venv\Scripts\python.exe" -m pip install --disable-pip-version-check --no-input -r requirements.txt
) else (
  ".venv\Scripts\python.exe" -m pip install --disable-pip-version-check --no-input -q -r requirements.txt
)
if errorlevel 1 (
  echo.
  echo  No se ha podido instalar lo que necesita Lince: revisa la conexion a Internet.
  echo  Si estas en la red del instituto y no deja, prueba en casa o con los datos
  echo  del movil. Solo hace falta la primera vez: despues funciona sin Internet.
  echo.
  pause
  exit /b 1
)

echo.
echo  Deja esta ventana abierta mientras uses Lince. Para terminar, cierrala.
".venv\Scripts\python.exe" -m app %*
pause

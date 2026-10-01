#!/usr/bin/env sh
# Arranca el Agente conversacional en Linux / macOS:  ./iniciar.sh
set -e
cd "$(dirname "$0")"
if [ ! -x .venv/bin/python ]; then
  echo "Preparando el entorno de Python (solo la primera vez)..."
  python3 -m venv .venv
fi
.venv/bin/python -m pip install --disable-pip-version-check --no-input -q -r requirements.txt
exec .venv/bin/python -m app "$@"

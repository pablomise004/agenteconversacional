"""Cuentas de un servidor con usuarios (AGENTE_ACCOUNTS), para su dueño.

    python -m app.users                    lista los usuarios con sus agentes
    python -m app.users password lucia    pone otra contraseña a «lucia» (la pide dos veces)

Usa la carpeta de datos de AGENTE_DATA_DIR (en la imagen Docker, /data) o la de --data. En Coolify se
ejecuta desde la pestaña Terminal de la aplicación.
"""

import argparse
import getpass
import json
import os
import sys
import time
from pathlib import Path

from .spaces import AccountError, Accounts, Spaces


def main() -> None:
    parser = argparse.ArgumentParser(description="Cuentas de un servidor de Lince con usuarios")
    parser.add_argument("--data", default=os.environ.get("AGENTE_DATA_DIR") or "data", help="carpeta de datos")
    sub = parser.add_subparsers(dest="cmd")
    pw = sub.add_parser("password", help="poner otra contraseña a un usuario")
    pw.add_argument("user")
    args = parser.parse_args()
    data = Path(args.data)
    accounts = Accounts(data)

    if args.cmd == "password":
        new = getpass.getpass(f"Contraseña nueva para {args.user}: ")
        if getpass.getpass("Otra vez: ") != new:
            sys.exit("No coinciden.")
        try:
            accounts.reset_password(args.user, new)
        except AccountError as e:
            sys.exit(str(e))
        print("Hecho: ya puede entrar con la contraseña nueva.")
        return

    files = sorted(accounts.dir.glob("*.json"))
    if not files:
        print(f"No hay usuarios en {accounts.dir}")
    for f in files:
        record = json.loads(f.read_text(encoding="utf-8"))
        agents = data / "spaces" / Spaces.id_of(record["space"]) / "agents"
        n = len(list(agents.glob("*.json"))) if agents.is_dir() else 0
        created = time.strftime("%Y-%m-%d", time.localtime(record.get("created", 0)))
        print(f"{record['user']:<30} {n:>3} agentes   desde {created}")


if __name__ == "__main__":
    main()

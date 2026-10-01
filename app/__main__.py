"""Arranque: python -m app [--host 127.0.0.1] [--port 8000] [--no-browser]"""

import argparse
import json
import os
import sys
import threading
import urllib.error
import urllib.request
import webbrowser

from . import __version__


def running_lince(url: str) -> dict | None:
    """Mira si ya hay algo escuchando en `url`. Devuelve su /api/info si es un Lince,
    {} si es otro programa y None si el puerto está libre."""
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))  # sin proxy: es local
    try:
        with opener.open(url + "/api/info", timeout=1.5) as r:
            data = json.loads(r.read().decode("utf-8"))
    except (urllib.error.HTTPError, ValueError):  # contesta, pero no es un Lince
        return {}
    except OSError:  # nadie escuchando
        return None
    return data if isinstance(data, dict) and "version" in data else {}


def main() -> None:
    parser = argparse.ArgumentParser(description="Lince: chatbots en español (alternativa libre a Dialogflow)")
    parser.add_argument("--host", default=os.environ.get("HOST", "127.0.0.1"),
                        help="dirección (0.0.0.0 para acceder desde otros equipos)")
    parser.add_argument("--port", type=int, default=int(os.environ.get("PORT", "8000")))
    parser.add_argument("--data", default=None, help="carpeta de datos (por defecto ./data)")
    parser.add_argument("--no-browser", action="store_true", help="no abrir el navegador")
    args = parser.parse_args()
    if args.data:
        os.environ["AGENTE_DATA_DIR"] = args.data

    local = args.host in ("0.0.0.0", "127.0.0.1", "localhost")
    url = f"http://{'localhost' if local else args.host}:{args.port}"

    # Si sigue abierto un Lince anterior (p. ej. tras un git pull), el nuevo no podría usar el
    # puerto y el navegador abriría el viejo sin que se note: mejor decirlo claramente.
    other = running_lince(f"http://{'127.0.0.1' if local else args.host}:{args.port}")
    if other is not None:
        if other and other.get("version") == __version__ and not other.get("restartNeeded"):
            print(f"\n  Lince ya estaba en marcha: {url}\n")
            if not args.no_browser:
                webbrowser.open(url)
            return
        if other:
            print(f"\n  Ya hay otro Lince en marcha en {url} (versión {other.get('version')}) con el código anterior."
                  f"\n  Ciérralo (cierra su ventana o pulsa Ctrl+C en ella) y vuelve a arrancar para usar la versión {__version__}."
                  f"\n  O arranca este en otro puerto: python -m app --port {args.port + 1}\n")
        else:
            print(f"\n  El puerto {args.port} ya lo está usando otro programa."
                  f"\n  Arranca en otro puerto: python -m app --port {args.port + 1}\n")
        sys.exit(1)

    import uvicorn

    from .server import create_app

    app = create_app()
    print(f"\n  Lince {__version__} en marcha: {url}\n  Referencia de la API: {url}/docs\n  (Ctrl+C para parar)\n")
    if not args.no_browser:
        threading.Timer(1.2, lambda: webbrowser.open(url)).start()
    uvicorn.run(app, host=args.host, port=args.port, log_level="warning")


if __name__ == "__main__":
    main()

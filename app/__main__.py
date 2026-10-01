"""Arranque: python -m app [--host 127.0.0.1] [--port 8000] [--no-browser]"""

import argparse
import os
import threading
import webbrowser


def main() -> None:
    parser = argparse.ArgumentParser(description="Agente conversacional (alternativa a Dialogflow)")
    parser.add_argument("--host", default=os.environ.get("HOST", "127.0.0.1"),
                        help="dirección (0.0.0.0 para acceder desde otros equipos)")
    parser.add_argument("--port", type=int, default=int(os.environ.get("PORT", "8000")))
    parser.add_argument("--data", default=None, help="carpeta de datos (por defecto ./data)")
    parser.add_argument("--no-browser", action="store_true", help="no abrir el navegador")
    args = parser.parse_args()
    if args.data:
        os.environ["AGENTE_DATA_DIR"] = args.data

    import uvicorn

    from .server import create_app

    app = create_app()
    url = f"http://{'localhost' if args.host in ('0.0.0.0', '127.0.0.1') else args.host}:{args.port}"
    print(f"\n  Agente conversacional en marcha: {url}\n  API: {url}/docs\n  (Ctrl+C para parar)\n")
    if not args.no_browser:
        threading.Timer(1.2, lambda: webbrowser.open(url)).start()
    uvicorn.run(app, host=args.host, port=args.port, log_level="warning")


if __name__ == "__main__":
    main()

"""Pone al día la copia de Vigía que sirve Lince (web/js/vigia.js).

Uso:
    python tools/actualizar_vigia.py [dirección del script]

Vigía (vitales y errores de las páginas de la web pública, en la web de Pablo) se sirve desde Lince en
vez de cargarse de su web: así las páginas no ejecutan código de otro sitio, la CSP solo permite scripts
de aquí y la copia no cambia sin pasar por el repositorio. Sus datos los sigue mandando a su web
(VIGIA_INGESTA en app/server.py). Solo se usa si el servidor tiene AGENTE_VIGIA_CLAVE.

Ejecútalo cuando cambie Vigía y sube el fichero (pásale otra dirección si el script se mueve).
"""

import sys
import urllib.request
from pathlib import Path

SRC = "https://nexopablooms.duckdns.org/herramientas/vigia/vigia.js"
DEST = Path(__file__).resolve().parent.parent / "web" / "js" / "vigia.js"


def main() -> None:
    src = sys.argv[1] if len(sys.argv) > 1 else SRC
    with urllib.request.urlopen(src, timeout=20) as res:
        code = res.read().decode("utf-8")
    if "sendBeacon" not in code or "data" not in code:
        sys.exit(f"Lo descargado de {src} no parece Vigía: no se cambia nada")
    old = DEST.read_text(encoding="utf-8") if DEST.exists() else ""
    if code == old:
        print("La copia ya estaba al día:", DEST)
        return
    DEST.write_bytes(code.replace("\r\n", "\n").encode("utf-8"))
    print(f"Copia actualizada ({len(code)} caracteres): {DEST}")


if __name__ == "__main__":
    main()

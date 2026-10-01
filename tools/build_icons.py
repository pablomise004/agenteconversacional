"""Genera los iconos de la consola a partir del logotipo (web/favicon.svg).

Uso:
    pip install playwright
    python tools/build_icons.py

Crea, a partir del SVG:
    web/favicon.ico                 16, 32 y 48 px (navegadores y programas antiguos)
    web/icons/icon-192.png          icono de la aplicación instalada
    web/icons/icon-512.png
    web/icons/icon-maskable-512.png Android: fondo a sangre y marca dentro de la zona segura
    web/icons/apple-touch-icon.png  180 px, sin esquinas transparentes (iOS las redondea)

El SVG se dibuja con Chromium (Playwright), así que se ve igual que en el navegador.
Vuelve a ejecutarlo si cambias el logotipo.
"""

import base64
import struct
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
WEB = ROOT / "web"
SVG = (WEB / "favicon.svg").read_text(encoding="utf-8")


def variant(full_bleed: bool = False, scale: float = 1.0) -> str:
    """El logotipo con fondo cuadrado (sin redondear) y la marca reducida, si se pide."""
    svg = SVG
    if full_bleed:
        svg = svg.replace('rx="9"', 'rx="0"')
    if scale != 1.0:
        svg = svg.replace('<g class="marca">',
                          f'<g class="marca" transform="translate(16 16) scale({scale}) translate(-16 -16)">')
    return svg


def render(page, svg: str, size: int) -> bytes:
    data = base64.b64encode(svg.encode("utf-8")).decode("ascii")
    page.set_content(f'<html><body style="margin:0;background:transparent">'
                     f'<img id="i" width="{size}" height="{size}" style="display:block" '
                     f'src="data:image/svg+xml;base64,{data}"></body></html>')
    page.wait_for_function("document.getElementById('i').complete")
    return page.locator("#i").screenshot(omit_background=True)


def ico(pngs: dict[int, bytes]) -> bytes:
    """Fichero .ico con las imágenes PNG dentro (formato admitido desde Windows Vista)."""
    head = struct.pack("<HHH", 0, 1, len(pngs))
    entries, blobs = b"", b""
    offset = 6 + 16 * len(pngs)
    for size, png in sorted(pngs.items()):
        entries += struct.pack("<BBBBHHII", size % 256, size % 256, 0, 0, 1, 32, len(png), offset + len(blobs))
        blobs += png
    return head + entries + blobs


def main() -> None:
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        sys.exit("Hace falta Playwright: pip install playwright")
    icons = WEB / "icons"
    icons.mkdir(exist_ok=True)
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(device_scale_factor=1)
        (WEB / "favicon.ico").write_bytes(ico({s: render(page, SVG, s) for s in (16, 32, 48)}))
        (icons / "icon-192.png").write_bytes(render(page, SVG, 192))
        (icons / "icon-512.png").write_bytes(render(page, SVG, 512))
        (icons / "icon-maskable-512.png").write_bytes(render(page, variant(True, 0.74), 512))
        (icons / "apple-touch-icon.png").write_bytes(render(page, variant(True, 0.86), 180))
        browser.close()
    for f in [WEB / "favicon.ico", *sorted(icons.glob("*.png"))]:
        print(f"{f.relative_to(ROOT)}  {f.stat().st_size / 1024:.1f} KB")


if __name__ == "__main__":
    main()

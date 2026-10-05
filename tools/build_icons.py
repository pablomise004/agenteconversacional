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
    web/og.png                      1200 × 630: la vista previa al pegar el enlace (WhatsApp, X…)

El SVG se dibuja con Edge o Chrome si están instalados (si no, con el Chromium de Playwright),
así que se ve igual que en el navegador. Vuelve a ejecutarlo si cambias el logotipo.
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


OG_HTML = """<html><head><style>
@font-face { font-family: Inter; src: url(data:font/woff2;base64,{font}) format("woff2"); font-weight: 100 900; }
* { box-sizing: border-box; }
body { margin: 0; width: 1200px; height: 630px; overflow: hidden; font-family: Inter, sans-serif; color: #16171b;
  background: radial-gradient(760px 520px at 0% -10%, rgba(91, 92, 246, .22), transparent 62%),
              radial-gradient(720px 560px at 105% 115%, rgba(150, 69, 238, .2), transparent 60%), #f7f7f8; }
.wrap { position: absolute; inset: 0; padding: 64px 76px; display: flex; flex-direction: column; }
.brand { display: flex; align-items: center; gap: 20px; font-size: 40px; font-weight: 700; letter-spacing: -.02em; }
.brand img { width: 84px; height: 84px; filter: drop-shadow(0 12px 24px rgba(91, 92, 246, .35)); }
h1 { margin: 44px 0 0; font-size: 74px; line-height: 1.04; font-weight: 760; letter-spacing: -.035em; max-width: 1000px; }
h1 em { font-style: normal; color: #4338ca; }
.demo { margin-top: auto; display: flex; align-items: center; gap: 12px; white-space: nowrap; }
.msg { padding: 14px 22px; border-radius: 22px 22px 6px 22px; color: #fff; font-size: 25px; margin-right: 10px;
  background: linear-gradient(135deg, #5b5cf6, #9645ee); box-shadow: 0 14px 28px -14px #9645ee; }
mark { color: #1b2232; border-radius: 8px; padding: 0 6px; }
.chip { padding: 10px 16px; border-radius: 12px; font-size: 22px; background: #fff; border: 2px solid #e7e8eb; color: #5f6471; }
.chip b { color: #16171b; font-weight: 650; }
.intent { font-family: "Cascadia Code", Consolas, monospace; font-weight: 650; color: #4338ca; background: #eeedfd;
  border-color: rgba(79, 70, 229, .22); }
</style></head><body><div class="wrap">
<div class="brand"><img src="data:image/svg+xml;base64,{logo}">Lince</div>
<h1>Crea chatbots en español y <em>mira cómo aprenden</em></h1>
<div class="demo">
  <span class="msg">quiero <mark style="background:#c8ecff">dos</mark> pizzas <mark style="background:#ffe3a3">barbacoa</mark>
    <mark style="background:#d9f5c9">familiares</mark></span>
  <span class="chip intent">pedido.pizza</span>
  <span class="chip">cantidad <b>2</b></span><span class="chip">tamano <b>familiar</b></span>
</div></div></body></html>"""


def og_image(page) -> bytes:
    """La imagen de las vistas previas (Open Graph): el logotipo, el lema y una frase de ejemplo."""
    font = base64.b64encode((WEB / "fonts" / "inter-latin.woff2").read_bytes()).decode("ascii")
    logo = base64.b64encode(SVG.encode("utf-8")).decode("ascii")
    page.set_viewport_size({"width": 1200, "height": 630})
    page.set_content(OG_HTML.replace("{font}", font).replace("{logo}", logo))
    page.evaluate("document.fonts.ready")
    page.wait_for_function("[...document.images].every((i) => i.complete)")
    return page.screenshot(type="png")


def ico(pngs: dict[int, bytes]) -> bytes:
    """Fichero .ico con las imágenes PNG dentro (formato admitido desde Windows Vista)."""
    head = struct.pack("<HHH", 0, 1, len(pngs))
    entries, blobs = b"", b""
    offset = 6 + 16 * len(pngs)
    for size, png in sorted(pngs.items()):
        entries += struct.pack("<BBBBHHII", size % 256, size % 256, 0, 0, 1, 32, len(png), offset + len(blobs))
        blobs += png
    return head + entries + blobs


def launch(p):
    for channel in ("msedge", "chrome", None):
        try:
            return p.chromium.launch(channel=channel) if channel else p.chromium.launch()
        except Exception:  # noqa: BLE001 - ese navegador no está instalado
            continue
    sys.exit("No hay navegador disponible (python -m playwright install chromium)")


def main() -> None:
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        sys.exit("Hace falta Playwright: pip install playwright")
    icons = WEB / "icons"
    icons.mkdir(exist_ok=True)
    with sync_playwright() as p:
        browser = launch(p)
        page = browser.new_page(device_scale_factor=1)
        (WEB / "favicon.ico").write_bytes(ico({s: render(page, SVG, s) for s in (16, 32, 48)}))
        (icons / "icon-192.png").write_bytes(render(page, SVG, 192))
        (icons / "icon-512.png").write_bytes(render(page, SVG, 512))
        (icons / "icon-maskable-512.png").write_bytes(render(page, variant(True, 0.74), 512))
        (icons / "apple-touch-icon.png").write_bytes(render(page, variant(True, 0.86), 180))
        (WEB / "og.png").write_bytes(og_image(page))
        browser.close()
    for f in [WEB / "favicon.ico", *sorted(icons.glob("*.png")), WEB / "og.png"]:
        print(f"{f.relative_to(ROOT)}  {f.stat().st_size / 1024:.1f} KB")


if __name__ == "__main__":
    main()

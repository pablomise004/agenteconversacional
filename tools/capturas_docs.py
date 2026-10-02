"""Rehace las capturas de la documentación (docs/img/*.png) con la consola actual.

Uso:
    pip install playwright
    python tools/capturas_docs.py            # todas
    python tools/capturas_docs.py api chat   # solo algunas

Arranca un servidor temporal con el agente de ejemplo (sin tocar data/), simula
unas conversaciones y fotografía cada pantalla a 1440×860. Usa Edge o Chrome si
están instalados; si no, el Chromium de Playwright.
"""

import json
import socket
import sys
import tempfile
import threading
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
OUT = ROOT / "docs" / "img"
SIZE = {"width": 1440, "height": 860}


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def start_server() -> tuple[str, object]:
    import uvicorn

    from app.server import create_app

    port = free_port()
    server = uvicorn.Server(uvicorn.Config(create_app(Path(tempfile.mkdtemp())), host="127.0.0.1", port=port,
                                           log_level="warning"))
    threading.Thread(target=server.run, daemon=True).start()
    base = f"http://127.0.0.1:{port}"
    for _ in range(100):
        try:
            urllib.request.urlopen(base + "/api/info", timeout=1)
            break
        except OSError:
            time.sleep(0.1)
    # algo de historial para Revisión e Historial
    for i, text in enumerate(["hola", "quiero una pizza barbacoa familiar", "a domicilio", "reservar un vuelo a roma",
                              "cuál es el horario", "teneis opciones sin gluten"]):
        req = urllib.request.Request(base + "/api/agents/pizzeria/detect", method="POST",
                                     data=json.dumps({"sessionId": f"demo{i // 2}", "text": text}).encode(),
                                     headers={"Content-Type": "application/json"})
        urllib.request.urlopen(req).read()
    return base, server


def launch(p):
    for channel in ("msedge", "chrome", None):
        try:
            return p.chromium.launch(channel=channel) if channel else p.chromium.launch()
        except Exception:  # noqa: BLE001 - ese navegador no está instalado
            continue
    sys.exit("No hay navegador disponible (python -m playwright install chromium)")


def scroll_to(page, selector, offset=16, nth=0):
    page.evaluate("""([sel, off, nth]) => {
        const main = document.querySelector('.main');
        const el = document.querySelectorAll(sel)[nth];
        if (main && el) main.scrollTop = el.getBoundingClientRect().top - main.getBoundingClientRect().top + main.scrollTop - off;
    }""", [selector, offset, nth])
    page.wait_for_timeout(400)


def scroll_to_card(page, title, offset=16):
    """Desplaza la página hasta la tarjeta cuyo título contiene `title`."""
    page.evaluate("""([title, off]) => {
        const main = document.querySelector('.main');
        const h2 = [...document.querySelectorAll('.card-head h2')].find((x) => x.textContent.includes(title));
        const card = h2 && h2.closest('.card');
        if (main && card) main.scrollTop = card.getBoundingClientRect().top - main.getBoundingClientRect().top + main.scrollTop - off;
    }""", [title, offset])
    page.wait_for_timeout(400)


def chat_in_simulator(page):
    """Una conversación en el panel «Pruébalo», con el detalle de un turno abierto."""
    for text in ["quiero una pizza barbacoa", "grande"]:
        page.fill(".sim-foot input", text)
        page.press(".sim-foot input", "Enter")
        page.wait_for_timeout(900)
    page.locator(".turn-meta .intent-link").last.click()
    page.fill(".sim-foot input", "a domicilio")
    page.press(".sim-foot input", "Enter")
    page.wait_for_timeout(1000)


def console_page(browser, base, dark=False):
    ctx = browser.new_context(viewport=SIZE, locale="es-ES", color_scheme="dark" if dark else "light")
    page = ctx.new_page()
    page.goto(base + "/#/a/pizzeria/intents")
    page.wait_for_selector(".list-item")
    return page


def shot(page, name):
    page.mouse.move(0, 0)
    page.wait_for_timeout(500)
    page.screenshot(path=str(OUT / f"{name}.png"))
    print(f"docs/img/{name}.png")


def explain(page, text):
    card = page.locator(".card", has_text="Sigue una frase")
    card.locator("input").fill(text)
    card.locator("button", has_text="Explicar").click()
    page.wait_for_selector(".flow .flow-step")
    page.wait_for_timeout(700)


def scenes(browser, base, only):
    def want(name):
        return not only or name in only

    page = console_page(browser, base)
    chat_in_simulator(page)
    if want("editor"):
        pid = next(i["id"] for i in json.loads(urllib.request.urlopen(base + "/api/agents/pizzeria").read())["intents"]
                   if i["name"] == "pedido.pizza")
        page.goto(f"{base}/#/a/pizzeria/intents/{pid}")
        page.wait_for_selector(".phrase-row")
        scroll_to_card(page, "Frases de entrenamiento", offset=96)
        shot(page, "editor")
    if want("analizador"):
        page.goto(base + "/#/a/pizzeria/analyzer?q=me%20pones%20dos%20pizas%20barbacoa%20familiares%20pa%20ma%C3%B1ana"
                         "%20a%20las%209%20de%20la%20noche%20xfa")
        page.wait_for_selector(".token-grid")
        page.locator("button", has_text="No, corregir").click()
        page.wait_for_timeout(600)
        shot(page, "analizador")
    if want("entrenar") or want("curva") or want("explicar") or want("mapa") or want("examen"):
        page.goto(base + "/#/a/pizzeria/learn")
        page.wait_for_selector(".steps .step")
        page.wait_for_timeout(1200)
        if want("entrenar"):
            shot(page, "entrenar")
        if want("curva"):
            scroll_to(page, ".step", nth=4)
            shot(page, "curva")
        explain(page, "me pones una barbacoa grande")
        if want("explicar"):
            scroll_to(page, ".flow")
            shot(page, "explicar")
        if want("mapa"):
            ids = {i["name"]: i["id"] for i in json.loads(urllib.request.urlopen(base + "/api/agents/pizzeria").read())["intents"]}
            page.select_option("select[aria-label='Intención resaltada en azul']", ids["pedido.pizza"])
            page.select_option("select[aria-label='Intención resaltada en naranja']", ids["reserva.mesa"])
            scroll_to_card(page, "Mapa de frases")
            shot(page, "mapa")
        if want("examen"):
            page.locator("button", has_text="Hacer el examen").click()
            page.wait_for_selector(".heatmap", state="attached", timeout=120000)
            page.wait_for_timeout(900)
            page.locator("summary", has_text="Ver la matriz de confusión").click()
            page.wait_for_timeout(400)
            scroll_to(page, ".heatmap-wrap", offset=430)
            shot(page, "examen")
    if want("paleta"):
        page.goto(base + "/#/a/pizzeria/intents")
        page.wait_for_selector(".list-item")
        page.keyboard.press("Control+k")
        page.keyboard.type("pizza")
        page.wait_for_timeout(500)
        shot(page, "paleta")
    page.context.close()

    if want("oscuro"):
        page = console_page(browser, base, dark=True)
        page.goto(base + "/#/a/pizzeria/learn")
        page.wait_for_selector(".steps .step")
        explain(page, "me pones una barbacoa grande")
        scroll_to(page, ".flow")
        shot(page, "oscuro")
        page.context.close()

    if want("pordentro"):  # «Por dentro»: la regresión logística con la frase de ejemplo
        ctx = browser.new_context(viewport=SIZE, locale="es-ES")
        ctx.add_init_script("localStorage.setItem('agente.sim', '0')")
        page = ctx.new_page()
        page.goto(base + "/#/a/pizzeria/inside")
        page.wait_for_function("document.querySelectorAll('.inside .live-body').length > 0 && "
                               "document.querySelectorAll('.inside .live-body:empty').length === 0", timeout=30000)
        page.wait_for_timeout(800)
        scroll_to(page, "#in-regresion", offset=-500)
        page.wait_for_timeout(900)
        shot(page, "pordentro")
        ctx.close()

    if want("hotel"):  # el ejemplo grande: reserva con resumen, un cambio y una avería
        ctx = browser.new_context(viewport=SIZE, locale="es-ES")
        page = ctx.new_page()
        page.goto(base + "/#/a/hotel/intents")
        page.wait_for_selector(".list-item")
        for text in ["Quiero una suite del 3 al 6 de diciembre para 2 personas", "mejor para 3 personas",
                     "no se enciende la tele de la 215"]:
            before = page.locator(".sim .msg.bot").count()
            page.fill(".sim-foot input", text)
            page.press(".sim-foot input", "Enter")
            # la primera respuesta tarda más: entrena el modelo del hotel
            page.wait_for_function(f"document.querySelectorAll('.sim .msg.bot').length > {before}", timeout=30000)
            page.wait_for_timeout(700)
        shot(page, "hotel")
        ctx.close()

    if want("api"):
        ctx = browser.new_context(viewport=SIZE, locale="es-ES")
        page = ctx.new_page()
        page.goto(base + "/docs#post-api-agents-agent_id-detect")
        page.wait_for_selector(".ep.open")
        page.locator("#post-api-agents-agent_id-detect .try .btn.primary").click()
        page.wait_for_selector("#post-api-agents-agent_id-detect .resp")
        page.wait_for_timeout(600)
        page.evaluate("document.querySelector('#post-api-agents-agent_id-detect .try').scrollIntoView({block: 'start'}); scrollBy(0, -76)")
        page.wait_for_timeout(600)
        shot(page, "api")
        ctx.close()

    if want("chat"):
        ctx = browser.new_context(viewport={"width": 900, "height": 760}, locale="es-ES")
        page = ctx.new_page()
        page.goto(base + "/chat?agent=pizzeria")
        page.wait_for_timeout(1500)
        box = page.locator("[data-agente-widget] >> css=input")
        for text in ["quiero una pizza barbacoa", "familiar"]:
            box.fill(text)
            box.press("Enter")
            page.wait_for_timeout(1000)
        shot(page, "chat")
        ctx.close()


def main() -> None:
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        sys.exit("Hace falta Playwright: pip install playwright")
    base, server = start_server()
    try:
        with sync_playwright() as p:
            browser = launch(p)
            scenes(browser, base, set(sys.argv[1:]))
            browser.close()
    finally:
        server.should_exit = True


if __name__ == "__main__":
    main()

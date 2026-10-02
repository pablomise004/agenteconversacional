"""Pruebas de la consola web en un navegador real (Playwright).

Se saltan solas si no está instalado Playwright. Para ejecutarlas:
    pip install playwright
    python -m pytest tests/e2e -m e2e
Usan Microsoft Edge o Google Chrome si están instalados; si no, el Chromium de
Playwright (`python -m playwright install chromium`).
"""

import json
import socket
import threading
import time
import urllib.request

import pytest

playwright = pytest.importorskip("playwright.sync_api")
uvicorn = pytest.importorskip("uvicorn")

from app.server import create_app  # noqa: E402

pytestmark = pytest.mark.e2e


def _free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


@pytest.fixture(scope="module")
def base_url(tmp_path_factory):
    port = _free_port()
    config = uvicorn.Config(create_app(tmp_path_factory.mktemp("datos")), host="127.0.0.1", port=port,
                            log_level="warning")
    server = uvicorn.Server(config)
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()
    url = f"http://127.0.0.1:{port}"
    for _ in range(100):
        try:
            urllib.request.urlopen(url + "/api/info", timeout=1)
            break
        except OSError:
            time.sleep(0.1)
    yield url
    server.should_exit = True
    thread.join(timeout=5)


@pytest.fixture(scope="module")
def browser():
    with playwright.sync_playwright() as p:
        last = None
        for channel in ("msedge", "chrome", None):
            try:
                b = p.chromium.launch(channel=channel, headless=True) if channel else p.chromium.launch(headless=True)
                break
            except Exception as e:  # noqa: BLE001 - navegador no disponible
                last = e
        else:
            pytest.skip(f"No hay navegador disponible: {last}")
        yield b
        b.close()


@pytest.fixture()
def page(browser):
    ctx = browser.new_context(viewport={"width": 1440, "height": 900}, locale="es-ES")
    pg = ctx.new_page()
    pg.errors = []
    pg.on("pageerror", lambda e: pg.errors.append(str(e)))
    pg.on("console", lambda m: pg.errors.append(m.text) if m.type == "error" else None)
    pg.on("dialog", lambda d: d.accept())
    yield pg
    ctx.close()


def api(base, path, body=None):
    req = urllib.request.Request(base + path, data=json.dumps(body).encode() if body is not None else None,
                                 method="POST" if body is not None else "GET",
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req) as r:
        return json.loads(r.read().decode())


def select_text(page, locator, word):
    """Selecciona una palabra dentro de una frase anotable y suelta el ratón."""
    page.evaluate("""([el, word]) => {
        const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
        let n;
        while ((n = walker.nextNode())) {
            const i = n.nodeValue.indexOf(word);
            if (i >= 0) {
                const r = document.createRange();
                r.setStart(n, i); r.setEnd(n, i + word.length);
                const s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
                el.dispatchEvent(new MouseEvent('mouseup', {bubbles: true}));
                return;
            }
        }
    }""", [locator.element_handle(), word])


@pytest.mark.parametrize("route,selector", [
    ("intents", ".list-item"), ("entities", ".list-item"), ("analyzer?q=hola", ".token-grid"),
    ("learn", ".steps .step"), ("training", ".tabs"), ("history", ".stat"), ("integrations", ".code-block"),
    ("settings", "input[type=range]"), ("guide", ".md h2"), ("inside", ".inside .formula math"),
])
def test_paginas_cargan_sin_errores(base_url, page, route, selector):
    page.goto(f"{base_url}/#/a/pizzeria/{route}")
    page.wait_for_selector(selector, timeout=20000)
    assert page.errors == []


def test_por_dentro_calcula_con_la_frase(base_url, page):
    """«Por dentro» analiza la frase de ejemplo, rellena el recorrido y se puede cambiar la frase."""
    page.goto(f"{base_url}/#/inside")
    page.wait_for_function("document.querySelectorAll('.inside .live-body:empty').length === 0", timeout=30000)
    assert page.locator(".pl-val").first.inner_text().endswith("tokens")
    assert page.locator(".wf-row.total").count() == 1
    page.fill(".in-input input", "hola buenas")
    page.locator(".in-input button").click()
    playwright.expect(page.locator(".pl-val").first).to_have_text("2 tokens")
    assert page.errors == []


def test_editar_intencion_y_anotar(base_url, page):
    pid = next(i["id"] for i in api(base_url, "/api/agents/pizzeria")["intents"] if i["name"] == "pedido.pizza")
    page.goto(f"{base_url}/#/a/pizzeria/intents/{pid}")
    add = page.locator("input[aria-label='Nueva frase de entrenamiento']")
    add.fill("me apetece una barbacoa pequeña")
    add.press("Enter")
    first = page.locator(".phrase-row").first
    playwright.expect(first).to_contain_text("me apetece una barbacoa pequeña")
    page.wait_for_timeout(300)
    assert first.locator(".ann").all_inner_texts() == ["barbacoa", "pequeña"]
    add.fill("quiero pizza para el sábado")
    add.press("Enter")
    page.wait_for_timeout(400)
    row = page.locator(".phrase-row").first
    row.locator(".ann", has_text="sábado").click()
    page.locator(".popover button", has_text="Quitar").click()
    select_text(page, row.locator(".phrase"), "pizza")
    page.fill(".popover input[type=search]", "sys.any")
    page.locator(".popover .opt").first.click()
    assert row.locator(".ann").all_inner_texts() == ["pizza"]
    page.locator("button", has_text="Guardar").first.click()
    page.wait_for_selector(".toast.success")
    intent = next(i for i in api(base_url, "/api/agents/pizzeria")["intents"] if i["id"] == pid)
    phrase = next(p for p in intent["trainingPhrases"] if p["text"] == "quiero pizza para el sábado")
    assert phrase["annotations"][0]["entity"] == "@sys.any"
    assert page.errors == []


def test_simulador_y_correccion(base_url, page):
    page.goto(f"{base_url}/#/a/pizzeria/intents")
    page.wait_for_selector(".list-item")  # el agente ya está cargado
    page.fill(".sim-foot input", "reservar un vuelo a roma")
    page.press(".sim-foot input", "Enter")
    page.wait_for_selector(".turn-meta")
    page.locator("button[aria-label='Respuesta incorrecta']").last.click()
    page.locator(".popover .opt", has_text="Fallback").click()
    page.wait_for_selector(".toast.success")
    r = api(base_url, "/api/agents/pizzeria/detect", {"sessionId": "e2e", "text": "reservar un vuelo a roma"})
    assert r["match"] == "fallback"


def test_analizador_corrige(base_url, page):
    page.goto(f"{base_url}/#/a/pizzeria/analyzer?q=quiero%20una%20pizzeta%20de%20jamon")
    page.wait_for_selector(".token-grid")
    page.locator("button", has_text="No, corregir").click()
    pid = next(i["id"] for i in api(base_url, "/api/agents/pizzeria")["intents"] if i["name"] == "pedido.pizza")
    page.select_option("select[aria-label='Intención correcta']", pid)
    page.locator("button", has_text="Guardar como frase de entrenamiento").click()
    page.wait_for_selector(".notice.success")
    intent = next(i for i in api(base_url, "/api/agents/pizzeria")["intents"] if i["id"] == pid)
    assert any(p["text"] == "quiero una pizzeta de jamon" for p in intent["trainingPhrases"])


def test_pagina_entrenar(base_url, page):
    page.goto(f"{base_url}/#/a/pizzeria/learn")
    page.wait_for_selector(".steps .step")
    card = page.locator(".card", has_text="Sigue una frase")
    card.locator("input").fill("quiero reservar mesa para dos")
    card.locator("button", has_text="Explicar").click()
    page.wait_for_selector(".flow .flow-step")
    assert page.locator(".scatter .probe-ring").count() == 1
    page.locator("button", has_text="Hacer el examen").click()
    page.wait_for_selector(".heatmap", state="attached", timeout=60000)
    page.locator("button", has_text="Entrenar paso a paso").click()
    page.wait_for_selector(".step.active", timeout=15000)
    assert page.errors == []


def test_inicio_en_agentes_con_los_dos_ejemplos(base_url, page):
    page.goto(base_url + "/")
    page.wait_for_url("**/#/agents")
    page.wait_for_selector(".agent-card h3")
    nombres = page.locator(".agent-card h3").all_inner_texts()
    assert "Pizzería (ejemplo)" in nombres and "Hotel (ejemplo)" in nombres
    assert page.errors == []


def test_entrenar_con_un_agente_grande(base_url, page):
    page.goto(f"{base_url}/#/a/hotel/learn")
    page.wait_for_selector(".steps .step", timeout=60000)
    learned = page.locator(".card", has_text="Lo que ha aprendido")
    assert learned.locator(".multiple").count() == 12  # primero las que tienen más frases
    learned.locator("input[type=search]").fill("reserva.cancelar")
    assert learned.locator(".multiple").count() == 3
    learned.locator("input[type=search]").fill("")
    learned.locator("button", has_text="Ver las 88 intenciones").click()
    assert learned.locator(".multiple").count() == 88
    assert page.errors == []


def test_crear_agente_y_conversar(base_url, page):
    page.goto(f"{base_url}/#/agents")
    page.locator("button", has_text="Crear agente").first.click()
    page.locator(".modal input").first.fill("Soporte e2e")
    page.locator(".modal button.primary").click()
    page.wait_for_url("**/intents")
    page.locator("button", has_text="Crear intención").click()
    page.fill(".modal input", "averia.internet")
    page.locator(".modal button.primary").click()
    add = page.locator("input[aria-label='Nueva frase de entrenamiento']")
    for t in ["no me funciona internet", "se me ha caído la conexión", "no tengo wifi", "internet va muy lento",
              "el router no funciona"]:
        add.fill(t)
        add.press("Enter")
        page.wait_for_timeout(150)
    page.locator("button", has_text="Mensaje de texto").click()
    page.locator("textarea[aria-label='Variante de respuesta']").last.fill("Reinicia el router, por favor.")
    page.locator("button", has_text="Guardar").first.click()
    page.wait_for_selector(".toast.success")
    page.fill(".sim-foot input", "mi internet no va")
    page.press(".sim-foot input", "Enter")
    page.wait_for_timeout(800)
    assert "router" in page.locator(".sim .msg.bot").last.inner_text()


def test_tema_oscuro(base_url, page):
    page.goto(f"{base_url}/#/a/pizzeria/intents")
    page.wait_for_selector(".list-item")
    page.locator("button[aria-label='Cambiar tema claro u oscuro']").click()
    # el cambio va animado (View Transitions): se aplica en el siguiente fotograma
    page.wait_for_function("document.documentElement.dataset.theme === 'dark'")
    bg = page.evaluate("getComputedStyle(document.body).backgroundColor")
    r, g, b = [int(x) for x in bg[bg.index("(") + 1:bg.index(")")].split(",")[:3]]
    assert max(r, g, b) < 60 and max(r, g, b) - min(r, g, b) <= 4  # gris oscuro neutro
    assert page.evaluate("localStorage.getItem('agente.theme')") == "dark"


def test_menu_de_agentes_y_cabecera_caben(base_url, browser):
    """En pantallas medianas con el simulador abierto nada se sale ni se estruja."""
    ctx = browser.new_context(viewport={"width": 1280, "height": 800}, locale="es-ES")
    page = ctx.new_page()
    page.goto(f"{base_url}/#/a/pizzeria/intents")
    page.wait_for_selector(".list-item")
    # la cabecera baja los botones a otra línea antes que dejar el texto en una columna estrecha
    assert page.locator(".page-head .head-text").bounding_box()["width"] > 400
    page.click(".agent-switch")
    page.wait_for_selector(".popover .opt")
    # todo medido en el mismo fotograma (el menú se abre con una animación de escala)
    sobra = page.evaluate("""() => {
        const pop = document.querySelector('.popover').getBoundingClientRect();
        return Math.max(...[...document.querySelectorAll('.popover .opt')].map((o) => {
            const r = o.getBoundingClientRect();
            return Math.max(pop.left - r.left, r.right - pop.right);
        }));
    }""")
    assert sobra <= 0
    page.locator(".popover .opt", has_text="Ver todos los agentes").click()
    page.wait_for_url("**/#/agents")
    ctx.close()


def test_widget_con_tema_oscuro(base_url, page):
    page.goto(f"{base_url}/#/a/pizzeria/integrations")
    page.wait_for_selector(".widget-preview")
    page.locator(".tabs button", has_text="Oscuro").click()
    assert "dark" in page.locator(".widget-preview").get_attribute("class")
    assert 'data-theme="dark"' in page.locator(".code-block pre").first.inner_text()
    assert "theme=dark" in page.locator("a", has_text="Abrir chat de demostración").get_attribute("href")
    # el widget de verdad también se pinta oscuro
    page.goto(f"{base_url}/chat?agent=pizzeria&theme=dark")
    page.wait_for_selector("[data-agente-widget] .panel")
    bg = page.evaluate("getComputedStyle(document.querySelector('[data-agente-widget]').shadowRoot"
                       ".querySelector('.panel')).backgroundColor")
    assert bg == "rgb(28, 28, 28)"
    assert page.errors == []


def test_aviso_de_servidor_desactualizado(base_url, page):
    """Si el servidor sigue con una versión anterior (no se reinició tras actualizar), se avisa."""
    info = api(base_url, "/api/info")
    page.route("**/api/info", lambda route, request: route.fulfill(json={**info, "version": "0.0.1"}))
    page.goto(f"{base_url}/#/a/pizzeria/intents")
    playwright.expect(page.locator(".version-notice")).to_contain_text("Reinicia el servidor")
    page.locator(".version-notice button[aria-label='Cerrar aviso']").click()
    assert page.locator(".version-notice").count() == 0


def test_paleta_de_comandos(base_url, page):
    page.goto(f"{base_url}/#/a/pizzeria/intents")
    page.wait_for_selector(".list-item")
    page.keyboard.press("Control+k")
    page.wait_for_selector(".cmdk input")
    page.keyboard.type("entidades")
    page.keyboard.press("Enter")
    page.wait_for_url("**/entities")
    page.wait_for_selector(".list-item")
    # con una frase propone analizarla
    page.keyboard.press("Control+k")
    page.keyboard.type("quiero una pizza")
    page.locator(".cmdk-item", has_text="Analizar «quiero una pizza»").click()
    page.wait_for_selector(".token-grid")
    assert "q=quiero" in page.url
    assert page.errors == []


def test_referencia_de_la_api(base_url, page):
    page.goto(f"{base_url}/docs")
    page.wait_for_selector(".ep")
    assert page.locator(".ep").count() >= 30
    # el buscador filtra las operaciones
    page.fill(".docs-search input", "detect")
    visibles = page.locator(".ep:visible")
    assert 1 <= visibles.count() <= 3
    page.fill(".docs-search input", "")
    # «Pruébalo» hace la petición de verdad
    info = page.locator("#get-api-info")
    info.locator(".ep-head").click()
    info.locator(".try .btn.primary").click()
    playwright.expect(info.locator(".resp .status-pill.ok")).to_contain_text("200")
    detect = page.locator("#post-api-agents-agent_id-detect")
    detect.locator(".ep-head").click()
    detect.locator(".try .btn.primary").click()
    playwright.expect(detect.locator(".resp")).to_contain_text("pedido.pizza")
    assert page.errors == []

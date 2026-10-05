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


def _serve(app):
    """Arranca la aplicación en un puerto libre; devuelve su dirección y cómo pararla."""
    port = _free_port()
    server = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=port, log_level="warning"))
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()
    url = f"http://127.0.0.1:{port}"
    for _ in range(100):
        try:
            urllib.request.urlopen(url + "/api/info", timeout=1)
            break
        except OSError:
            time.sleep(0.1)

    def stop():
        server.should_exit = True
        thread.join(timeout=5)
    return url, stop


@pytest.fixture(scope="module")
def base_url(tmp_path_factory):
    url, stop = _serve(create_app(tmp_path_factory.mktemp("datos")))
    yield url
    stop()


@pytest.fixture(scope="module")
def accounts_url(tmp_path_factory):
    """Un servidor con cuentas de usuario (AGENTE_ACCOUNTS), como el público."""
    url, stop = _serve(create_app(tmp_path_factory.mktemp("cuentas"), accounts=True))
    yield url
    stop()


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


def choose(page, label, text):
    """Elige una opción de un desplegable propio de la consola (ui.js:selectMenu) por su texto."""
    page.locator(f".xm-head[aria-label='{label}']").click()
    page.locator(".xm-panel:not(.closing)").get_by_role("option", name=text, exact=True).click()


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
                el.dispatchEvent(new MouseEvent('mousedown', {bubbles: true, button: 0}));
                const s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
                document.dispatchEvent(new MouseEvent('mouseup', {bubbles: true, button: 0}));
                return;
            }
        }
    }""", [locator.element_handle(), word])


@pytest.mark.parametrize("route,selector", [
    ("intents", ".list-item"), ("entities", ".list-item"), ("analyzer?q=hola", ".gloss"),
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
    # que haya cajas y estén llenas (sin la primera condición se cumple antes de pintarse la página)
    page.wait_for_function("document.querySelectorAll('.inside .live-body').length > 0 && "
                           "document.querySelectorAll('.inside .live-body:empty').length === 0", timeout=30000)
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
    page.wait_for_selector(".gloss")
    page.locator("button", has_text="No, corregir").click()
    pid = next(i["id"] for i in api(base_url, "/api/agents/pizzeria")["intents"] if i["name"] == "pedido.pizza")
    choose(page, "Intención correcta", "pedido.pizza")
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


def test_formulas_como_en_tex(base_url, page):
    """Como en TeX: los paréntesis normales no se estiran; los de \\left…\\right sí, y solo hasta lo que
    encierran (van en su propio grupo). Un índice sin base («^{*}») es un superíndice, no «^ *»."""
    page.goto(base_url + "/#/agents")
    page.wait_for_selector(".agent-card")
    r = page.evaluate("""async () => {
        const { tex } = await import('/js/math.js');
        const plain = tex('d(i,j) + [k = y]'), grouped = tex('x \\\\left( \\\\frac{a}{b} \\\\right)^2');
        return {
            plain: [...plain.querySelectorAll('mo')].filter((o) => '()[]'.includes(o.textContent)).map((o) => o.getAttribute('stretchy')),
            grouped: [...grouped.querySelectorAll('mo')].map((o) => o.getAttribute('stretchy')),
            group: grouped.querySelector('mo').parentElement.localName,
            sup: tex('^{*}').firstElementChild.localName,
        };
    }""")
    assert r == {"plain": ["false"] * 4, "grouped": ["true", "true"], "group": "mrow", "sup": "msup"}
    assert page.errors == []


@pytest.mark.parametrize("width", [320, 390])
def test_por_dentro_en_el_movil(base_url, browser, width):
    """En un móvil nada se sale ni se corta: las fórmulas que no caben se encogen (math.js:fitFormulas) y,
    si ni así caben, empiezan por la izquierda y se desplazan; la página no se mueve a lo ancho."""
    ctx = browser.new_context(viewport={"width": width, "height": 844}, locale="es-ES", is_mobile=True, has_touch=True)
    ctx.add_init_script("localStorage.setItem('agente.sim', '0')")
    page = ctx.new_page()
    page.goto(f"{base_url}/#/a/pizzeria/inside")
    page.wait_for_function("document.querySelectorAll('.inside .live-body').length > 0 && "
                           "document.querySelectorAll('.inside .live-body:empty').length === 0", timeout=30000)
    page.wait_for_timeout(500)  # las fórmulas se ajustan en el fotograma siguiente
    res = page.evaluate("""() => {
        const main = document.querySelector('.main'), vw = document.documentElement.clientWidth;
        const fuera = [...document.querySelectorAll('.inside *')].filter((el) => {
            const r = el.getBoundingClientRect();
            return r.width && (r.right > vw + 0.5 || r.left < -0.5) && !el.closest('.formula, .table-scroll');
        }).length;
        const centradasSinCaber = [...document.querySelectorAll('.inside .formula')]
            .filter((b) => b.scrollWidth > b.clientWidth + 1 && !b.classList.contains('scrolls')).length;
        const cortadas = [...document.querySelectorAll('.inside .wf-label, .inside .bar-label, .inside .pl-val')]
            .filter((el) => el.scrollWidth > el.clientWidth + 1).length;
        return {desborde: main.scrollWidth - main.clientWidth, fuera, centradasSinCaber, cortadas};
    }""")
    assert res == {"desborde": 0, "fuera": 0, "centradasSinCaber": 0, "cortadas": 0}
    ctx.close()


def test_inicio_en_agentes_con_los_ejemplos_aparte(base_url, page):
    """Los ejemplos van debajo, en su grupo; arriba solo los agentes propios (o el aviso de que no hay)."""
    page.goto(base_url + "/")
    page.wait_for_url("**/#/agents")
    page.wait_for_selector(".agent-card h3")
    ejemplos = page.locator(".agent-group[data-group='examples'] .agent-card h3").all_inner_texts()
    assert ejemplos == ["Pizzería (ejemplo)", "Hotel (ejemplo)"]  # del más sencillo al más grande
    mios = [a["name"] for a in api(base_url, "/api/agents") if not a["example"]]
    tuyos = page.locator(".agent-group[data-group='mine']")
    assert tuyos.locator(".agent-card h3").all_inner_texts() == mios
    assert tuyos.locator(".empty").count() == (0 if mios else 1)
    # el menú de agentes también los separa
    page.click(".agent-switch")
    page.wait_for_selector(".popover .opt")
    assert page.locator(".popover .group").all_inner_texts()[-1].lower() == "ejemplos"
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


def test_crear_agente_como_copia(base_url, page):
    """«Copia de un agente»: se elige cualquiera de los que hay (tuyos o de ejemplo) con su buscador."""
    page.goto(f"{base_url}/#/agents")
    page.locator("button", has_text="Crear agente").first.click()
    page.locator(".tpl-card", has_text="Copia de un agente").click()
    assert page.locator(".modal .xmenu").is_hidden()  # el idioma es el del agente que se copia
    page.locator(".source-pick").click()
    page.locator(".popover input").fill("hotel")
    page.keyboard.press("Escape")  # cierra la lista, no la ventana
    assert page.locator(".modal").count() == 1 and page.locator(".popover").count() == 0
    page.locator(".source-pick").click()
    page.locator(".popover .opt", has_text="Hotel").click()
    page.locator(".modal input").first.fill("Hotel copiado e2e")
    page.locator(".modal button.primary").click()
    page.wait_for_url("**/intents")
    page.wait_for_selector(".list-item")
    copy, hotel = api(base_url, "/api/agents/hotel-copiado-e2e"), api(base_url, "/api/agents/hotel")
    assert copy["name"] == "Hotel copiado e2e" and "example" not in copy
    assert len(copy["intents"]) == len(hotel["intents"]) > 80
    assert page.errors == []


def test_notas_de_la_version(base_url, browser):
    """El número de versión abre las novedades; un punto avisa de que hay una versión nueva sin ver."""
    ctx = browser.new_context(viewport={"width": 1440, "height": 900}, locale="es-ES")
    ctx.add_init_script("localStorage.getItem('agente.seenVersion') || localStorage.setItem('agente.seenVersion', '0.1.0')")
    page = ctx.new_page()
    page.goto(f"{base_url}/#/agents")
    page.wait_for_selector(".sidebar .version.new")
    page.locator(".sidebar .version").click()
    page.wait_for_selector(".note-rel")
    first = page.locator(".note-rel").first
    assert first.locator(".note-ver").inner_text() == api(base_url, "/api/info")["version"]
    assert "Tu versión" in first.inner_text() and page.locator(".note-rel").count() >= 9
    page.keyboard.press("Escape")
    page.reload()
    page.wait_for_selector(".sidebar .version")
    assert page.locator(".sidebar .version.new").count() == 0  # ya vistas
    ctx.close()


def test_indice_desplegable_con_poco_sitio(base_url, browser):
    """Con la zona central estrecha, el índice de la Guía es una barra que dice en qué sección estás y
    despliega la lista; al saltar, la sección queda debajo de la barra, no tapada por ella."""
    ctx = browser.new_context(viewport={"width": 390, "height": 844}, locale="es-ES", is_mobile=True, has_touch=True)
    ctx.add_init_script("localStorage.setItem('agente.sim', '0')")
    page = ctx.new_page()
    page.goto(f"{base_url}/#/guide")
    page.wait_for_selector(".md h2")
    assert page.locator(".toc-toggle").is_visible() and page.locator(".toc-list").is_hidden()
    page.locator(".toc-toggle").click()
    page.locator(".toc-list a", has_text="Problemas frecuentes").click()
    assert page.locator(".toc-list").is_hidden()
    playwright.expect(page.locator(".toc-now")).to_have_text("Problemas frecuentes", timeout=5000)
    page.wait_for_timeout(1500)  # se corrige si las imágenes de arriba cambian de alto al cargarse
    tops = page.evaluate("""() => {
        const h2 = [...document.querySelectorAll('.md h2')].find((x) => x.textContent === 'Problemas frecuentes');
        return [document.querySelector('.toc').getBoundingClientRect().bottom, h2.getBoundingClientRect().top];
    }""")
    assert tops[0] <= tops[1] <= tops[0] + 30
    page.set_viewport_size({"width": 1440, "height": 900})  # con sitio, la lista va fija al lado
    page.wait_for_timeout(300)
    assert page.locator(".toc-toggle").is_hidden() and page.locator(".toc-list").is_visible()
    ctx.close()


def test_desplegables_y_color_propios(base_url, page):
    """Ni <select> ni el selector de color del navegador: desplegables (selectMenu) y colorPicker propios,
    que también se manejan con el teclado."""
    for route in ["agents", "a/pizzeria/settings", "a/pizzeria/integrations", "a/pizzeria/learn"]:
        page.goto(f"{base_url}/#/{route}")
        page.wait_for_selector(".page-head")
        page.wait_for_timeout(400)
        assert page.locator("select, input[type=color]").count() == 0, route
    page.goto(f"{base_url}/#/a/pizzeria/integrations")
    page.wait_for_selector(".widget-preview")
    page.locator(".cp-btn").click()
    preview_has = "(c) => document.querySelector('.widget-preview').getAttribute('style').includes(c)"
    page.locator(".cp-dot[data-c='#16a34a']").click()
    page.wait_for_function(preview_has, arg="#16a34a")  # el cambio se avisa una vez por fotograma
    assert page.locator(".cp-btn .cp-code").inner_text() == "#16A34A"
    page.locator(".cp-hex").fill("#e11d48")
    page.wait_for_function(preview_has, arg="#e11d48")
    page.keyboard.press("Escape")
    choose(page, "Posición", "Abajo a la izquierda")
    assert "left" in page.locator(".widget-preview").get_attribute("class")
    head = page.locator(".xm-head[aria-label='Posición']")
    head.focus()
    page.keyboard.press("Enter")
    page.keyboard.press("ArrowUp")
    page.keyboard.press("Enter")
    assert "left" not in page.locator(".widget-preview").get_attribute("class")
    assert head.inner_text() == "Abajo a la derecha"
    page.wait_for_selector(".xm-panel", state="detached")  # se va tras su animación de cierre
    assert page.errors == []


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
    page.wait_for_selector(".gloss")
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


def _sign(page, url, user, password="clave-larga", new=True):
    """Entra (o crea la cuenta) en la ventana obligatoria de un servidor con cuentas."""
    page.goto(url)
    page.wait_for_selector(".modal")
    if new:
        page.locator(".modal .tabs button", has_text="Crear cuenta").click()
    inputs = page.locator(".modal input")
    inputs.nth(0).fill(user)
    inputs.nth(1).fill(password)
    if new:
        inputs.nth(2).fill(password)
    page.locator(".modal .modal-foot .btn.primary").click()
    page.wait_for_selector(".modal", state="detached")


def test_cuentas_compartir_y_guardar_una_copia(accounts_url, browser):
    """Con cuentas: cada uno ve solo lo suyo, y un enlace compartido le da a otro su propia copia."""
    ana_ctx = browser.new_context(viewport={"width": 1440, "height": 900}, locale="es-ES")
    ana = ana_ctx.new_page()
    errors = []
    ana.on("pageerror", lambda e: errors.append(str(e)))
    _sign(ana, accounts_url + "/", "ana-e2e")
    ana.wait_for_selector(".agent-group[data-group='mine'] .empty")  # empieza sin agentes propios
    assert ana.locator(".user-btn").inner_text().strip().endswith("ana-e2e")
    ana.locator("button", has_text="Crear agente").first.click()
    ana.locator(".modal input").first.fill("Pastelería e2e")
    ana.locator(".modal button.primary").click()
    ana.wait_for_url("**/intents")
    ana.goto(ana.url.replace("/intents", "/settings"))
    ana.locator("button", has_text="Crear un enlace para compartirlo").click()
    link = ana.locator(".share-link").input_value()
    assert "/#/shared/" in link

    beto_ctx = browser.new_context(viewport={"width": 1440, "height": 900}, locale="es-ES")
    beto = beto_ctx.new_page()
    beto.on("pageerror", lambda e: errors.append(str(e)))
    _sign(beto, link, "beto-e2e")  # abre el enlace: primero entra y luego ve el agente
    beto.wait_for_selector(".shared-card")
    assert "Pastelería e2e" in beto.locator(".shared-card").inner_text()
    beto.locator("button", has_text="Guardar en mis agentes").click()
    beto.wait_for_url("**/intents")
    beto.goto(accounts_url + "/#/agents")
    beto.wait_for_selector(".agent-group[data-group='mine'] .agent-card h3")
    assert beto.locator(".agent-group[data-group='mine'] .agent-card h3").all_inner_texts() == ["Pastelería e2e"]

    # salir y volver a entrar: siguen sus agentes
    ana.goto(accounts_url + "/#/agents")
    ana.locator(".user-btn").click()
    ana.locator(".popover .opt", has_text="Salir").click()
    ana.wait_for_selector(".modal")
    _sign(ana, accounts_url + "/", "ana-e2e", new=False)
    ana.wait_for_selector(".agent-group[data-group='mine'] .agent-card h3")
    assert ana.locator(".agent-group[data-group='mine'] .agent-card h3").all_inner_texts() == ["Pastelería e2e"]
    assert errors == []
    ana_ctx.close()
    beto_ctx.close()


def test_entrar_sin_cuenta_y_crearla_despues(accounts_url, browser):
    """Sin cuenta: se entra con el aviso de que los agentes solo se ven en este navegador; después se
    puede crear la cuenta y se queda con lo que había."""
    ctx = browser.new_context(viewport={"width": 1440, "height": 900}, locale="es-ES")
    page = ctx.new_page()
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto(accounts_url + "/")
    page.wait_for_selector(".modal .guest-note")
    assert "solo se verán en este navegador" in page.locator(".modal .guest-note").inner_text()
    page.locator(".modal .modal-foot .btn", has_text="Entrar sin cuenta").click()
    page.wait_for_selector(".modal", state="detached")
    page.wait_for_selector(".agent-group[data-group='mine'] .empty")
    assert page.locator(".user-btn").inner_text().strip() == "Sin cuenta"
    page.locator("button", has_text="Crear agente").first.click()
    page.locator(".modal input").first.fill("Panadería e2e")
    page.locator(".modal button.primary").click()
    page.wait_for_url("**/intents")
    page.goto(accounts_url + "/#/agents")  # sigue dentro: la llave está en este navegador
    page.locator(".agent-card", has_text="Panadería e2e").wait_for()
    page.locator(".user-btn").click()
    assert "solo se verán en este navegador" in page.locator(".popover").inner_text()
    page.locator(".popover .opt", has_text="Crear una cuenta").click()
    inputs = page.locator(".modal input")
    inputs.nth(0).fill("carla-e2e")
    inputs.nth(1).fill("clave-larga")
    inputs.nth(2).fill("clave-larga")
    page.locator(".modal .modal-foot .btn.primary").click()
    page.wait_for_selector(".user-btn:has-text('carla-e2e')")  # la consola se recarga ya con la cuenta
    page.locator(".agent-card", has_text="Panadería e2e").wait_for()
    assert errors == []
    ctx.close()


def test_anotar_con_doble_clic_y_soltando_fuera(base_url, page):
    """Anotar una entidad con el ratón: con doble clic en la palabra (antes ponía la frase en modo
    editar y la marca no se veía hasta guardar) y arrastrando hasta soltar fuera de la frase (antes no
    salía el menú)."""
    iid = next(i["id"] for i in api(base_url, "/api/agents/pizzeria")["intents"] if i["name"] == "pedido.pizza")
    page.goto(f"{base_url}/#/a/pizzeria/intents/{iid}")
    page.wait_for_selector(".phrase-row .phrase")
    word_box = """([phrase, word]) => {
        const el = [...document.querySelectorAll('.phrase-row .phrase')].find((r) => r.textContent === phrase);
        const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
        let n;
        while ((n = walker.nextNode())) {
            const i = n.nodeValue.indexOf(word);
            if (i >= 0) {
                const r = document.createRange(); r.setStart(n, i); r.setEnd(n, i + word.length);
                const b = r.getBoundingClientRect();
                return { x1: b.left + 1, x2: b.right - 1, y: b.top + b.height / 2, right: el.getBoundingClientRect().right };
            }
        }
    }"""
    marks = lambda phrase: page.evaluate("""(phrase) => [...[...document.querySelectorAll('.phrase-row .phrase')]
        .find((r) => r.textContent === phrase).querySelectorAll('.ann')].map((s) => s.textContent)""", phrase)

    b = page.evaluate(word_box, ["quiero hacer un pedido", "pedido"])
    page.mouse.dblclick((b["x1"] + b["x2"]) / 2, b["y"])
    page.locator(".popover input").fill("@pizza")
    page.keyboard.press("Enter")
    assert page.locator(".phrase-edit").count() == 0  # no entra en modo editar el texto
    assert marks("quiero hacer un pedido") == ["pedido"]

    b = page.evaluate(word_box, ["quiero pedir una pizza", "pizza"])
    page.mouse.move(b["x1"], b["y"])
    page.mouse.down()
    page.mouse.move(b["right"] + 80, b["y"] + 30, steps=8)  # se pasa del final de la frase
    page.mouse.up()
    page.locator(".popover input").fill("@pizza")
    page.keyboard.press("Enter")
    assert marks("quiero pedir una pizza") == ["pizza"]
    assert page.locator(".dirty-pill").is_visible()
    assert page.errors == []

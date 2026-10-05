"""Pruebas de la API REST."""

import base64
import hashlib
import io
import json
import re
import time
import zipfile

import pytest
from fastapi.testclient import TestClient

from app.server import create_app


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.delenv("AGENTE_ADMIN_TOKEN", raising=False)
    return TestClient(create_app(tmp_path))


def test_arranca_con_agentes_de_ejemplo(client):
    agents = client.get("/api/agents").json()
    assert sorted(a["id"] for a in agents) == ["hotel", "pizzeria"]
    assert all(a["example"] for a in agents)  # la consola los enseña aparte, debajo de los propios
    assert client.get("/").status_code == 200
    assert client.get("/widget.js").status_code == 200
    assert client.get("/chat").status_code == 200


def test_ejemplos_se_copian_una_vez(tmp_path, monkeypatch):
    monkeypatch.delenv("AGENTE_ADMIN_TOKEN", raising=False)
    c = TestClient(create_app(tmp_path))
    assert c.delete("/api/agents/hotel").status_code in (200, 204)
    c = TestClient(create_app(tmp_path))  # reiniciar no devuelve el ejemplo borrado
    assert [a["id"] for a in c.get("/api/agents").json()] == ["pizzeria"]


def test_instalacion_anterior_recibe_solo_el_hotel(tmp_path, monkeypatch):
    """Antes solo se copiaba la pizzería (sin marca); si se borró, no vuelve, pero llega el hotel."""
    monkeypatch.delenv("AGENTE_ADMIN_TOKEN", raising=False)
    (tmp_path / "agents").mkdir()
    (tmp_path / "agents" / "mio.json").write_text(json.dumps({"id": "mio", "name": "Mío", "intents": []}),
                                                   encoding="utf-8")
    c = TestClient(create_app(tmp_path))
    assert sorted(a["id"] for a in c.get("/api/agents").json()) == ["hotel", "mio"]


def test_ejemplos_de_antes_de_la_marca(tmp_path, monkeypatch):
    """Las copias hechas antes de existir la marca `example` la reciben al arrancar; un agente propio
    con el mismo id (el ejemplo se borró y se creó otro con ese nombre) sigue siendo propio."""
    monkeypatch.delenv("AGENTE_ADMIN_TOKEN", raising=False)
    (tmp_path / "agents").mkdir()
    (tmp_path / "seeded_examples.json").write_text('["hotel", "pizzeria"]', encoding="utf-8")
    # el hotel se copió con otro id porque «hotel» ya era de un agente propio
    for agent_id, name in [("pizzeria", "Pizzería (ejemplo)"), ("hotel", "Hotel"), ("hotel-ejemplo", "Hotel (ejemplo)")]:
        (tmp_path / "agents" / f"{agent_id}.json").write_text(
            json.dumps({"id": agent_id, "name": name, "intents": []}), encoding="utf-8")
    c = TestClient(create_app(tmp_path))
    assert {a["id"]: a["example"] for a in c.get("/api/agents").json()} == {
        "pizzeria": True, "hotel": False, "hotel-ejemplo": True}


def test_crear_agente_desde_ejemplo(client):
    res = client.post("/api/agents", json={"name": "Mi hotel", "template": "hotel"})
    assert res.status_code == 201
    agent = res.json()
    assert agent["id"] == "mi-hotel" and agent["name"] == "Mi hotel" and len(agent["intents"]) > 80
    assert "example" not in agent  # la copia es un agente propio


def test_crear_agente_como_copia_de_otro(client):
    """«Copia de un agente» en la consola: de uno propio o de uno de ejemplo, con todo lo que tenga."""
    client.patch("/api/agents/pizzeria", json={"description": "La mía, cambiada"})
    res = client.post("/api/agents", json={"name": "Mi pizzería", "copyOf": "pizzeria", "language": "en"})
    assert res.status_code == 201
    copy = res.json()
    original = client.get("/api/agents/pizzeria").json()
    assert copy["id"] == "mi-pizzeria" and copy["name"] == "Mi pizzería" and "example" not in copy
    assert copy["language"] == original["language"] == "es"  # el idioma es el del agente copiado
    assert copy["description"] == "La mía, cambiada"  # sin descripción nueva se queda la suya
    assert len(copy["intents"]) == len(original["intents"]) and len(copy["entities"]) == len(original["entities"])
    # de una copia propia, y con descripción nueva
    again = client.post("/api/agents", json={"name": "Otra", "copyOf": copy["id"], "description": "Nueva"}).json()
    assert again["description"] == "Nueva" and len(again["intents"]) == len(copy["intents"])
    assert client.post("/api/agents", json={"name": "X", "copyOf": "no-existe"}).status_code == 404
    # los ejemplos tal como vienen, para copiarlos aunque se haya borrado el suyo
    examples = {e["id"]: e for e in client.get("/api/info").json()["examples"]}
    listed = {a["id"]: a for a in client.get("/api/agents").json()}
    assert set(examples) == {"pizzeria", "hotel"}
    assert examples["hotel"]["name"] == listed["hotel"]["name"] and examples["hotel"]["intents"] == listed["hotel"]["intents"]
    client.delete("/api/agents/hotel")
    restored = client.post("/api/agents", json={"name": "Hotel", "template": "hotel"}).json()
    assert len(restored["intents"]) == examples["hotel"]["intents"]


def test_copias_de_un_ejemplo_son_propias(client):
    assert client.patch("/api/agents/pizzeria", json={"description": "Cambiada"}).json()["example"] is True
    copy = client.post("/api/agents/pizzeria/duplicate").json()
    assert "example" not in copy
    exported = client.get("/api/agents/pizzeria/export")
    assert "example" not in exported.json()
    data = json.dumps(dict(exported.json(), example=True)).encode()  # aunque el fichero diga que lo es
    imported = client.post("/api/agents/import?filename=x.json&name=Importado", content=data).json()
    assert "example" not in imported
    mine = {a["id"] for a in client.get("/api/agents").json() if not a["example"]}
    assert mine == {copy["id"], imported["id"]}


def test_consola_api_y_recursos(client):
    page = client.get("/").text
    title = re.search(r"<title>(.+)</title>", page).group(1)
    assert title.startswith("Lince · ") and 30 <= len(title) <= 60  # lo que sale en los buscadores
    for path in ("/docs", "/docs/"):
        r = client.get(path)
        assert r.status_code == 200 and "apidocs.js" in r.text
    assert client.get("/favicon.svg").headers["content-type"].startswith("image/svg+xml")
    assert client.get("/favicon.ico").status_code == 200
    manifest = client.get("/manifest.webmanifest")
    assert manifest.headers["content-type"].startswith("application/manifest+json")
    assert manifest.json()["short_name"] == "Lince"
    assert client.get("/fonts/inter-latin.woff2").headers["content-type"] == "font/woff2"


def test_version_de_la_consola_coincide():
    """La consola compara su versión con la del servidor para avisar si hay que reiniciarlo."""
    import re
    from pathlib import Path

    from app import __version__

    js = (Path(__file__).resolve().parent.parent / "web" / "js" / "app.js").read_text(encoding="utf-8")
    assert re.search(r'APP_VERSION = "([^"]+)"', js).group(1) == __version__


def test_novedades_de_la_version_actual(client):
    """Al subir la versión hay que contar qué trae en docs/NOVEDADES.md (la consola lo enseña al
    pulsar el número de versión)."""
    from app import __version__

    res = client.get("/guia/NOVEDADES.md")
    assert res.status_code == 200
    assert f"\n## {__version__} · " in res.text
    # el navegador tiene que preguntar antes de reutilizar su copia: si no, tras actualizar el
    # servidor seguía enseñando las notas (y el JS y el CSS) de antes
    for path in ("/guia/NOVEDADES.md", "/js/app.js", "/css/app.css", "/"):
        assert client.get(path).headers["cache-control"] == "no-cache", path


def test_vigia_solo_si_esta_configurado(tmp_path, monkeypatch):
    """El script de Vigía (vigilancia de la web pública) solo va en las páginas si el servidor tiene
    AGENTE_VIGIA_CLAVE: una instalación local no manda nada a nadie."""
    monkeypatch.delenv("AGENTE_ADMIN_TOKEN", raising=False)
    monkeypatch.delenv("AGENTE_VIGIA_CLAVE", raising=False)
    local = TestClient(create_app(tmp_path / "local"))
    for path in ("/", "/docs", "/chat"):
        assert "data-clave" not in local.get(path).text, path
    monkeypatch.setenv("AGENTE_VIGIA_CLAVE", "abc123")
    publica = TestClient(create_app(tmp_path / "publica"))
    for path in ("/", "/index.html", "/docs", "/chat"):
        res = publica.get(path)
        assert res.status_code == 200 and res.headers["content-type"].startswith("text/html"), path
        assert 'vigia.js" data-clave="abc123" defer></script>\n</body>' in res.text, path
    assert "<title>" in publica.get("/").text  # la página sigue entera
    # la CSP deja cargar el script de Vigía y mandar sus datos a su web
    csp = publica.get("/").headers["content-security-policy"]
    assert "script-src 'self'" in csp and csp.count("https://nexopablooms.duckdns.org") == 2


def test_cabeceras_de_seguridad(client):
    """Cabeceras del informe de seguridad: sin adivinar tipos, sin mandar la dirección completa a otras
    webs, sin cámara ni micrófono, ventana aislada, sin iframes ajenos (salvo el chat, que se incrusta) y
    HSTS solo cuando se llega por https (detrás de Traefik lo dice X-Forwarded-Proto)."""
    for path in ("/", "/docs", "/chat", "/api/info", "/js/app.js", "/offline.html"):
        h = client.get(path).headers
        assert h["x-content-type-options"] == "nosniff", path
        assert h["referrer-policy"] == "strict-origin-when-cross-origin", path
        assert "camera=()" in h["permissions-policy"] and h["cross-origin-opener-policy"] == "same-origin", path
        assert "strict-transport-security" not in h, path  # en local, por http
    assert client.get("/", headers={"x-forwarded-proto": "https"}).headers["strict-transport-security"].startswith("max-age=31536000")
    console = client.get("/").headers
    assert console["x-frame-options"] == "DENY" and "frame-ancestors 'none'" in console["content-security-policy"]
    chat = client.get("/chat").headers
    assert "x-frame-options" not in chat and "frame-ancestors *" in chat["content-security-policy"]
    # lo que otras webs cargan (el widget) se puede usar desde fuera; el resto, solo desde aquí
    assert client.get("/widget.js").headers["cross-origin-resource-policy"] == "cross-origin"
    assert client.get("/api/info").headers["cross-origin-resource-policy"] == "same-origin"


def test_csp_permite_solo_los_scripts_de_la_pagina(client):
    """Ni 'unsafe-inline' ni 'unsafe-eval' en los scripts: los <script> en línea van por su huella."""
    for path in ("/", "/docs", "/chat"):
        res = client.get(path)
        csp = res.headers["content-security-policy"]
        script_src = next(d for d in csp.split("; ") if d.startswith("script-src "))
        assert "unsafe" not in script_src and "object-src 'none'" in csp and "base-uri 'self'" in csp, path
        inline = re.findall(r"<script>(.*?)</script>", res.text, re.S)
        assert inline, path
        for code in inline:
            digest = base64.b64encode(hashlib.sha256(code.encode("utf-8")).digest()).decode()
            assert f"'sha256-{digest}'" in script_src, path


def test_cors_solo_en_las_rutas_publicas(client):
    """Otras webs pueden hablar con un agente (el widget, tu aplicación), pero no leer la API de la consola."""
    origin = {"Origin": "https://otra-web.example"}
    preflight = dict(origin, **{"Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "content-type"})
    for path in ("/api/agents/pizzeria/detect", "/api/agents/x.pizzeria/sessions/s1/reset",
                 "/v2/projects/pizzeria/agent/sessions/s1:detectIntent"):
        res = client.options(path, headers=preflight)
        assert res.status_code == 200 and res.headers["access-control-allow-origin"] == "*", path
    assert client.get("/api/agents/pizzeria/public", headers=origin).headers["access-control-allow-origin"] == "*"
    for path in ("/api/agents", "/api/info", "/api/agents/pizzeria"):
        assert "access-control-allow-origin" not in client.get(path, headers=origin).headers, path
    assert "access-control-allow-origin" not in client.options("/api/agents", headers=preflight).headers


def test_js_css_y_fuente_con_huella(client):
    """Las páginas piden el JS, el CSS y la fuente con una huella en la dirección: se guardan un año y,
    al cambiar un fichero, la huella cambia (el navegador los vuelve a pedir)."""
    page = client.get("/").text
    stamp = re.search(r'src="/v/([0-9a-f]{10})/js/app.js"', page).group(1)
    assert f'href="/v/{stamp}/css/app.css"' in page and f'href="/v/{stamp}/fonts/inter-latin.woff2"' in page
    for path, kind in (("js/app.js", "text/javascript"), ("js/pages/inside.js", "text/javascript"),
                       ("css/app.css", "text/css"), ("fonts/inter-latin.woff2", "font/woff2")):
        res = client.get(f"/v/{stamp}/{path}")
        assert res.status_code == 200 and res.headers["content-type"].startswith(kind), path
        assert res.headers["cache-control"] == "public, max-age=31536000, immutable", path
    assert f'href="/v/{stamp}/css/api.css"' in client.get("/docs").text
    # solo esas carpetas, y sin salirse de ellas
    for path in ("index.html", "js/../favicon.svg", "js/../../app/server.py", "js/no-existe.js"):
        assert client.get(f"/v/{stamp}/{path}").status_code == 404, path
    assert client.get("/icons/icon-192.png").headers["cache-control"] == "public, max-age=2592000"


def test_vistas_previas_robots_y_sitemap(client):
    """Lo que leen los buscadores y lo que enseñan WhatsApp, Telegram o X al pegar el enlace."""
    page = client.get("/", headers={"host": "lince.example", "x-forwarded-proto": "https"}).text
    assert '<link rel="canonical" href="https://lince.example/">' in page
    assert '<meta property="og:url" content="https://lince.example/">' in page
    assert '<meta property="og:image" content="https://lince.example/og.png">' in page
    for tag in ('property="og:title"', 'property="og:description"', 'name="twitter:card"', '"@type": "WebApplication"'):
        assert tag in page, tag
    og = client.get("/og.png")
    assert og.status_code == 200 and og.content[:8] == b"\x89PNG\r\n\x1a\n"
    assert struct_size(og.content) == (1200, 630)
    assert '<link rel="canonical" href="http://testserver/docs">' in client.get("/docs").text
    robots = client.get("/robots.txt").text
    assert "Disallow: /api/" in robots and "Sitemap: http://testserver/sitemap.xml" in robots
    sitemap = client.get("/sitemap.xml")
    assert sitemap.headers["content-type"].startswith("application/xml")
    assert re.findall(r"<loc>(.+?)</loc>", sitemap.text) == ["http://testserver/", "http://testserver/docs"]


def struct_size(png: bytes) -> tuple[int, int]:
    """Ancho y alto de una imagen PNG (cabecera IHDR)."""
    import struct
    return struct.unpack(">II", png[16:24])


def test_portada_solo_en_la_web_publica(tmp_path, monkeypatch):
    """Con cuentas, la página trae ya en el HTML qué es Lince y el formulario de entrar (se pinta sin esperar
    al JS y la leen los buscadores); en una instalación local se abre directamente la consola."""
    monkeypatch.delenv("AGENTE_ADMIN_TOKEN", raising=False)
    local = TestClient(create_app(tmp_path / "local")).get("/").text
    assert "<main" not in local and "<h1" not in local and 'id="landing"' not in local
    publica = TestClient(create_app(tmp_path / "publica", accounts=True)).get("/").text
    assert publica.count("<h1") == 1 and publica.count("<main") == 1
    assert 'name="username"' in publica and 'name="password"' in publica
    links = re.findall(r'<a [^>]*href="(/[^"]*)"', publica)
    assert {"/docs", "/chat?agent=pizzeria", "/chat?agent=hotel"} <= set(links)


def test_service_worker_y_pagina_sin_conexion(client):
    """El service worker (instalable y una página clara si no hay conexión) y lo que guarda para entonces."""
    sw = client.get("/sw.js")
    assert sw.status_code == 200 and sw.headers["content-type"].startswith(("text/javascript", "application/javascript"))
    for path in re.findall(r'"(/[^"]+)"', sw.text.split("addAll(")[1].split(")")[0]):
        assert client.get(path).status_code == 200, path
    assert "iniciar.bat" in client.get("/offline.html").text
    manifest = client.get("/manifest.webmanifest").json()
    assert manifest["display"] == "standalone" and manifest["start_url"] == "/" and manifest["id"] == "/"
    assert {i["sizes"] for i in manifest["icons"]} >= {"192x192", "512x512"}


def test_logotipo_igual_en_la_consola():
    """El lince de web/favicon.svg y el de ui.js:logo() son el mismo dibujo."""
    import re
    from pathlib import Path

    web = Path(__file__).resolve().parent.parent / "web"
    svg = (web / "favicon.svg").read_text(encoding="utf-8")
    js = (web / "js" / "ui.js").read_text(encoding="utf-8")
    logo = re.search(r"const LOGO = (.*?);\n", js, re.S).group(1)
    logo = re.sub(r"'\s*\+\s*'", "", logo)  # une los trozos del texto

    def shapes(markup):
        marca = markup.split('class="marca">')[-1]
        return re.findall(r'<(path|circle)\s([^>]*?)/>', re.sub(r"\s+", " ", marca))

    assert shapes(svg) and shapes(svg) == shapes(logo)


def test_info_avisa_si_hay_que_reiniciar(client, monkeypatch):
    import app.server

    assert client.get("/api/info").json()["restartNeeded"] is False
    # el código cambia en disco con el servidor en marcha (p. ej. tras un git pull)
    stamp = app.server.code_stamp()
    monkeypatch.setattr(app.server, "code_stamp", lambda: stamp + 60)
    assert client.get("/api/info").json()["restartNeeded"] is True


def test_arranque_detecta_otro_servidor():
    """python -m app avisa si el puerto ya lo usa un Lince anterior u otro programa."""
    import threading
    from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

    from app.__main__ import running_lince

    class Handler(BaseHTTPRequestHandler):
        body = b""

        def do_GET(self):  # noqa: N802 - nombre impuesto por http.server
            self.send_response(200)
            self.end_headers()
            self.wfile.write(self.body)

        def log_message(self, *args):
            pass

    for body, expected in [(b'{"version": "0.3.0"}', {"version": "0.3.0"}), (b"<html>otra cosa</html>", {})]:
        Handler.body = body
        srv = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        threading.Thread(target=srv.serve_forever, daemon=True).start()
        url = f"http://127.0.0.1:{srv.server_address[1]}"
        try:
            assert running_lince(url) == expected
        finally:
            srv.shutdown()
            srv.server_close()
    assert running_lince(url) is None  # ya no escucha nadie


def test_esquema_openapi(client):
    spec = client.get("/openapi.json").json()
    assert spec["info"]["title"] == "Lince"
    ops = [op for item in spec["paths"].values() for op in item.values()]
    assert ops and all(op.get("summary") for op in ops)  # todas con resumen en español
    assert spec["paths"]["/api/agents/{agent_id}/detect"]["post"]["security"] == [{"claveApi": []}]
    assert spec["paths"]["/api/agents"]["get"]["security"] == [{"tokenAdmin": []}]
    assert "security" not in spec["paths"]["/api/info"]["get"]
    assert {"tokenAdmin", "claveApi"} <= set(spec["components"]["securitySchemes"])
    assert [t["name"] for t in spec["tags"]][0] == "conversación"


def test_estadisticas_por_dia(client):
    turns = [client.post("/api/agents/pizzeria/detect", json={"sessionId": "a", "text": t}).json()
             for t in ("hola", "zxqw blorp fnord")]
    fallbacks = sum(1 for r in turns if r["match"] == "fallback" or (r["intent"] or {}).get("isFallback"))
    s = client.get("/api/agents/pizzeria/stats?tz=-120").json()  # UTC+2
    assert s["messages"] == 2 and fallbacks == 1
    assert s["daily"] == [{"day": int((time.time() + 7200) // 86400), "messages": 2, "fallbacks": 1}]


def test_crear_agente_intencion_y_conversar(client):
    agent = client.post("/api/agents", json={"name": "Mi Tienda", "language": "es"}).json()
    assert agent["id"] == "mi-tienda"
    it = client.post(f"/api/agents/{agent['id']}/intents", json={
        "name": "envios",
        "trainingPhrases": ["cuánto tarda el envío", "cuándo llega mi paquete", "plazos de entrega",
                            "hacéis envíos a canarias", "cuánto cuesta enviar"],
        "responses": [{"type": "text", "variants": ["Enviamos en 24-48 h."]}],
    }).json()
    assert len(it["trainingPhrases"]) == 5
    r = client.post(f"/api/agents/{agent['id']}/detect", json={"sessionId": "a", "text": "cuanto tarda en llegar el envio"}).json()
    assert r["intent"]["name"] == "envios" and r["fulfillmentText"] == "Enviamos en 24-48 h."


def test_anotar_y_analizar(client):
    res = client.post("/api/agents/pizzeria/annotate", json={"text": "una hawaiana grande"}).json()
    assert {a["entity"] for a in res["annotations"]} == {"@pizza", "@tamano"}
    a = client.post("/api/agents/pizzeria/analyze", json={"text": "reserva para 3 el lunes a las 8"}).json()
    assert a["accepted"] and a["ranking"][0]["name"] == "reserva.mesa"
    assert a["parameters"]["personas"] == 3
    assert a["tokens"][0]["text"] == "reserva"


def test_revision_aprende(client):
    r = client.post("/api/agents/pizzeria/detect", json={"sessionId": "x", "text": "reservar un vuelo a roma"}).json()
    agent = client.get("/api/agents/pizzeria").json()
    fallback = next(i for i in agent["intents"] if i["isFallback"])
    res = client.post(f"/api/agents/pizzeria/logs/{r['logId']}/review",
                      json={"action": "assign", "intentId": fallback["id"]}).json()
    assert res["review"] == "corrected"
    r2 = client.post("/api/agents/pizzeria/detect", json={"sessionId": "y", "text": "reservar un vuelo a roma"}).json()
    assert r2["match"] == "fallback"
    assert client.get("/api/agents/pizzeria/logs").json()["total"] == 1  # solo queda el segundo


def test_sinonimo_y_renombrar_entidad(client):
    agent = client.get("/api/agents/pizzeria").json()
    ent = next(e for e in agent["entities"] if e["name"] == "pizza")
    res = client.post(f"/api/agents/pizzeria/entities/{ent['id']}/synonyms",
                      json={"value": "barbacoa", "synonym": "barbiquiu"}).json()
    assert "barbiquiu" in next(e for e in res["entries"] if e["value"] == "barbacoa")["synonyms"]
    renamed = client.put(f"/api/agents/pizzeria/entities/{ent['id']}", json={**res, "name": "pizzas"}).json()
    assert renamed["name"] == "pizzas"
    agent = client.get("/api/agents/pizzeria").json()
    refs = {p["entity"] for i in agent["intents"] for p in i["parameters"]}
    assert "@pizzas" in refs and "@pizza" not in refs


def test_endpoint_compatible_dialogflow(client):
    r = client.post("/v2/projects/pizzeria/agent/sessions/abc:detectIntent",
                    json={"queryInput": {"text": {"text": "quiero una margarita mediana", "languageCode": "es"}}})
    assert r.status_code == 200
    q = r.json()["queryResult"]
    assert q["intent"]["displayName"] == "pedido.pizza"
    assert q["parameters"]["pizza"] == "margarita"
    assert q["outputContexts"][0]["name"].startswith("projects/pizzeria/agent/sessions/abc/contexts/")


def test_clave_de_api(client):
    client.patch("/api/agents/pizzeria", json={"settings": {"apiKey": "secreta"}})
    assert client.post("/api/agents/pizzeria/detect", json={"text": "hola"}).status_code == 401
    ok = client.post("/api/agents/pizzeria/detect", json={"text": "hola"}, headers={"X-Api-Key": "secreta"})
    assert ok.status_code == 200


def test_token_de_administracion(tmp_path, monkeypatch):
    monkeypatch.setenv("AGENTE_ADMIN_TOKEN", "t0k3n")
    c = TestClient(create_app(tmp_path))
    assert c.get("/api/agents").status_code == 401
    assert c.get("/api/agents", headers={"Authorization": "Bearer t0k3n"}).status_code == 200
    assert c.get("/api/info").json()["adminTokenRequired"] is True
    # hablar con el bot no necesita el token de administración
    assert c.post("/api/agents/pizzeria/detect", json={"text": "hola"}).status_code == 200


def test_exportar_e_importar(client):
    exported = client.get("/api/agents/pizzeria/export")
    assert exported.status_code == 200
    data = exported.content
    imported = client.post("/api/agents/import?filename=pizzeria.json&name=Copia", content=data).json()
    assert imported["name"] == "Copia" and len(imported["intents"]) == 19


def test_importar_zip_dialogflow(client):
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("agent.json", json.dumps({"displayName": "DF Bot", "language": "es", "mlMinConfidence": 0.4}))
        z.writestr("entities/color.json", json.dumps({"name": "color", "isRegexp": False}))
        z.writestr("entities/color_entries_es.json", json.dumps([{"value": "rojo", "synonyms": ["rojo", "colorado"]}]))
        z.writestr("intents/elegir color.json", json.dumps({
            "name": "elegir color", "contexts": [], "events": [],
            "responses": [{"action": "color.elegir", "affectedContexts": [{"name": "color-elegido", "lifespan": 3}],
                           "parameters": [{"name": "color", "dataType": "@color", "required": True,
                                           "prompts": [{"lang": "es", "value": "¿Qué color?"}]}],
                           "messages": [{"type": "0", "lang": "es", "speech": ["Has elegido $color"]}]}]}))
        z.writestr("intents/elegir color_usersays_es.json", json.dumps([
            {"data": [{"text": "quiero el "}, {"text": "rojo", "alias": "color", "meta": "@color"}]},
            {"data": [{"text": "me gusta el color "}, {"text": "colorado", "alias": "color", "meta": "@color"}]}]))
    res = client.post("/api/agents/import?filename=bot.zip", content=buf.getvalue())
    assert res.status_code == 201, res.text
    agent = res.json()
    it = next(i for i in agent["intents"] if i["name"] == "elegir color")
    assert it["trainingPhrases"][0]["annotations"] == [{"start": 10, "end": 14, "entity": "@color", "param": "color"}]
    assert it["outputContexts"] == [{"name": "color-elegido", "lifespan": 3}]
    assert agent["settings"]["threshold"] == 0.4
    r = client.post(f"/api/agents/{agent['id']}/detect", json={"text": "quiero el colorado"}).json()
    assert r["fulfillmentText"] == "Has elegido rojo"


def test_validacion(client):
    items = client.get("/api/agents/pizzeria/validate").json()
    assert not [i for i in items if i["level"] == "error"]


def test_dependencias_fijadas_para_el_servidor():
    """El Dockerfile instala requirements.lock (versiones exactas) y en él están todas las de
    requirements.txt, cada una dentro de su rango."""
    from pathlib import Path

    root = Path(__file__).resolve().parent.parent
    assert "pip install -r requirements.lock" in (root / "Dockerfile").read_text(encoding="utf-8")
    lines = [ln for ln in (root / "requirements.lock").read_text(encoding="utf-8").splitlines() if ln and not ln.startswith("#")]
    pinned = dict(ln.split("==") for ln in lines)
    assert all(re.fullmatch(r"\d+(\.\d+)*", v) for v in pinned.values()), pinned
    norm = lambda name: name.lower().replace("_", "-")
    pinned = {norm(k): tuple(int(x) for x in v.split(".")) for k, v in pinned.items()}
    for req in (root / "requirements.txt").read_text(encoding="utf-8").split():
        version = pinned[norm(re.split(r"[<>=,]", req)[0])]
        for op, ver in re.findall(r"(>=|<)([\d.]+)", req):
            limit = tuple(int(x) for x in ver.split("."))
            assert (version >= limit) if op == ">=" else (version < limit), (req, version)

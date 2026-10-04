"""Servidor con cuentas (AGENTE_ACCOUNTS): cada usuario ve solo sus agentes y los comparte con un enlace."""

import json

import pytest
from fastapi.testclient import TestClient

from app.server import create_app
from app.spaces import Accounts

CLAVE = "contraseña-larga"


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.delenv("AGENTE_ADMIN_TOKEN", raising=False)
    return TestClient(create_app(tmp_path, accounts=True))


def cuenta(client, user, password=CLAVE):
    r = client.post("/api/accounts", json={"user": user, "password": password})
    assert r.status_code == 201, r.text
    return {"X-Space-Key": r.json()["spaceKey"]}


def test_sin_cuenta_no_se_entra(client):
    assert client.get("/api/info").json()["accounts"] is True
    assert client.get("/api/agents").status_code == 401
    assert client.get("/api/agents", headers={"X-Space-Key": "x" * 32}).status_code == 401


def test_crear_cuenta_y_entrar(client, tmp_path):
    h = cuenta(client, "Fulano")
    agents = client.get("/api/agents", headers=h).json()
    assert sorted(a["id"] for a in agents) == ["hotel", "pizzeria"] and all(a["example"] for a in agents)
    me = client.get("/api/account", headers=h).json()
    assert me["user"] == "Fulano" and me["agents"] == 2
    assert {a["publicId"] for a in agents} == {f"{me['spaceId']}.hotel", f"{me['spaceId']}.pizzeria"}
    # el usuario no distingue mayúsculas; la llave es la misma con la que se creó
    r = client.post("/api/login", json={"user": "fulano", "password": CLAVE}).json()
    assert r["spaceKey"] == h["X-Space-Key"] and r["user"] == "Fulano"
    assert client.post("/api/login", json={"user": "fulano", "password": "otra-cosa"}).status_code == 401
    assert client.post("/api/login", json={"user": "nadie", "password": CLAVE}).status_code == 401
    assert client.post("/api/accounts", json={"user": "FULANO", "password": CLAVE}).status_code == 409
    assert client.post("/api/accounts", json={"user": "a", "password": CLAVE}).status_code == 400
    assert client.post("/api/accounts", json={"user": "mengano", "password": "corta"}).status_code == 400
    # la contraseña no se guarda tal cual
    guardado = (tmp_path / "users" / "fulano.json").read_text(encoding="utf-8")
    assert CLAVE not in guardado and "hash" in json.loads(guardado)


def test_entrar_sin_cuenta_y_crearla_despues(client):
    """Sin cuenta: un espacio con los ejemplos que solo abre la llave de ese navegador. Si luego se
    crea la cuenta desde él, la cuenta se queda con ese espacio y con lo que tenga."""
    r = client.post("/api/guest")
    assert r.status_code == 201 and r.json()["guest"] is True and r.json()["user"] == ""
    h = {"X-Space-Key": r.json()["spaceKey"]}
    assert client.get("/api/account", headers=h).json() == {"user": "", "guest": True, "spaceId": r.json()["spaceId"], "agents": 2}
    client.post("/api/agents", json={"name": "Pastelería"}, headers=h)
    # otro invitado no ve nada de él
    otro = {"X-Space-Key": client.post("/api/guest").json()["spaceKey"]}
    assert "pasteleria" not in [a["id"] for a in client.get("/api/agents", headers=otro).json()]
    # crea la cuenta desde el invitado: misma llave, mismos agentes
    cuenta_nueva = client.post("/api/accounts", json={"user": "carla", "password": CLAVE}, headers=h)
    assert cuenta_nueva.status_code == 201 and cuenta_nueva.json()["spaceKey"] == h["X-Space-Key"]
    assert client.get("/api/account", headers=h).json()["user"] == "carla"
    assert client.post("/api/login", json={"user": "carla", "password": CLAVE}).json()["spaceKey"] == h["X-Space-Key"]
    assert "pasteleria" in [a["id"] for a in client.get("/api/agents", headers=h).json()]
    # la llave de una cuenta no se puede «adoptar» para otra: la nueva tiene su propio espacio
    otra = client.post("/api/accounts", json={"user": "dani", "password": CLAVE}, headers=h).json()
    assert otra["spaceKey"] != h["X-Space-Key"]
    assert client.get("/api/account", headers=h).json()["user"] == "carla"


def test_cada_uno_ve_solo_lo_suyo(client):
    ana, beto = cuenta(client, "ana"), cuenta(client, "beto")
    client.post("/api/agents", json={"name": "Pastelería"}, headers=ana)
    assert "pasteleria" in [a["id"] for a in client.get("/api/agents", headers=ana).json()]
    assert "pasteleria" not in [a["id"] for a in client.get("/api/agents", headers=beto).json()]
    assert client.get("/api/agents/pasteleria", headers=beto).status_code == 404
    # los ejemplos de cada uno son suyos: si Beto borra el hotel, Ana lo sigue teniendo
    client.delete("/api/agents/hotel", headers=beto)
    assert client.get("/api/agents/hotel", headers=ana).status_code == 200


def test_conversar_con_la_direccion_publica(client):
    h = cuenta(client, "ana")
    pid = client.get("/api/agents/pizzeria", headers=h).json()["publicId"]
    r = client.post(f"/api/agents/{pid}/detect", json={"sessionId": "s", "text": "hola"})  # el widget, sin llave
    assert r.status_code == 200 and r.json()["intent"]
    assert client.get(f"/api/agents/{pid}/public").json()["id"] == pid
    assert client.post(f"/v2/projects/{pid}/agent/sessions/s:detectIntent",
                       json={"queryInput": {"text": {"text": "hola"}}}).status_code == 200
    assert client.post("/api/agents/pizzeria/detect", json={"text": "hola"}, headers=h).status_code == 200
    assert client.post("/api/agents/0123456789abcdef.pizzeria/detect", json={"text": "hola"}).status_code == 404
    # lo que se habla desde fuera sale en el historial de su dueña: la sesión «s» (widget y
    # detectIntent) y la de la consola
    assert client.get("/api/agents/pizzeria/conversations", headers=h).json()["total"] == 2


def test_compartir_y_guardar_una_copia(client):
    ana, beto = cuenta(client, "ana"), cuenta(client, "beto")
    client.post("/api/agents", json={"name": "Pastelería"}, headers=ana)
    client.patch("/api/agents/pasteleria", headers=ana, json={"settings": {
        "apiKey": "secreta", "webhook": {"url": "https://ana.example/wh", "headers": {"Authorization": "Bearer x"}}}})
    assert client.get("/api/agents/pasteleria/share", headers=ana).json() == {"code": None}
    code = client.post("/api/agents/pasteleria/share", headers=ana).json()["code"]
    info = client.get(f"/api/shared/{code}").json()  # verlo no necesita cuenta
    assert info["name"] == "Pastelería" and info["intents"] == 2
    assert "secreta" not in client.get(f"/api/shared/{code}/download").text
    copia = client.post(f"/api/shared/{code}/save", headers=beto)
    assert copia.status_code == 201
    copia = copia.json()
    assert copia["settings"]["apiKey"] == "" and copia["settings"]["webhook"] == {"url": "", "headers": {}, "timeout": 5.0}
    assert not copia.get("example")
    # lo que cambia Ana no le llega a la copia de Beto
    client.patch("/api/agents/pasteleria", json={"description": "cambiada"}, headers=ana)
    assert client.get(f"/api/agents/{copia['id']}", headers=beto).json()["description"] == ""
    # volver a compartir actualiza la copia sin cambiar el enlace; dejar de compartir lo quita
    assert client.post("/api/agents/pasteleria/share", headers=ana).json()["code"] == code
    assert client.get(f"/api/shared/{code}").json()["description"] == "cambiada"
    assert client.delete("/api/agents/pasteleria/share", headers=ana).json() == {"ok": True}
    assert client.get(f"/api/shared/{code}").status_code == 404
    assert client.get(f"/api/agents/{copia['id']}", headers=beto).status_code == 200  # la copia se queda


def test_borrar_un_agente_quita_su_enlace(client):
    ana = cuenta(client, "ana")
    code = client.post("/api/agents/pizzeria/share", headers=ana).json()["code"]
    client.delete("/api/agents/pizzeria", headers=ana)
    assert client.get(f"/api/shared/{code}").status_code == 404


def test_los_agentes_iguales_comparten_modelo(client):
    ana, beto = cuenta(client, "ana"), cuenta(client, "beto")
    spaces = client.app.state.spaces
    a, b = spaces.by_key(ana["X-Space-Key"]), spaces.by_key(beto["X-Space-Key"])
    assert a.engines.get("pizzeria") is b.engines.get("pizzeria")  # el ejemplo se entrena una vez
    client.post("/api/agents/pizzeria/intents/" + client.get("/api/agents/pizzeria", headers=ana).json()["intents"][0]["id"]
                + "/phrases", json={"text": "una frase solo de ana"}, headers=ana)
    assert a.engines.get("pizzeria") is not b.engines.get("pizzeria")  # al cambiarlo, el suyo
    # «Reentrenar» entrena de verdad, aunque el modelo estuviera hecho
    assert client.post("/api/agents/pizzeria/train", headers=beto).status_code == 200
    assert b.engines.get("pizzeria") is not a.engines.get("pizzeria")


def test_cambiar_la_contrasena_y_bloqueo(client):
    h = cuenta(client, "ana")
    assert client.post("/api/account/password", json={"current": "no-es", "new": "otra-larga"}, headers=h).status_code == 401
    assert client.post("/api/account/password", json={"current": CLAVE, "new": "otra-larga"}, headers=h).json() == {"ok": True}
    assert client.post("/api/login", json={"user": "ana", "password": "otra-larga"}).status_code == 200
    for _ in range(Accounts.MAX_FAILS):
        client.post("/api/login", json={"user": "ana", "password": "no-es"})
    assert client.post("/api/login", json={"user": "ana", "password": "otra-larga"}).status_code == 429


def test_restablecer_contrasena_el_dueno(client, tmp_path):
    cuenta(client, "ana")
    Accounts(tmp_path).reset_password("ana", "puesta-por-el-dueno")  # python -m app.users password ana
    assert client.post("/api/login", json={"user": "ana", "password": "puesta-por-el-dueno"}).status_code == 200


def test_limites(tmp_path, monkeypatch):
    monkeypatch.delenv("AGENTE_ADMIN_TOKEN", raising=False)
    monkeypatch.setenv("AGENTE_SPACES_PER_HOUR", "2")
    c = TestClient(create_app(tmp_path, accounts=True))
    cuenta(c, "uno")
    cuenta(c, "dos")
    assert c.post("/api/accounts", json={"user": "tres", "password": CLAVE}).status_code == 429


def test_sin_cuentas_no_hay_rutas_de_cuentas(tmp_path, monkeypatch):
    monkeypatch.delenv("AGENTE_ACCOUNTS", raising=False)
    c = TestClient(create_app(tmp_path))
    assert c.get("/api/info").json()["accounts"] is False
    assert c.post("/api/accounts", json={"user": "ana", "password": CLAVE}).status_code in (404, 405)
    assert c.get("/api/agents").status_code == 200  # la instalación local no pide cuenta
    assert "publicId" in c.get("/api/agents/pizzeria").json()


def test_ejemplos_de_demostracion_sin_cuenta(client):
    """/chat?agent=hotel funciona sin cuenta (los ejemplos de demostración), pero nadie puede cambiarlos."""
    r = client.post("/api/agents/hotel/detect", json={"sessionId": "visita", "text": "hola"})
    assert r.status_code == 200 and r.json()["intent"]
    assert client.get("/api/agents/pizzeria/public").json()["id"] == "pizzeria"
    assert client.post("/api/agents/pasteleria/detect", json={"text": "hola"}).status_code == 404
    assert client.patch("/api/agents/hotel", json={"name": "Otro"}).status_code == 401
    assert client.delete("/api/agents/hotel").status_code == 401
    # con la llave de una cuenta, «hotel» es el de esa cuenta, no el de demostración
    h = cuenta(client, "ana")
    client.patch("/api/agents/hotel", json={"name": "El hotel de Ana"}, headers=h)
    assert client.get("/api/agents/hotel/public").json()["name"] == "Hotel (ejemplo)"
    assert client.get("/api/agents/hotel/public", headers=h).json()["name"] == "El hotel de Ana"

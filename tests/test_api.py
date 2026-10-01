"""Pruebas de la API REST."""

import io
import json
import zipfile

import pytest
from fastapi.testclient import TestClient

from app.server import create_app


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.delenv("AGENTE_ADMIN_TOKEN", raising=False)
    return TestClient(create_app(tmp_path))


def test_arranca_con_agente_de_ejemplo(client):
    agents = client.get("/api/agents").json()
    assert [a["id"] for a in agents] == ["pizzeria"]
    assert client.get("/").status_code == 200
    assert client.get("/widget.js").status_code == 200
    assert client.get("/chat").status_code == 200


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

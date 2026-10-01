"""Pruebas del gestor de diálogo: contextos, preguntas de parámetros, fallback, webhook."""

import json
import random
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

import pytest

from app.dialog import DialogManager, EngineCache
from app.responses import format_value, render
from app.storage import Storage

ROOT = Path(__file__).resolve().parent.parent


@pytest.fixture()
def dm(tmp_path):
    st = Storage(tmp_path)
    st.save_agent(json.loads((ROOT / "examples" / "pizzeria.json").read_text(encoding="utf-8")))
    return DialogManager(st, EngineCache(st), random.Random(0))


def say(dm, text=None, event=None, session="s1"):
    return dm.detect("pizzeria", session, text=text, event=event, source="test")


def test_evento_bienvenida(dm):
    r = say(dm, event="WELCOME")
    assert r["intent"]["name"] == "Bienvenida"
    assert any(m["type"] == "quickReplies" for m in r["messages"])


def test_pregunta_parametros_obligatorios_y_contextos(dm):
    r = say(dm, "quiero una pizza")
    assert r["intent"]["name"] == "pedido.pizza" and not r["allRequiredParamsPresent"]
    assert "pizza" in r["fulfillmentText"].lower()
    r = say(dm, "una barbacoa")
    assert r["parameters"]["pizza"] == "barbacoa" and not r["allRequiredParamsPresent"]
    r = say(dm, "grande")
    assert r["allRequiredParamsPresent"]
    assert r["parameters"] == {"cantidad": 1, "pizza": "barbacoa", "tamano": "familiar"}
    assert "barbacoa (familiar)" in r["fulfillmentText"]
    names = {c["name"]: c["lifespan"] for c in r["outputContexts"]}
    assert names == {"pedido": 5, "pedido-entrega": 2}
    r = say(dm, "a domicilio")
    assert r["intent"]["name"] == "pedido.entrega"
    r = say(dm, "si")
    assert r["intent"]["name"] == "pedido.bebida.si"


def test_cancelar_pregunta(dm):
    say(dm, "quiero reservar mesa")
    r = say(dm, "para 4")  # "para" no debe entenderse como "parar"
    assert r["parameters"].get("personas") == 4
    r = say(dm, "olvídalo")
    assert r["match"] == "cancel"
    r = say(dm, "gracias")
    assert r["intent"]["name"] == "agradecimiento"


def test_cambio_de_tema_durante_pregunta(dm):
    say(dm, "quiero una pizza")
    r = say(dm, "a qué hora abrís")
    assert r["intent"]["name"] == "info.horario"


def test_respuesta_con_fecha_legible(dm):
    r = say(dm, "reserva para dos el 15 de octubre a las 21:30")
    assert r["allRequiredParamsPresent"]
    assert "a las 21:30" in r["fulfillmentText"]
    assert "octubre" in r["fulfillmentText"]


def test_fallback_y_registro(dm):
    r = say(dm, "cual es la capital de francia")
    assert r["match"] == "fallback" and r["intent"]["isFallback"]
    logs, total = dm.storage.list_logs("pizzeria", review="pending")
    assert total == 1 and logs[0]["isFallback"]


def test_respuestas_a_preguntas_no_se_revisan(dm):
    say(dm, "quiero una pizza")
    say(dm, "una barbacoa")
    logs, _ = dm.storage.list_logs("pizzeria", review="pending")
    assert [entry["query"] for entry in logs] == ["quiero una pizza"]


def test_fin_de_conversacion_reinicia_contextos(dm):
    say(dm, "reserva para dos mañana a las 9")
    r = say(dm, "adiós")
    assert r["endConversation"] and r["outputContexts"] == []
    r = say(dm, "hola")
    assert r["outputContexts"] == []


def test_contextos_caducan(dm):
    say(dm, "quiero una margarita mediana")  # pedido-entrega dura 2 turnos
    say(dm, "gracias")
    say(dm, "gracias")
    r = say(dm, "a domicilio")
    assert r["intent"]["name"] != "pedido.entrega"


def test_render_referencias():
    ctx = {"pedido": {"lifespan": 3, "parameters": {"pizza": "barbacoa", "pizza.original": "bbq"}}}
    out = render("$n pizzas $tipo el $fecha ($fecha.original) #pedido.pizza #pedido.pizza.original $nada",
                 {"n": 2, "tipo": ["margarita", "barbacoa", "vegetal"], "fecha": "2026-10-02"},
                 {"fecha": "pasado mañana"}, ctx, "es")
    assert out == "2 pizzas margarita, barbacoa y vegetal el viernes 2 de octubre (pasado mañana) barbacoa bbq"


def test_format_value():
    assert format_value({"amount": 12.5, "currency": "EUR"}) == "12,5 €"
    assert format_value({"amount": 2, "unit": "h"}) == "2 horas"
    assert format_value("2026-10-02T21:30:00") == "viernes 2 de octubre a las 21:30"


class _Webhook(BaseHTTPRequestHandler):
    received = []

    def do_POST(self):  # noqa: N802
        body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        _Webhook.received.append(body)
        reply = {"fulfillmentText": f"Pedido de {body['queryResult']['parameters'].get('pizza')} en camino",
                 "outputContexts": [{"name": body["session"] + "/contexts/seguimiento", "lifespanCount": 3}]}
        data = json.dumps(reply).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, *args):
        pass


def test_webhook_formato_dialogflow(dm):
    server = HTTPServer(("127.0.0.1", 0), _Webhook)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    try:
        agent = dm.storage.get_agent("pizzeria")
        agent["settings"]["webhook"]["url"] = f"http://127.0.0.1:{server.server_port}/"
        for it in agent["intents"]:
            if it["name"] == "pedido.pizza":
                it["webhook"] = True
        dm.storage.save_agent(agent)
        r = say(dm, "quiero una carbonara mediana")
        assert r["webhook"]["ok"], r["webhook"]
        assert r["fulfillmentText"] == "Pedido de carbonara en camino"
        assert "seguimiento" in {c["name"] for c in r["outputContexts"]}
        q = _Webhook.received[-1]["queryResult"]
        assert q["intent"]["displayName"] == "pedido.pizza" and q["action"] == "pedido.crear"
    finally:
        server.shutdown()


def test_webhook_caido_usa_respuesta_estatica(dm):
    agent = dm.storage.get_agent("pizzeria")
    agent["settings"]["webhook"] = {"url": "http://127.0.0.1:9/", "headers": {}, "timeout": 1}
    for it in agent["intents"]:
        if it["name"] == "info.horario":
            it["webhook"] = True
    dm.storage.save_agent(agent)
    r = say(dm, "a qué hora abrís")
    assert not r["webhook"]["ok"]
    assert "Abrimos" in r["fulfillmentText"]

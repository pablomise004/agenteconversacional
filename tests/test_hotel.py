"""Pruebas del agente grande de ejemplo (examples/hotel.json): acierto, contextos y conversaciones."""

import copy
import importlib.util
import json
import random
from datetime import datetime
from pathlib import Path

import pytest

from app.dialog import DialogManager, EngineCache
from app.nlu.engine import NLUEngine
from app.storage import Storage

from .casos_hotel import CON_CONTEXTO, DIALOGOS, EN_DOMINIO, FUERA_DE_DOMINIO

ROOT = Path(__file__).resolve().parent.parent
AGENT = json.loads((ROOT / "examples" / "hotel.json").read_text(encoding="utf-8"))
THRESHOLD = AGENT["settings"]["threshold"]
NOW = datetime(2026, 9, 30, 13, 0)  # miércoles


@pytest.fixture(scope="module")
def dm(tmp_path_factory):
    # las fechas («el 12 de octubre», «mañana») se calculan siempre desde el mismo día
    with pytest.MonkeyPatch.context() as mp:
        mp.setattr(NLUEngine, "now", lambda self: NOW)
        st = Storage(tmp_path_factory.mktemp("hotel"))
        st.save_agent(copy.deepcopy(AGENT))
        yield DialogManager(st, EngineCache(st), random.Random(0))


@pytest.fixture(scope="module")
def hotel(dm):
    return dm.engines.get("hotel")  # el mismo motor ya entrenado


def chat(dm, session, *turns):
    """Manda los mensajes en orden y devuelve la última respuesta."""
    r = None
    for t in turns:
        r = dm.detect("hotel", session, text=t, source="test")
    return r


def params(hotel, text):
    a = hotel.analyze(text, now=NOW)
    return a.best["name"], hotel.extract_parameters(hotel.intents[a.best["id"]], a)[0]


def test_ejemplo_generado_con_el_constructor():
    """examples/hotel.json se genera con tools/build_hotel.py: los dos tienen que ir a la par."""
    spec = importlib.util.spec_from_file_location("build_hotel", ROOT / "tools" / "build_hotel.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    assert mod.agent == AGENT, "ejecuta: python tools/build_hotel.py"


# ------------------------------------------------------------ clasificación
def test_acierto_en_dominio(hotel):
    fallos = []
    total = 0
    for name, frases in EN_DOMINIO.items():
        for t in frases:
            total += 1
            best = hotel.analyze(t).best
            if not (best and best["name"] == name and best["confidence"] >= THRESHOLD):
                fallos.append((t, name, best and best["name"]))
    assert 1 - len(fallos) / total >= 0.97, fallos


def test_rechaza_fuera_de_dominio(hotel):
    aceptadas = [(t, b["name"]) for t in FUERA_DE_DOMINIO
                 if (b := hotel.analyze(t).best) and not b["isFallback"] and b["confidence"] >= THRESHOLD]
    assert 1 - len(aceptadas) / len(FUERA_DE_DOMINIO) >= 0.9, aceptadas


@pytest.mark.parametrize("contexts,text,expected", CON_CONTEXTO)
def test_contextos(hotel, contexts, text, expected):
    assert hotel.analyze(text, contexts).best["name"] == expected


def test_texto_libre_sin_otros_datos_ni_muletillas(hotel):
    assert params(hotel, "no se enciende la tele de la 215") == (
        "habitacion.averia", {"averia": "la tele", "habitacion_num": 215})
    assert params(hotel, "oye, la luz del baño no funciona") == ("habitacion.averia", {"averia": "la luz del baño"})
    # con ancla a la derecha («[X] no…») el hueco tampoco puede tragarse la habitación
    assert params(hotel, "estoy en la 304, no va la tele") == (
        "habitacion.averia", {"averia": "la tele", "habitacion_num": 304})
    # sin plantilla exacta: el modelo aprende las palabras del texto libre de las frases anotadas
    assert params(hotel, "la persiana no sube") == ("habitacion.averia", {"averia": "la persiana"})


def test_plantilla_con_comodin_no_gana_a_un_ejemplo_negativo(hotel):
    """«[X] hace un ruido raro» encaja con cualquier cosa, pero los ejemplos negativos mandan."""
    best = hotel.analyze("la nevera hace un ruido raro").best
    assert best["name"] == "habitacion.averia" and best["match"] == "exact"
    best = hotel.analyze("mi coche hace un ruido raro").best
    assert best["isFallback"] or best["confidence"] < THRESHOLD


def test_lista_y_numeros_del_mismo_tipo(hotel):
    assert params(hotel, "me podéis subir dos toallas y una almohada a la 310?") == (
        "habitacion.peticion", {"objeto": ["toallas", "almohada"], "cantidad": 2, "habitacion_num": 310})
    assert params(hotel, "reservar para 3 noches para 2 personas el viernes") == (
        "reserva.habitacion", {"noches": 3, "huespedes": 2, "fecha_entrada": "2026-10-02"})


# ----------------------------------------------------------- conversaciones
@pytest.mark.parametrize("caso", DIALOGOS, ids=lambda c: c["turnos"][0])
def test_dialogos(dm, caso):
    r = chat(dm, "dialogo-" + caso["turnos"][0], *caso["turnos"])
    assert r["intent"]["name"] == caso["intencion"]
    assert caso["parametros"].items() <= r["parameters"].items()


def test_reserva_completa_con_confirmacion(dm):
    r = chat(dm, "reserva", "quiero reservar una habitación")
    assert r["intent"]["name"] == "reserva.habitacion" and r["parameters"] == {}  # «una» no son las noches
    r = chat(dm, "reserva", "el 12 de octubre", "3", "somos 2", "una doble")
    assert r["parameters"] == {"fecha_entrada": "2026-10-12", "noches": 3, "huespedes": 2, "habitacion": "doble"}
    assert "¿La confirmo?" in r["fulfillmentText"] and "lunes 12 de octubre" in r["fulfillmentText"]
    r = chat(dm, "reserva", "sí, confírmala")
    assert r["intent"]["name"] == "reserva.confirmar.si" and not r["allRequiredParamsPresent"]
    r = chat(dm, "reserva", "a nombre de Laura Gómez", "laura.gomez@gmail.com")
    assert r["parameters"] == {"nombre": "Laura Gómez", "email": "laura.gomez@gmail.com"}
    assert "Laura Gómez" in r["fulfillmentText"] and "doble" in r["fulfillmentText"]


def test_cambios_antes_de_confirmar(dm):
    r = chat(dm, "cambios", "Quiero una suite del 3 al 6 de diciembre para 2 personas")
    assert r["intent"]["name"] == "reserva.habitacion.fechas"
    r = chat(dm, "cambios", "mejor para 3 personas")
    assert r["intent"]["name"] == "reserva.cambiar.personas" and r["parameters"] == {"huespedes": 3}
    r = chat(dm, "cambios", "mejor una familiar", "vale, confírmala", "Pedro Ruiz", "pedro@ruiz.es")
    assert r["intent"]["name"] == "reserva.confirmar.si" and r["allRequiredParamsPresent"]
    assert "familiar · 👥 3" in r["fulfillmentText"] and "3 de diciembre" in r["fulfillmentText"]


def test_cancelacion_con_codigo(dm):
    r = chat(dm, "cancelar", "quiero cancelar mi reserva")
    assert r["intent"]["name"] == "reserva.cancelar" and not r["allRequiredParamsPresent"]
    r = chat(dm, "cancelar", "MIR-48213")
    assert r["parameters"] == {"codigo": "MIR-48213"}
    r = chat(dm, "cancelar", "sí, cancélala")
    assert r["intent"]["name"] == "reserva.cancelar.si" and "MIR-48213" in r["fulfillmentText"]


def test_averia_pregunta_la_habitacion(dm):
    r = chat(dm, "averia", "el aire acondicionado no funciona")
    assert r["parameters"] == {"averia": "el aire acondicionado"} and not r["allRequiredParamsPresent"]
    r = chat(dm, "averia", "estoy en la 304")
    assert "el aire acondicionado en la habitación 304" in r["fulfillmentText"]
    # si pregunta qué falla y la respuesta trae más cosas, se queda solo con la avería
    r = chat(dm, "averia2", "tengo una avería en la habitación")
    assert not r["allRequiredParamsPresent"]
    r = chat(dm, "averia2", "estoy en la 304, no va la tele")
    assert r["parameters"] == {"averia": "la tele", "habitacion_num": 304}


def test_horas_segun_la_parte_del_dia(dm):
    r = chat(dm, "despertador", "despiértame mañana a las 7", "habitación 118")
    assert r["parameters"] == {"hora": "07:00:00", "fecha": "2026-10-01", "habitacion_num": 118}
    r = chat(dm, "mesa", "mesa para cenar esta noche a las 9 para dos")
    assert r["parameters"] == {"fecha": "2026-09-30", "hora": "21:00:00", "personas": 2}


def test_no_repite_la_misma_respuesta(dm):
    a = chat(dm, "chistes", "cuéntame un chiste")
    b = chat(dm, "chistes", "otro chiste")
    assert a["intent"]["name"] == b["intent"]["name"] == "charla.chiste"
    assert a["fulfillmentText"] != b["fulfillmentText"]


def test_fuera_de_tema_y_charla(dm):
    r = chat(dm, "charla", "¿cuál es la capital de francia?")
    assert r["match"] == "fallback"
    r = chat(dm, "charla", "eres tonta")
    assert r["intent"]["name"] == "charla.insulto"

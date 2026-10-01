"""Pruebas del motor de lenguaje: tokenización, entidades y clasificación."""

import json
from datetime import datetime
from pathlib import Path

import pytest

from app.nlu.common import resolve_overlaps
from app.nlu.engine import NLUEngine
from app.nlu.languages import get_language
from app.nlu.spelling import SpellCorrector, edit_distance
from app.nlu.stemmer_es import stem
from app.nlu.sys_entities import SysEntityExtractor, parse_digits
from app.nlu.text import Tokenizer

from .casos_pizzeria import CON_CONTEXTO, EN_DOMINIO, FUERA_DE_DOMINIO

ROOT = Path(__file__).resolve().parent.parent
NOW = datetime(2026, 9, 30, 13, 0)  # miércoles


@pytest.fixture(scope="module")
def pizzeria():
    agent = json.loads((ROOT / "examples" / "pizzeria.json").read_text(encoding="utf-8"))
    return NLUEngine(agent)


# ------------------------------------------------------------- tokenización
def test_tokenizer_normaliza_y_expande_abreviaturas():
    tk = Tokenizer(get_language("es"))
    toks = tk.tokenize("Holaaaa, ¿q tal? xfa jajajaja")
    norms = [t.norm for t in toks if t.kind == "word"]
    assert norms == ["hola", "que", "tal", "por", "favor", "jaja"]
    assert toks[0].text == "Holaaaa" and toks[0].start == 0


def test_tokenizer_conserva_posiciones():
    text = "Reserva el 15/03 a las 17:30, pepe@mail.com"
    toks = Tokenizer(get_language("es")).tokenize(text)
    for t in toks:
        assert text[t.start:t.end] == t.text
    kinds = {t.text: t.kind for t in toks}
    assert kinds["15/03"] == "date" and kinds["17:30"] == "time" and kinds["pepe@mail.com"] == "email"


def test_normalizacion_propia_del_agente():
    tk = Tokenizer(get_language("es"), {"pizzeta": "pizza"})
    assert [t.norm for t in tk.tokenize("una pizzeta")] == ["una", "pizza"]


@pytest.mark.parametrize("a,b", [
    ("reservar", "reservación"), ("cancelación", "cancelacion"), ("pizzas", "pizza"),
    ("ciudades", "ciudad"), ("grandes", "grande"), ("precios", "precio"),
])
def test_stemmer_misma_raiz(a, b):
    from app.nlu.text import normalize_text
    assert stem(normalize_text(a)) == stem(normalize_text(b))


def test_corrector_ortografico():
    from collections import Counter
    sc = SpellCorrector(Counter({"reservar": 3, "pizza": 5, "quiero": 4, "habla": 1}))
    assert sc.correct("rezervar") == "reservar"
    assert sc.correct("piza") == "pizza"
    assert sc.correct("qiero") == "quiero"
    assert sc.correct("abla") == "habla"  # h muda
    assert sc.correct("apaga") is None  # no cambia la primera letra
    assert edit_distance("hola", "ohla") == 1


# ---------------------------------------------------- entidades de sistema
def extract(text, lang="es"):
    language = get_language(lang)
    toks = Tokenizer(language).tokenize(text)
    cands = SysEntityExtractor(language).extract(text, toks, NOW)
    return {(c.entity, c.text): c.value for c in resolve_overlaps(cands)}, cands


@pytest.mark.parametrize("text,entity,value", [
    ("mañana", "@sys.date", "2026-10-01"),
    ("pasado mañana", "@sys.date", "2026-10-02"),
    ("el lunes que viene", "@sys.date", "2026-10-05"),
    ("el 15 de marzo de 2027", "@sys.date", "2027-03-15"),
    ("el 1º de mayo", "@sys.date", "2027-05-01"),
    ("dentro de 3 días", "@sys.date", "2026-10-03"),
    ("15/10", "@sys.date", "2026-10-15"),
    ("este fin de semana", "@sys.date", "2026-10-03"),
    ("a las 9 de la noche", "@sys.time", "21:00:00"),
    ("a las cinco y cuarto", "@sys.time", "17:15:00"),
    ("a la una menos cuarto", "@sys.time", "12:45:00"),
    ("a las 17:30", "@sys.time", "17:30:00"),
    ("doscientos treinta y cinco", "@sys.number", 235),
    ("dos mil veintiséis", "@sys.number", 2026),
    ("3,5", "@sys.number", 3.5),
    ("1.500 euros", "@sys.unit-currency", {"amount": 1500, "currency": "EUR"}),
    ("un 15%", "@sys.percentage", 15),
    ("una hora y media", "@sys.duration", {"amount": 1.5, "unit": "h"}),
    ("la segunda", "@sys.ordinal", 2),
])
def test_entidades_sistema_es(text, entity, value):
    found, _ = extract(text)
    assert value in [v for (e, _t), v in found.items() if e == entity], found


def test_no_confunde_numeros_con_horas():
    found, _ = extract("quiero las dos pizzas")
    assert not any(e == "@sys.time" for e, _ in found)
    assert 2 in found.values()


def test_fecha_y_hora_combinadas():
    _, cands = extract("mañana a las 9 de la noche")
    dt = [c.value for c in cands if c.entity == "@sys.date-time"]
    assert "2026-10-01T21:00:00" in dt


def test_email_telefono_url():
    found, _ = extract("escribe a pepe@gmail.com o llama al 612 345 678, web https://pepe.es")
    entities = {e for e, _ in found}
    assert {"@sys.email", "@sys.phone-number", "@sys.url"} <= entities


def test_entidades_ingles():
    found, _ = extract("book a table for four tomorrow at 8pm", "en")
    values = set(map(str, found.values()))
    assert {"4", "2026-10-01", "20:00:00"} <= values


@pytest.mark.parametrize("s,v", [("1.000", 1000), ("1,5", 1.5), ("2.5", 2.5), ("1.500,25", 1500.25), ("12", 12)])
def test_parse_digits(s, v):
    assert parse_digits(s) == v


# --------------------------------------------------------- entidades propias
def test_entidades_propias_sinonimos_plural_y_faltas(pizzeria):
    a = pizzeria.analyze("me pones dos pizas barbacoa familiares")
    got = {e.entity: e.value for e in a.entities}
    assert got["@pizza"] == "barbacoa"
    assert got["@tamano"] == "familiar"  # "familiares" por raíz
    assert got["@sys.number"] == 2


# ------------------------------------------------------------ clasificación
def test_acierto_en_dominio(pizzeria):
    threshold = 0.3
    total = ok = 0
    fallos = []
    for name, frases in EN_DOMINIO.items():
        for t in frases:
            total += 1
            best = pizzeria.analyze(t).best
            if best and best["name"] == name and best["confidence"] >= threshold:
                ok += 1
            else:
                fallos.append((t, name, best and best["name"]))
    assert ok / total >= 0.93, fallos


def test_rechaza_fuera_de_dominio(pizzeria):
    rechazadas = sum(1 for t in FUERA_DE_DOMINIO
                     if (b := pizzeria.analyze(t).best) is None or b["confidence"] < 0.3 or b["isFallback"])
    assert rechazadas / len(FUERA_DE_DOMINIO) >= 0.8


@pytest.mark.parametrize("contexts,text,expected", CON_CONTEXTO)
def test_contextos(pizzeria, contexts, text, expected):
    assert pizzeria.analyze(text, contexts).best["name"] == expected


def test_sin_contexto_no_se_activan_intenciones_de_seguimiento(pizzeria):
    ranking = pizzeria.analyze("si").ranking
    assert all(r["name"] not in ("pedido.bebida.si", "pedido.bebida.no") for r in ranking)


def test_parametros_y_plantilla_exacta(pizzeria):
    a = pizzeria.analyze("me pones una margarita familiar")
    best = a.best
    assert best["name"] == "pedido.pizza" and best["match"] == "exact"
    vals, _ = pizzeria.extract_parameters(pizzeria.intents[best["id"]], a)
    assert vals == {"cantidad": 1, "pizza": "margarita", "tamano": "familiar"}


def test_varios_parametros_del_mismo_tipo():
    agent = {"language": "es", "entities": [{"name": "ciudad", "entries": [
        {"value": "Madrid", "synonyms": ["Madrid"]}, {"value": "Sevilla", "synonyms": ["Sevilla"]},
        {"value": "Bilbao", "synonyms": ["Bilbao"]}]}],
        "intents": [{"id": "viaje", "name": "viaje", "parameters": [
            {"name": "origen", "entity": "@ciudad"}, {"name": "destino", "entity": "@ciudad"}],
            "trainingPhrases": [
                {"text": "de Madrid a Sevilla", "annotations": [
                    {"start": 3, "end": 9, "entity": "@ciudad", "param": "origen"},
                    {"start": 12, "end": 19, "entity": "@ciudad", "param": "destino"}]},
                {"text": "quiero ir a Bilbao desde Madrid", "annotations": [
                    {"start": 12, "end": 18, "entity": "@ciudad", "param": "destino"},
                    {"start": 25, "end": 31, "entity": "@ciudad", "param": "origen"}]},
                {"text": "un billete de tren", "annotations": []}]}]}
    eng = NLUEngine(agent)
    a = eng.analyze("necesito ir a Sevilla desde Bilbao")
    vals, _ = eng.extract_parameters(eng.intents["viaje"], a)
    assert vals == {"origen": "Bilbao", "destino": "Sevilla"}


def test_sys_any_con_anclas():
    agent = {"language": "es", "entities": [], "intents": [
        {"id": "n", "name": "nombre", "parameters": [{"name": "nombre", "entity": "@sys.any"}],
         "trainingPhrases": [{"text": "me llamo Pedro", "annotations": [
             {"start": 9, "end": 14, "entity": "@sys.any", "param": "nombre"}]}]}]}
    eng = NLUEngine(agent)
    a = eng.analyze("hola, me llamo María José")
    vals, _ = eng.extract_parameters(eng.intents["n"], a)
    assert vals == {"nombre": "María José"}


def test_auto_anotacion(pizzeria):
    res = pizzeria.auto_annotate("quiero una barbacoa pequeña para mañana")
    got = {(a["entity"], res["text"][a["start"]:a["end"]]) for a in res["annotations"]}
    assert ("@pizza", "barbacoa") in got and ("@tamano", "pequeña") in got
    assert ("@sys.date", "mañana") in got


def test_agente_vacio_no_falla():
    eng = NLUEngine({"language": "es", "intents": [], "entities": []})
    assert eng.analyze("hola").ranking == []

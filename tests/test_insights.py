"""Pruebas de la información del modelo (página «Entrenar»)."""

import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.nlu import insights
from app.nlu.engine import NLUEngine
from app.server import create_app

ROOT = Path(__file__).resolve().parent.parent


@pytest.fixture(scope="module")
def agent():
    return json.loads((ROOT / "examples" / "pizzeria.json").read_text(encoding="utf-8"))


@pytest.fixture(scope="module")
def engine(agent):
    return NLUEngine(agent)


def test_informe_y_curva_de_aprendizaje(engine):
    r = engine.report
    assert r["phrases"] == 174 and r["intents"] == 18
    assert r["features"] == sum(r["featureKinds"].values())
    hist = r["history"]
    assert len(hist) == r["epochs"] + 1  # época 0 = antes de aprender
    assert hist[0]["loss"] > hist[-1]["loss"] * 5  # el error baja mucho
    assert hist[-1]["accuracy"] > 0.95
    assert r["example"]


def test_rasgos_mas_importantes(engine):
    top = {t["name"]: [f["label"] for f in t["features"]] for t in insights.top_features(engine, k=5)}
    assert "gracias" in top["agradecimiento"]
    assert "hola" in top["Bienvenida"]
    assert all(not label.startswith("…") for labels in top.values() for label in labels)  # sin trozos


def test_describe_feature(engine):
    assert insights.describe_feature(engine, "w:reserv")["label"].startswith("reserv")
    assert insights.describe_feature(engine, "c:<pi")["label"] == "pi…"
    assert insights.describe_feature(engine, "e:@pizza")["label"] == "@pizza"


def test_mapa_de_frases(engine):
    proj = insights.public_projection(engine)
    pts = proj["points"]
    assert len(pts) == 174
    assert all(0 <= p["x"] <= 1 and 0 <= p["y"] <= 1 for p in pts)
    # sin puntos superpuestos
    close = sum(1 for i, p in enumerate(pts) for q in pts[i + 1:]
                if (p["x"] - q["x"]) ** 2 + (p["y"] - q["y"]) ** 2 < 0.01 ** 2)
    assert close == 0


def test_explicar_frase(engine):
    ex = insights.explain(engine, "quiero reservar mesa para 4 mañana")
    assert ex["ranking"][0]["name"] == "reserva.mesa"
    labels = [p["label"] for p in ex["contributions"][0]["positive"]]
    assert any(label.startswith("reserv") for label in labels)
    assert ex["position"] is not None
    assert {e["entity"] for e in ex["entities"]} >= {"@sys.number", "@sys.date"}


def test_examen_validacion_cruzada(agent):
    ev = insights.evaluate(agent, folds=5)
    assert ev["total"] == 174
    assert 0.4 < ev["accuracy"] < 1.0
    n = len(ev["matrix"]["labels"])
    assert all(len(row) == n for row in ev["matrix"]["counts"])
    assert sum(map(sum, ev["matrix"]["counts"])) == 174
    assert len(ev["errors"]) == ev["total"] - ev["correct"]


def test_api_modelo_explicar_examen(tmp_path):
    c = TestClient(create_app(tmp_path))
    m = c.get("/api/agents/pizzeria/model").json()
    assert m["report"]["phrases"] == 174 and m["evaluation"] is None
    assert len(m["projection"]["points"]) == 174
    e = c.post("/api/agents/pizzeria/explain", json={"text": "hola buenas"}).json()
    assert e["accepted"] and e["ranking"][0]["name"] == "Bienvenida"
    ev = c.post("/api/agents/pizzeria/evaluate", json={"folds": 3}).json()
    assert ev["folds"] == 3
    assert c.get("/api/agents/pizzeria/model").json()["evaluation"]["accuracy"] == ev["accuracy"]
    t = c.post("/api/agents/pizzeria/train").json()
    assert t["upToDate"] and len(t["report"]["history"]) == 16
    assert c.get("/guia/GUIA.md").status_code == 200

"""Machine learning: leer tablas, preparar los datos, los algoritmos, los entrenamientos, los modelos y su API.

Los entrenamientos de la API usan los ejemplos (pingüinos, bicis y formas) con ajustes rápidos: la prueba
entera tarda unos segundos.
"""

import base64
import io
import json
import re
import time
import zipfile
from datetime import date

import numpy as np
import pytest
from fastapi.testclient import TestClient

from app.ml import algorithms as alg
from app.ml import examples as ex
from app.ml.prep import EMPTY, Preparer
from app.ml.runner import JobError, check_config, duration
from app.ml.table import CATEGORY, DATE, NUMBER, TEXT, read_csv, suggest_task
from app.server import create_app

FILA = {"isla": "Biscoe", "pico_largo_mm": 47.5, "pico_alto_mm": 15, "aleta_mm": 217, "peso_g": 5200, "sexo": "macho"}
CLAVE = "contraseña-larga"


@pytest.fixture(scope="module")
def client(tmp_path_factory):
    with pytest.MonkeyPatch.context() as mp:
        mp.delenv("AGENTE_ADMIN_TOKEN", raising=False)
        yield TestClient(create_app(tmp_path_factory.mktemp("ml")))


def proyecto(client, ejemplo, nombre=None, headers=None):
    r = client.post("/api/ml/projects", json={"name": nombre or ejemplo, "example": ejemplo}, headers=headers)
    assert r.status_code == 201, r.text
    return r.json()


def entrenar(client, pid, headers=None, **config):
    """Lanza un entrenamiento y espera a que acabe (bien o mal)."""
    r = client.post(f"/api/ml/projects/{pid}/jobs", json=config, headers=headers)
    assert r.status_code == 202, r.text
    jid = r.json()["id"]
    for _ in range(1200):
        job = client.get(f"/api/ml/projects/{pid}/jobs/{jid}", headers=headers).json()
        if job["status"] not in ("queued", "running"):
            return job
        time.sleep(0.05)
    raise AssertionError(f"El entrenamiento {jid} no termina")


def predecir(client, pid, mid, **body):
    r = client.post(f"/api/ml/projects/{pid}/models/{mid}/predict", json=body)
    assert r.status_code == 200, r.text
    return r.json()["predictions"]


def script(client, pid, mid) -> str:
    """El script equivalente del modelo: tiene que ser Python válido."""
    r = client.get(f"/api/ml/projects/{pid}/models/{mid}/code")
    assert r.status_code == 200
    compile(r.text, f"{mid}.py", "exec")
    return r.text


@pytest.fixture(scope="module")
def pinguinos(client):
    """El ejemplo de los pingüinos con un entrenamiento automático (clasificar la especie)."""
    p = proyecto(client, "pinguinos", "Pingüinos")
    job = entrenar(client, p["id"], task="classification", target="especie", mode="auto")
    assert job["status"] == "done", job.get("error")
    return p, job


# ------------------------------------------------------------------ tablas
def test_csv_de_excel_en_espanol():
    """Punto y coma, coma decimal, fechas día/mes/año, vacíos y Windows-1252: cada columna con su tipo."""
    filas = ["id;nombre;altura;equipo;alta;nota;año"]
    for i in range(60):
        nota = "" if i == 4 else f"{5 + i % 5},5"
        filas.append(f"{i + 1};Persona {i};1,{60 + i % 30};{'ABC'[i % 3]};{i % 28 + 1:02d}/03/2024;{nota};{2020 + i % 2}")
    t = read_csv("\n".join(filas).encode("cp1252"))
    assert t.delimiter == ";" and t.decimal == ","
    assert {c.name: c.kind for c in t.columns} == {"id": NUMBER, "nombre": TEXT, "altura": NUMBER, "equipo": CATEGORY,
                                                   "alta": DATE, "nota": NUMBER, "año": NUMBER}
    assert t.column("altura").values[0] == pytest.approx(1.6)
    assert t.column("alta").values[1] == date(2024, 3, 2)
    assert np.isnan(t.column("nota").values[4]) and t.column("nota").values[0] == 5.5
    # el número de fila y los nombres (todos distintos) identifican la fila: no sirven para aprender
    assert t.column("id").is_id and t.column("nombre").is_id and not t.column("altura").is_id
    assert suggest_task(t, "equipo") == "classification"
    assert suggest_task(t, "altura") == "regression"
    assert suggest_task(t, "año") == "classification"  # pocos enteros: mejor como clases
    assert suggest_task(t, None) == "clustering"


def test_preparar_aprende_solo_del_entrenamiento():
    """Medianas, categorías y escalas salen de las filas de entrenamiento; las nuevas se preparan igual."""
    feats = [{"name": "peso", "kind": NUMBER}, {"name": "color", "kind": CATEGORY}, {"name": "dia", "kind": DATE}]
    ent = {"peso": np.array([1.0, 3.0, np.nan, 5.0]), "color": ["rojo", "azul", "rojo", None],
           "dia": [date(2024, 1, 1), date(2024, 1, 8), None, date(2024, 2, 5)]}
    prep = Preparer(feats).fit(ent)
    assert prep.feature_names == ["peso", "color = rojo", "color = azul", f"color = {EMPTY}",
                                  "dia · año", "dia · mes", "dia · día de la semana"]
    assert prep.scale_mask.tolist() == [True, False, False, False, True, True, True]  # el 0/1 no se escala
    assert prep.mean[0] == pytest.approx(3.0)  # el vacío se rellena con la mediana (3) antes de la media
    nueva = prep.records_to_cols([{"peso": None, "color": "verde", "dia": "2024-03-04"}])
    assert prep.transform(nueva, scaled=False)[0].tolist() == [3.0, 0, 0, 0, 2024, 3, 0]  # «verde» no la conoce
    # guardado y leído, prepara igual
    again = Preparer.from_state(json.loads(json.dumps(prep.to_state())))
    assert np.allclose(again.transform(nueva), prep.transform(nueva))
    # la explicación usa sus propias categorías (no los pingüinos) y la fecha del medio sirve de ejemplo
    onehot = next(s for s in prep.describe() if s["key"] == "onehot")
    assert "«azul» no vale «más» que «rojo»" in onehot["text"]
    assert next(s for s in prep.specs if s["name"] == "dia")["example"] == "2024-01-08"


def test_la_columna_que_se_predice_nunca_es_para_aprender():
    t = read_csv(ex.csv_bytes("pinguinos"))
    cfg = check_config(t, {"task": "classification", "target": "especie", "features": ["especie", "isla", "peso_g"]})
    assert cfg["features"] == ["isla", "peso_g"]
    assert "especie" not in check_config(t, {"task": "classification", "target": "especie"})["features"]
    # al agrupar, la columna con la que se comparan los grupos tampoco (la API la usaba si no se daban columnas)
    cfg = check_config(t, {"task": "clustering", "compare": "especie", "features": ["especie", "isla"]})
    assert cfg["features"] == ["isla"] and cfg["compare"] == "especie"
    assert "especie" not in check_config(t, {"task": "clustering", "compare": "especie"})["features"]
    with pytest.raises(JobError):
        check_config(t, {"task": "regression", "target": "especie"})  # no es un número
    with pytest.raises(JobError):
        check_config(t, {"task": "classification", "target": "no-existe"})
    # los ajustes se quedan dentro de sus límites y los desconocidos se ignoran
    cfg = check_config(t, {"task": "classification", "target": "especie", "mode": "custom", "algorithm": "tree",
                           "params": {"max_depth": 999, "raro": 1}})
    top = next(p for p in alg.ALGORITHMS["tree"].param_specs("classification") if p["key"] == "max_depth")["max"]
    assert cfg["params"] == {"max_depth": top}


def test_kmedias_da_varias_vueltas_y_elige_k():
    rng = np.random.default_rng(0)
    X = np.vstack([c + rng.normal(0, 0.6, (40, 2)) for c in ([0, 0], [6, 0], [0, 6])])
    *_, history = alg.kmeans_once(X, 3, np.random.default_rng(1))
    assert len(history) > 1 and history[-1] <= history[0]  # antes paraba siempre en la primera vuelta
    m = alg.make("kmeans", "clustering", {}).fit(X)
    assert m.k == 3 and m.sil > 0.6
    assert [s["k"] for s in m.search] == list(range(2, 9))


def test_duraciones():
    assert duration(96) == "96 ms" and duration(6840) == "6,8 s"


def test_guarda_aunque_windows_bloquee_un_momento_el_fichero(tmp_path, monkeypatch):
    """En Windows, reemplazar un fichero que otro hilo está leyendo falla un instante (la consola lee el
    entrenamiento cada medio segundo): antes el entrenamiento se quedaba «Entrenando» para siempre."""
    from app.ml import store
    real, calls = store.os.replace, []

    def busy(src, dst):
        calls.append(dst)
        if len(calls) < 3:
            raise PermissionError(13, "El proceso no tiene acceso al archivo")
        real(src, dst)

    monkeypatch.setattr(store.os, "replace", busy)
    store._write_json(tmp_path / "job.json", {"status": "done"})
    assert store._read_json(tmp_path / "job.json") == {"status": "done"} and len(calls) == 3


# ------------------------------------------------------------- la API
def test_info_y_ejemplos(client):
    info = client.get("/api/ml/info").json()
    assert {a["key"] for a in info["algorithms"]["classification"]} == {"logistic", "tree", "forest", "knn", "bayes"}
    assert {a["key"] for a in info["algorithms"]["regression"]} == {"linear", "tree", "forest", "knn"}
    assert [a["key"] for a in info["algorithms"]["images"]] == ["cnn", "pixels_logistic", "pixels_knn"]
    assert info["auto"]["classification"][0]["algorithm"] == "baseline"  # el automático siempre trae la línea base
    counts = {e["id"]: e.get("rows") or e.get("count") for e in info["examples"]}
    assert counts == {"pinguinos": 344, "bicis": 731, "formas": 150}


def test_entrenamiento_automatico(client, pinguinos):
    p, job = pinguinos
    board = job["leaderboard"]
    assert len(board) == 9 and sum(r["best"] for r in board) == 1
    best = next(r for r in board if r["best"])
    base = next(r for r in board if r["baseline"])
    assert best["cv"]["mean"] == max(r["cv"]["mean"] for r in board)  # elige por la validación cruzada
    assert best["test"] > base["test"] + 0.3
    assert all(r["modelId"] for r in board)
    assert [s["key"] for s in job["steps"]] == ["data", "split", "prep", "try", "choose", "explain"]
    assert all(s["status"] == "done" for s in job["steps"]) and job["fraction"] == 1
    # el registro escribe los decimales con coma, como el resto de la consola
    assert not [line["text"] for line in job["log"] if re.search(r"\d\.\d", line["text"])]
    proj = client.get(f"/api/ml/projects/{p['id']}").json()
    assert proj["best"]["modelId"] == job["best"]["modelId"] and len(proj["models"]) == 9


def test_modelo_predice_explica_y_tiene_script(client, pinguinos):
    p, job = pinguinos
    pid, mid = p["id"], job["best"]["modelId"]
    m = client.get(f"/api/ml/projects/{pid}/models/{mid}").json()
    assert "especie" not in [f["name"] for f in m["report"]["features"]]
    cols = {c["name"]: c for c in m["schema"]["columns"]}
    assert set(cols["isla"]["values"]) == {"Biscoe", "Dream", "Torgersen"} and cols["peso_g"]["kind"] == "number"
    a, b = predecir(client, pid, mid, rows=[FILA, {"isla": "Dream"}], explain=True)
    assert a["prediction"] == "Papúa" and a["confidence"] > 0.9
    assert sum(a["probabilities"].values()) == pytest.approx(1)
    assert a["explanation"]["kind"] and [c["column"] for c in a["prepared"]][0] == "isla"
    assert b["prediction"] in ("Adelia", "Barbijo", "Papúa")  # los vacíos se rellenan como al entrenar
    assert "LogisticRegression" in script(client, pid, mid) or m["report"]["algorithm"] != "logistic"


def test_predecir_un_csv_entero(client, pinguinos):
    """Por lotes: el mismo CSV con la predicción al final y, si trae la respuesta, cuánto acierta."""
    p, job = pinguinos
    url = f"/api/ml/projects/{p['id']}/models/{job['best']['modelId']}/batch"
    r = client.post(url, content=ex.csv_bytes("pinguinos"))
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["rows"] == 344 and d["newColumns"] == ["especie (predicción)", "seguridad"] and d["missingColumns"] == []
    assert d["columns"][-2:] == d["newColumns"] and len(d["preview"]) == 20
    lines = d["csv"].splitlines()
    assert len(lines) == 345 and lines[0].endswith(",especie (predicción),seguridad")
    assert sum(c["count"] for c in d["summary"]["counts"]) == 344
    check = d["summary"]["check"]
    assert check["rows"] == 344 and check["right"] / check["rows"] > 0.95
    # un CSV de Excel en español (punto y coma, coma decimal) sin la respuesta, con columnas de más y de menos:
    # sale igual que entró, con lo nuevo al final
    excel = "isla;pico_largo_mm;aleta_mm;nota\nBiscoe;47,5;217;x\nDream;39,1;181;y\n".encode("cp1252")
    d = client.post(url, content=excel).json()
    assert set(d["missingColumns"]) == {"pico_alto_mm", "peso_g", "sexo", "año"} and "check" not in d["summary"]
    head, first, second = d["csv"].splitlines()
    assert head == "isla;pico_largo_mm;aleta_mm;nota;especie (predicción);seguridad"
    first = first.split(";")
    assert first[:4] == ["Biscoe", "47,5", "217", "x"] and first[4] == "Papúa" and re.fullmatch(r"[01](,\d+)?", first[5])
    assert second.split(";")[4] == "Adelia"
    assert client.post(url, content=b"a,b\n1,2\n3,4\n").status_code == 400  # ninguna columna del modelo


@pytest.mark.parametrize("algorithm", ["logistic", "tree", "forest", "knn", "bayes"])
def test_cada_algoritmo_de_clasificacion(client, pinguinos, algorithm):
    """Cada uno entrena, predice con su explicación (que se pueda enviar como JSON: el árbol daba un error 500
    con un `numpy.bool`) y da un script que compila."""
    pid = pinguinos[0]["id"]
    job = entrenar(client, pid, task="classification", target="especie", mode="custom", algorithm=algorithm, folds=0)
    assert job["status"] == "done", job.get("error")
    mid = job["best"]["modelId"]
    (pred,) = predecir(client, pid, mid, rows=[FILA], explain=True)
    assert pred["prediction"] == "Papúa" and pred["explanation"]
    model = client.get(f"/api/ml/projects/{pid}/models/{mid}").json()
    assert model["report"]["learned"]
    script(client, pid, mid)


def test_regresion_con_fechas(client):
    p = proyecto(client, "bicis", "Bicis")
    pid = p["id"]
    kinds = {c["name"]: c["kind"] for c in p["profile"]["columns"]}
    assert kinds["fecha"] == "date" and kinds["alquileres"] == "number" and kinds["estacion"] == "category"
    for algorithm in ("linear", "tree", "forest", "knn"):
        job = entrenar(client, pid, task="regression", target="alquileres", mode="custom", algorithm=algorithm, folds=0,
                       params={"n_trees": 10} if algorithm == "forest" else {})
        assert job["status"] == "done", job.get("error")
        mid = job["best"]["modelId"]
        schema = client.get(f"/api/ml/projects/{pid}/models/{mid}").json()["schema"]
        cols = {c["name"]: c for c in schema["columns"]}
        assert date.fromisoformat(cols["fecha"]["example"])  # una fecha de verdad para rellenar «Probar»
        fila = {n: c.get("example", (c.get("values") or [None])[0]) for n, c in cols.items()}
        (pred,) = predecir(client, pid, mid, rows=[fila], explain=True)
        assert 0 < pred["prediction"] < 10000 and pred["explanation"]
        assert "fechas = [\"fecha\"]" in script(client, pid, mid)
    # por lotes, con la respuesta en el fichero: el resumen dice cuánto se equivoca
    d = client.post(f"/api/ml/projects/{pid}/models/{mid}/batch", content=ex.csv_bytes("bicis")).json()
    assert d["newColumns"] == ["alquileres (predicción)"] and d["rows"] == 731
    assert d["summary"]["check"]["r2"] > 0.5 and 0 < d["summary"]["check"]["mae"] < 2000
    assert 0 < d["summary"]["min"] <= d["summary"]["mean"] <= d["summary"]["max"]
    # un número que no es número: falla con un mensaje claro
    job = entrenar(client, pid, task="regression", target="estacion", mode="auto")
    assert job["status"] == "failed" and "números" in job["error"]


def test_agrupar_y_comparar(client, pinguinos):
    pid = pinguinos[0]["id"]
    job = entrenar(client, pid, task="clustering", mode="auto", compare="especie")
    assert job["status"] == "done", job.get("error")
    mid = job["best"]["modelId"]
    r = client.get(f"/api/ml/projects/{pid}/models/{mid}").json()["report"]
    k = r["metrics"]["k"]
    assert 2 <= k <= 8 and r["params"]["k"] == k  # la k elegida, no el 0 de «que lo elija»
    assert len(r["learned"]["history"]) > 1
    assert 0 < r["charts"]["compare"]["purity"] <= 1 and "especie" not in [f["name"] for f in r["features"]]
    assert f"n_clusters={k}" in script(client, pid, mid)  # el script hace los mismos grupos
    (pred,) = predecir(client, pid, mid, rows=[FILA], explain=True)
    assert 1 <= pred["prediction"] <= k and pred["explanation"]["kind"] == "centroids"
    # con k fija
    job = entrenar(client, pid, task="clustering", mode="custom", params={"k": 3})
    mid = job["best"]["modelId"]
    assert client.get(f"/api/ml/projects/{pid}/models/{mid}").json()["report"]["metrics"]["k"] == 3
    assert "n_clusters=3" in script(client, pid, mid)


def test_publicar_con_clave(client, pinguinos):
    p, job = pinguinos
    pid, mid = p["id"], job["best"]["modelId"]
    url = f"/api/ml/{pid}/predict"
    assert client.post(url, json={"rows": [FILA]}).status_code == 409  # nada publicado
    assert client.post(f"/api/ml/projects/{pid}/publish", json={"modelId": mid}).json()["published"]["modelId"] == mid
    assert client.post(url, json={"rows": [FILA]}).json()["predictions"][0]["prediction"] == "Papúa"
    key = client.patch(f"/api/ml/projects/{pid}", json={"apiKey": "new"}).json()["apiKey"]
    assert len(key) > 20
    assert client.post(url, json={"rows": [FILA]}).status_code == 401
    assert client.post(url, json={"rows": [FILA]}, headers={"X-Api-Key": "otra"}).status_code == 401
    assert client.post(url, json={"rows": [FILA]}, headers={"X-Api-Key": key}).status_code == 200
    schema = client.get(f"/api/ml/{pid}/schema", headers={"X-Api-Key": key}).json()
    assert schema["target"] == "especie" and {c["name"] for c in schema["columns"]} >= {"isla", "peso_g"}
    # por lotes (como un punto de conexión por lotes de Azure), también con la clave
    assert client.post(f"/api/ml/{pid}/batch", content=ex.csv_bytes("pinguinos")).status_code == 401
    r = client.post(f"/api/ml/{pid}/batch", content=ex.csv_bytes("pinguinos"), headers={"X-Api-Key": key})
    assert r.status_code == 200 and r.json()["rows"] == 344
    # se puede llamar desde otra web (CORS), pero solo en las rutas públicas
    pre = {"Origin": "https://otra-web.example", "Access-Control-Request-Method": "POST",
           "Access-Control-Request-Headers": "content-type,x-api-key"}
    assert client.options(url, headers=pre).headers["access-control-allow-origin"] == "*"
    assert client.options(f"/api/ml/{pid}/batch", headers=pre).headers["access-control-allow-origin"] == "*"
    assert "access-control-allow-origin" not in client.options(f"/api/ml/projects/{pid}", headers=pre).headers
    client.patch(f"/api/ml/projects/{pid}", json={"apiKey": ""})
    client.post(f"/api/ml/projects/{pid}/publish", json={"modelId": None})
    assert client.post(url, json={"rows": [FILA]}).status_code == 409


def test_imagenes(client):
    p = proyecto(client, "formas", "Formas")
    pid = p["id"]
    assert p["data"]["count"] == 150
    assert {c["name"]: c["count"] for c in p["data"]["classes"]} == {"círculo": 50, "cuadrado": 50, "triángulo": 50}
    listed = client.get(f"/api/ml/projects/{pid}/images").json()
    assert listed["total"] == 150 and listed["classes"][0]["images"][0]["thumb"].startswith("data:image/png;base64,")
    z = zipfile.ZipFile(io.BytesIO(client.get(f"/api/ml/projects/{pid}/images.zip").content))
    assert len(z.namelist()) == 150 and all(n.startswith("imagenes/") and n.endswith(".png") for n in z.namelist())
    labels, pixels = ex.shapes(2)
    img = base64.b64encode(pixels[0].tobytes()).decode()

    knn = entrenar(client, pid, mode="custom", algorithm="pixels_knn")
    assert knn["status"] == "done", knn.get("error")
    (pred,) = predecir(client, pid, knn["best"]["modelId"], images=[img], explain=True)
    assert pred["prediction"] in ("círculo", "cuadrado", "triángulo") and pred["neighbors"]
    script(client, pid, knn["best"]["modelId"])

    red = entrenar(client, pid, mode="custom", algorithm="cnn", params={"epochs": 3, "color": "gris"})
    assert red["status"] == "done", red.get("error")
    curves = [line["text"] for line in red["log"] if "vuelta" in line["text"]]
    assert len(curves) == 3 and re.search(r"vuelta 1: error \d+,\d{3}, acierta el \d+ %", curves[0])
    mid = red["best"]["modelId"]
    (pred,) = predecir(client, pid, mid, images=[img], explain=True)
    assert pred["inside"] and sum(pred["probabilities"].values()) == pytest.approx(1)
    learned = client.get(f"/api/ml/projects/{pid}/models/{mid}").json()["report"]["learned"]
    assert learned["layers"] and learned["example"]["thumb"].startswith("data:image/png")
    code = script(client, pid, mid)
    assert "transforms.Grayscale()" in code and max(len(line) for line in code.splitlines()) <= 120

    # errores de quien llama: imagen de otro tamaño, tabla en un proyecto de imágenes
    bad = base64.b64encode(b"\0" * 100).decode()
    assert client.post(f"/api/ml/projects/{pid}/models/{mid}/predict", json={"images": [bad]}).status_code == 400
    assert client.post(f"/api/ml/projects/{pid}/models/{mid}/batch", content=b"a,b\n1,2\n").status_code == 400
    assert client.post(f"/api/ml/projects/{pid}/data", content=b"a,b\n1,2\n3,4\n").status_code == 400


def test_cancelar_y_borrar(client):
    p = proyecto(client, "formas", "Formas lentas")
    pid = p["id"]
    r = client.post(f"/api/ml/projects/{pid}/jobs", json={"mode": "custom", "algorithm": "cnn", "params": {"epochs": 100}})
    jid = r.json()["id"]
    assert client.post(f"/api/ml/projects/{pid}/jobs", json={"mode": "auto"}).status_code == 409  # uno por proyecto
    assert client.delete(f"/api/ml/projects/{pid}").status_code == 409  # no se borra mientras entrena
    assert client.post(f"/api/ml/projects/{pid}/jobs/{jid}/cancel").json()["ok"] is True
    for _ in range(600):
        job = client.get(f"/api/ml/projects/{pid}/jobs/{jid}").json()
        if job["status"] not in ("queued", "running"):
            break
        time.sleep(0.05)
    assert job["status"] == "cancelled"
    assert client.delete(f"/api/ml/projects/{pid}/jobs/{jid}").json()["ok"]
    assert client.get(f"/api/ml/projects/{pid}/jobs").json() == []
    assert client.delete(f"/api/ml/projects/{pid}").json()["ok"]
    assert client.get(f"/api/ml/projects/{pid}").status_code == 404


def test_proyecto_vacio_y_tipos(client):
    p = client.post("/api/ml/projects", json={"name": "Mis datos", "kind": "table"}).json()
    pid = p["id"]
    assert client.post(f"/api/ml/projects/{pid}/jobs", json={"task": "clustering"}).status_code == 400  # sin datos
    csv = "nombre,edad,curso\n" + "\n".join(f"Alumno {i},{12 + i % 6},{1 + i % 4}" for i in range(40))
    prof = client.post(f"/api/ml/projects/{pid}/data?filename=clase.csv", content=csv.encode()).json()
    assert {c["name"]: c["kind"] for c in prof["columns"]}["curso"] == "number"
    # la persona sabe más: «curso» es una categoría
    p = client.patch(f"/api/ml/projects/{pid}", json={"types": {"curso": "category"}, "name": "Clase"}).json()
    assert p["name"] == "Clase" and {c["name"]: c["kind"] for c in p["profile"]["columns"]}["curso"] == "category"
    rows = client.get(f"/api/ml/projects/{pid}/rows?offset=2&limit=3").json()
    assert rows["total"] == 40 and rows["rows"][0] == ["Alumno 2", "14", "3"]
    assert client.get(f"/api/ml/projects/{pid}/data.csv").text.startswith("nombre,edad,curso\n")
    assert client.post(f"/api/ml/projects/{pid}/images", json={"label": "x", "images": ["AA=="]}).status_code == 400
    assert client.get("/api/ml/projects/no-existe").status_code == 404


def test_con_cuentas(tmp_path, monkeypatch):
    """Cada cuenta ve solo sus proyectos; la ruta pública lleva el espacio en la dirección («<espacio>.<proyecto>»)."""
    monkeypatch.delenv("AGENTE_ADMIN_TOKEN", raising=False)
    c = TestClient(create_app(tmp_path, accounts=True))
    h = {"X-Space-Key": c.post("/api/accounts", json={"user": "lucia", "password": CLAVE}).json()["spaceKey"]}
    otro = {"X-Space-Key": c.post("/api/accounts", json={"user": "marcos", "password": CLAVE}).json()["spaceKey"]}
    p = proyecto(c, "pinguinos", "Pingüinos", headers=h)
    assert p["publicId"].endswith(".pinguinos") and p["publicId"] != "pinguinos"
    assert c.get(f"/api/ml/projects/{p['id']}").status_code == 401
    assert c.get(f"/api/ml/projects/{p['id']}", headers=otro).status_code == 404
    assert c.get("/api/ml/projects", headers=otro).json() == []
    job = entrenar(c, p["id"], headers=h, task="classification", target="especie", mode="custom", algorithm="logistic", folds=0)
    c.post(f"/api/ml/projects/{p['id']}/publish", json={"modelId": job["best"]["modelId"]}, headers=h)
    r = c.post(f"/api/ml/{p['publicId']}/predict", json={"rows": [FILA]})  # desde cualquier web, sin llave
    assert r.status_code == 200 and r.json()["predictions"][0]["prediction"] == "Papúa"
    assert c.post("/api/ml/otro-espacio.pinguinos/predict", json={"rows": [FILA]}).status_code == 404

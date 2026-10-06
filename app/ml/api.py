"""Rutas /api/ml/… de la API: proyectos, datos, imágenes, entrenamientos, modelos y predicciones.

Los entrenamientos van en segundo plano (como mucho dos a la vez en el servidor y uno por proyecto): la
consola pregunta cada medio segundo cómo va y enseña los pasos y el registro. Un modelo se puede publicar:
entonces responde en POST /api/ml/<dirección>/predict, que se puede llamar desde cualquier web o
aplicación (como los puntos de conexión de Azure), con la clave de API del proyecto si la tiene.
"""

from __future__ import annotations

import base64
import io
import secrets
import threading
import time
import traceback
import zipfile
from collections import OrderedDict
from concurrent.futures import ThreadPoolExecutor
from typing import Any, Callable

import numpy as np
from fastapi import Body, FastAPI, HTTPException, Query, Request
from fastapi.responses import PlainTextResponse, Response
from pydantic import BaseModel, Field

from . import algorithms as alg
from . import examples as ex
from .cnn import AUTO_IMAGES, ImageBundle, image_catalog, run_images
from .codegen import images_script, table_script
from .metrics import METRICS
from .png import encode as png_encode
from .runner import AUTO, Bundle, Cancelled, JobError, Progress, run_table
from .store import MAX_CLASSES, MAX_IMAGES, MAX_PROJECTS, SIZE, Limit, MLStore, NotFound
from .table import MAX_BYTES, MAX_CELLS, MAX_COLUMNS, MAX_ROWS, TableError

TAGS = [
    {"name": "ml · proyectos", "description": "Machine learning: un proyecto tiene unos datos (una tabla o imágenes), sus "
                                              "entrenamientos y sus modelos."},
    {"name": "ml · datos", "description": "Subir la tabla (CSV) o las imágenes de cada clase, verlas y elegir el tipo de cada columna."},
    {"name": "ml · entrenamiento", "description": "Lanzar un entrenamiento (automático o personalizado) y seguirlo paso a paso."},
    {"name": "ml · modelos", "description": "Los modelos entrenados: cómo han salido, qué han aprendido, su script y predicciones."},
    {"name": "ml · predicción", "description": "El modelo publicado de un proyecto, desde tu web o tu aplicación (como un punto de "
                                              "conexión de Azure). Si el proyecto tiene clave de API, envíala en X-Api-Key."},
]
TASK_NAMES = {"classification": "clasificación", "regression": "regresión", "clustering": "agrupación", "images": "imágenes"}


class CreateProject(BaseModel):
    name: str = Field(..., min_length=1, max_length=80, description="Nombre del proyecto")
    kind: str = Field("table", description="table (datos en tabla, CSV) o images (imágenes por clases)")
    description: str = Field("", max_length=300)
    example: str | None = Field(None, description="Empezar con los datos de un ejemplo: pinguinos, bicis o formas")
    model_config = {"json_schema_extra": {"examples": [{"name": "Pingüinos", "kind": "table", "example": "pinguinos"}]}}


class JobConfig(BaseModel):
    task: str | None = Field(None, description="classification, regression o clustering (en imágenes no hace falta)")
    target: str | None = Field(None, description="La columna que se predice (no en agrupación)")
    features: list[str] | None = Field(None, description="Las columnas con las que aprender (por defecto, todas las útiles)")
    mode: str = Field("auto", description="auto (prueba varios algoritmos y elige) o custom (el que elijas)")
    algorithm: str | None = Field(None, description="En modo custom: tree, forest, knn, logistic, linear, bayes, kmeans, cnn…")
    params: dict[str, Any] | None = Field(None, description="Ajustes del algoritmo (ver /api/ml/info)")
    metric: str | None = Field(None, description="Métrica para comparar: accuracy, balanced_accuracy, f1_macro, r2, rmse, mae")
    testSize: float = Field(0.2, ge=0.1, le=0.5, description="Parte de las filas que se esconde para el examen final")
    folds: int = Field(5, ge=0, le=10, description="Rondas de la validación cruzada (0 = sin validación cruzada)")
    seed: int = Field(42, description="Semilla: con la misma, el entrenamiento sale siempre igual")
    compare: str | None = Field(None, description="En agrupación: columna con la que comparar los grupos (no se usa para aprender)")
    model_config = {"json_schema_extra": {"examples": [{"task": "classification", "target": "especie", "mode": "auto"}]}}


class PredictRequest(BaseModel):
    rows: list[dict[str, Any]] | None = Field(None, description="Filas con el valor de cada columna (proyectos de tabla)")
    images: list[str] | None = Field(None, description=f"Imágenes de {SIZE} × {SIZE} en color: los píxeles RGB en base64 "
                                                        f"({SIZE * SIZE * 3} bytes cada una)")
    explain: bool = Field(False, description="Incluir la explicación de cada predicción")
    model_config = {"json_schema_extra": {"examples": [{"rows": [{"isla": "Biscoe", "pico_largo_mm": 47.5, "pico_alto_mm": 15,
                                                                  "aleta_mm": 217, "peso_g": 5200, "sexo": "macho"}]}]}}


class ImagesRequest(BaseModel):
    label: str = Field(..., min_length=1, max_length=40, description="La clase de las imágenes")
    images: list[str] = Field(..., min_length=1, max_length=200, description=f"Píxeles RGB de {SIZE} × {SIZE} en base64")


class JobRunner:
    """Entrenamientos en segundo plano: como mucho `workers` a la vez en todo el servidor."""

    def __init__(self, workers: int = 2):
        self.pool = ThreadPoolExecutor(max_workers=workers, thread_name_prefix="ml")
        self.live: dict[str, dict] = {}
        self.lock = threading.Lock()

    def running_in(self, store: MLStore, pid: str) -> str | None:
        with self.lock:
            for jid, j in self.live.items():
                if j["store"] is store and j["pid"] == pid:
                    return jid
        return None

    def start(self, store: MLStore, pid: str, config: dict) -> dict:
        project = store.get(pid)
        if self.running_in(store, pid):
            raise HTTPException(409, "Ya hay un entrenamiento en marcha en este proyecto: espera a que termine o cancélalo.")
        jid = "j" + secrets.token_hex(5)
        task = "images" if project["kind"] == "images" else config.get("task")
        mode_name = "Automático" if config.get("mode", "auto") == "auto" else (
            alg.ALGORITHMS[config["algorithm"]].name if config.get("algorithm") in alg.ALGORITHMS else
            next((a["name"] for a in image_catalog() if a["key"] == config.get("algorithm")), "Personalizado"))
        name = f"{mode_name} · {TASK_NAMES.get(task, task or '')}" + (f" de «{config['target']}»" if config.get("target") and task != "clustering" else "")
        job = {"id": jid, "projectId": pid, "name": name, "status": "queued", "createdAt": time.time(), "config": config,
               "task": task, "steps": [], "log": [], "fraction": 0.0}
        store.save_job(pid, job)
        progress = Progress()
        with self.lock:
            self.live[jid] = {"store": store, "pid": pid, "progress": progress, "status": "queued"}
        self.pool.submit(self._run, store, pid, jid, config, progress)
        return job

    def _run(self, store: MLStore, pid: str, jid: str, config: dict, progress: Progress) -> None:
        job = store.get_job(pid, jid)
        with self.lock:
            if jid in self.live:
                self.live[jid]["status"] = "running"
        job.update(status="running", startedAt=time.time())
        store.save_job(pid, job)
        try:
            project = store.get(pid)
            if project["kind"] == "table":
                res = run_table(store.table(pid), config, progress)
            else:
                ids, labels, arr = store.load_images(pid)
                res = run_images(arr, labels, config, progress, ids=ids)
            mids = [store.save_model(pid, m["report"], m["state"], jid) for m in res["models"]]
            best_mid = mids[res["bestIndex"]]
            board = res["leaderboard"]
            if len(board) == len(mids):
                for row, mid in zip(board, mids):
                    row["modelId"] = mid
            else:  # agrupación: un modelo y varias k probadas
                for row in board:
                    row["modelId"] = best_mid if row["best"] else None
            best_report = res["models"][res["bestIndex"]]["report"]
            best = {"modelId": best_mid, "name": best_report["name"], "metric": res["metric"], "metricName": res["metricName"],
                    "value": best_report["metrics"].get(res["metric"])}
            job.update(status="done", leaderboard=board, models=mids, best=best, metricName=res["metricName"],
                       metric=res["metric"], rows=res["rows"], config=res["config"], task=res["task"])
            project = store.get(pid)
            project["best"] = dict(best, jobId=jid, at=time.time())
            store.save(project)
        except Cancelled:
            job.update(status="cancelled", error="Cancelado")
        except (JobError, TableError, NotFound, ValueError) as e:
            job.update(status="failed", error=str(e))
            progress.write(f"No se ha podido entrenar: {e}")
        except Exception as e:  # noqa: BLE001 - se cuenta en el registro en vez de perderlo
            traceback.print_exc()
            job.update(status="failed", error=f"Error inesperado: {e}")
            progress.write(f"Error inesperado: {e}")
        finally:
            snap = progress.snapshot()
            job.update(steps=snap["steps"], log=snap["log"], fraction=snap["fraction"], finishedAt=time.time())
            store.save_job(pid, job)
            with self.lock:
                self.live.pop(jid, None)

    def view(self, store: MLStore, pid: str, jid: str) -> dict:
        job = store.get_job(pid, jid)
        with self.lock:
            live = self.live.get(jid)
        if live:
            job.update(live["progress"].snapshot())
            job["status"] = live["status"]
        elif job["status"] in ("queued", "running"):
            job["status"] = "interrupted"
            job["error"] = "El servidor se reinició mientras entrenaba. Vuelve a lanzarlo."
        job["elapsed"] = time.time() - (job.get("startedAt") or job["createdAt"]) if job["status"] == "running" else None
        return job

    def cancel(self, jid: str) -> bool:
        with self.lock:
            live = self.live.get(jid)
        if not live:
            return False
        live["progress"].cancel.set()
        return True


def decode_images(items: list[str]) -> np.ndarray:
    out = []
    for s in items:
        try:
            raw = base64.b64decode(s.split(",", 1)[-1], validate=False)
        except (ValueError, TypeError):
            raise HTTPException(400, "Una de las imágenes no es base64 válido") from None
        if len(raw) != SIZE * SIZE * 3:
            raise HTTPException(400, f"Cada imagen tiene que tener {SIZE * SIZE * 3} bytes ({SIZE} × {SIZE} × 3, RGB)")
        out.append(np.frombuffer(raw, dtype=np.uint8).reshape(SIZE, SIZE, 3))
    return np.stack(out)


def register(app: FastAPI, *, admin: list, space_dep, resolve: Callable[[str, Request], tuple[Any, str]],
             is_admin: Callable[[Request], bool]) -> JobRunner:
    """Añade las rutas /api/ml/… a la aplicación. `space_dep` da el espacio de quien llama (con su
    MLStore en `.ml`); `resolve` convierte la dirección pública de un proyecto en (espacio, id)."""
    runner = JobRunner()
    bundles: OrderedDict[tuple, Any] = OrderedDict()
    bundles_lock = threading.Lock()

    def store_of(sp) -> MLStore:
        return sp.ml

    def wrap(fn):
        try:
            return fn()
        except NotFound as e:
            raise HTTPException(404, str(e)) from None
        except Limit as e:
            raise HTTPException(409, str(e)) from None
        except (TableError, JobError, ValueError) as e:
            raise HTTPException(400, str(e)) from None

    def bundle(store: MLStore, pid: str, mid: str):
        d = store.root / pid / "models" / f"{mid}.json"
        key = (str(d), d.stat().st_mtime_ns if d.exists() else 0)
        with bundles_lock:
            b = bundles.get(key)
            if b is not None:
                bundles.move_to_end(key)
                return b
        m = wrap(lambda: store.get_model(pid, mid))
        b = ImageBundle(m["state"], m["report"]) if m["report"]["task"] == "images" else Bundle(m["state"], m["report"])
        with bundles_lock:
            bundles[key] = b
            while len(bundles) > 24:
                bundles.popitem(last=False)
        return b

    def project_view(sp, pid: str) -> dict:
        store = store_of(sp)
        p = wrap(lambda: store.get(pid))
        p = dict(p)
        p["apiKey"] = p.get("apiKey") or ""
        p["publicId"] = sp.ref(pid)  # la dirección de sus rutas públicas («<espacio>.<proyecto>» con cuentas)
        if p["kind"] == "table":
            p["profile"] = store.profile(pid)
        p["jobs"] = store.list_jobs(pid)
        p["models"] = store.list_models(pid)
        live = runner.running_in(store, pid)
        p["running"] = live
        return p

    def predict(store: MLStore, pid: str, mid: str, req: PredictRequest) -> dict:
        b = bundle(store, pid, mid)
        if isinstance(b, ImageBundle):
            if not req.images:
                raise HTTPException(400, "Envía las imágenes en «images»")
            if len(req.images) > 50:
                raise HTTPException(400, "Como mucho 50 imágenes por petición")
            arr = decode_images(req.images)
            return {"modelId": mid, "model": b.report["name"], "predictions": b.predict(arr, explain=req.explain)}
        if not req.rows:
            raise HTTPException(400, "Envía las filas en «rows»: [{\"columna\": valor, …}]")
        if len(req.rows) > 1000:
            raise HTTPException(400, "Como mucho 1000 filas por petición")
        return {"modelId": mid, "model": b.report["name"], "target": b.report.get("target"),
                "predictions": wrap(lambda: b.predict(req.rows, explain=req.explain))}

    def schema_of(store: MLStore, pid: str, mid: str) -> dict:
        b = bundle(store, pid, mid)
        if isinstance(b, ImageBundle):
            return {"kind": "images", "classes": b.classes, "imageSize": SIZE, "model": b.report["name"]}
        cols = []
        for spec in b.prep.specs:
            item = {"name": spec["name"], "kind": spec["kind"]}
            if spec["kind"] == "category":
                item["values"] = [c for c in spec["categories"] if not c.startswith("(")]
            elif spec["kind"] == "number":
                item["example"] = spec["fill"]
            cols.append(item)
        return {"kind": "table", "task": b.report["task"], "target": b.report.get("target"),
                "classes": b.report.get("classes") or [], "columns": cols, "model": b.report["name"]}

    # ------------------------------------------------------------------ info
    @app.get("/api/ml/info", tags=["ml · proyectos"], dependencies=admin, summary="Algoritmos, métricas y ejemplos")
    def ml_info():
        """Lo que necesita el formulario de entrenar: los algoritmos de cada tarea con sus ajustes (y qué hace cada
        uno), los candidatos del modo automático, las métricas, los proyectos de ejemplo y los límites."""
        return {
            "algorithms": {t: alg.catalog(t) for t in ("classification", "regression", "clustering")} | {"images": image_catalog()},
            "auto": {t: [{"algorithm": k, "params": p} for k, p in c] for t, c in AUTO.items()}
            | {"images": [{"algorithm": k, "params": p} for k, p in AUTO_IMAGES]},
            "metrics": {t: [{"key": k, "name": n, "higherIsBetter": hib} for k, n, hib in items] for t, items in METRICS.items()},
            "examples": ex.public(),
            "limits": {"bytes": MAX_BYTES, "rows": MAX_ROWS, "columns": MAX_COLUMNS, "cells": MAX_CELLS,
                       "projects": MAX_PROJECTS, "images": MAX_IMAGES, "classes": MAX_CLASSES, "imageSize": SIZE},
        }

    # ------------------------------------------------------------- proyectos
    @app.get("/api/ml/projects", tags=["ml · proyectos"], dependencies=admin, summary="Listar proyectos")
    def list_projects(sp=space_dep):
        """Resumen de cada proyecto: tipo, datos, mejor modelo y modelo publicado."""
        return store_of(sp).list_projects()

    @app.post("/api/ml/projects", tags=["ml · proyectos"], dependencies=admin, status_code=201, summary="Crear un proyecto")
    def create_project(req: CreateProject, sp=space_dep):
        """Un proyecto vacío (`kind`: table o images) o con los datos de un ejemplo (`example`)."""
        if req.example:
            info = ex.get(req.example)
            if not info:
                raise HTTPException(404, "No existe ese ejemplo")
            kind = info["kind"]
        else:
            kind = req.kind
        p = wrap(lambda: store_of(sp).create(req.name, kind, req.description, req.example))
        return project_view(sp, p["id"])

    @app.get("/api/ml/projects/{pid}", tags=["ml · proyectos"], dependencies=admin, summary="Leer un proyecto")
    def read_project(pid: str, sp=space_dep):
        """El proyecto con el perfil de cada columna (tabla), sus entrenamientos y sus modelos."""
        return project_view(sp, pid)

    @app.patch("/api/ml/projects/{pid}", tags=["ml · proyectos"], dependencies=admin, summary="Cambiar nombre, tipos o clave")
    def update_project(pid: str, changes: dict = Body(..., examples=[{"name": "Pingüinos de la Antártida",
                                                                     "types": {"año": "category"}}]), sp=space_dep):
        """`name`, `description`, `types` (el tipo de alguna columna: number, category, date o text) y `apiKey`
        (`"new"` crea una clave nueva, `""` la quita)."""
        store = store_of(sp)
        p = wrap(lambda: store.get(pid))
        if "name" in changes and str(changes["name"]).strip():
            p["name"] = str(changes["name"]).strip()[:80]
        if "description" in changes:
            p["description"] = str(changes["description"] or "").strip()[:300]
        if "apiKey" in changes:
            p["apiKey"] = secrets.token_urlsafe(18) if changes["apiKey"] == "new" else ""
        store.save(p)
        if isinstance(changes.get("types"), dict):
            wrap(lambda: store.set_types(pid, changes["types"]))
        return project_view(sp, pid)

    @app.delete("/api/ml/projects/{pid}", tags=["ml · proyectos"], dependencies=admin, summary="Borrar un proyecto")
    def delete_project(pid: str, sp=space_dep):
        """Borra el proyecto con sus datos, entrenamientos y modelos."""
        store = store_of(sp)
        if runner.running_in(store, pid):
            raise HTTPException(409, "Hay un entrenamiento en marcha: cancélalo antes de borrar el proyecto.")
        wrap(lambda: store.delete(pid))
        return {"ok": True}

    # ----------------------------------------------------------------- datos
    @app.post("/api/ml/projects/{pid}/data", tags=["ml · datos"], dependencies=admin, summary="Subir la tabla (CSV)")
    async def upload_data(pid: str, request: Request, filename: str = Query("", description="Nombre del fichero"), sp=space_dep):
        """El cuerpo de la petición es el CSV tal cual (separado por comas, punto y coma o tabuladores; UTF-8 o
        el formato de Excel). Sustituye la tabla anterior y devuelve el perfil de cada columna."""
        raw = await request.body()
        if len(raw) > MAX_BYTES:
            raise HTTPException(413, f"El fichero ocupa más de {MAX_BYTES // (1024 * 1024)} MB")
        store = store_of(sp)
        p = wrap(lambda: store.get(pid))
        if p["kind"] != "table":
            raise HTTPException(400, "Este proyecto es de imágenes")
        return wrap(lambda: store.set_table(pid, raw, filename))

    @app.get("/api/ml/projects/{pid}/rows", tags=["ml · datos"], dependencies=admin, summary="Ver filas de la tabla")
    def rows(pid: str, offset: int = Query(0, ge=0), limit: int = Query(50, ge=1, le=500), sp=space_dep):
        """Un trozo de la tabla tal como se guardó, para la vista previa."""
        t = wrap(lambda: store_of(sp).table(pid))
        return {"columns": t.names, "kinds": [c.kind for c in t.columns], "total": t.n_rows, "offset": offset,
                "rows": t.rows(offset, offset + limit)}

    @app.get("/api/ml/projects/{pid}/data.csv", tags=["ml · datos"], dependencies=admin, summary="Descargar la tabla")
    def download_csv(pid: str, sp=space_dep):
        """La tabla en CSV (comas, punto decimal y fechas AAAA-MM-DD)."""
        text = wrap(lambda: store_of(sp).csv_text(pid))
        return PlainTextResponse(text, media_type="text/csv; charset=utf-8",
                                 headers={"Content-Disposition": f'attachment; filename="{pid}.csv"'})

    @app.get("/api/ml/projects/{pid}/images", tags=["ml · datos"], dependencies=admin, summary="Ver las imágenes")
    def list_images(pid: str, sp=space_dep):
        """Las clases con sus imágenes (miniaturas PNG en data: URL)."""
        store = store_of(sp)
        index = wrap(lambda: store.image_index(pid))
        classes: dict[str, list] = {}
        for it in index:
            classes.setdefault(it["label"], []).append({"id": it["id"], "thumb": store.thumb(pid, it["id"])})
        return {"classes": [{"name": k, "count": len(v), "images": v} for k, v in classes.items()], "total": len(index)}

    @app.post("/api/ml/projects/{pid}/images", tags=["ml · datos"], dependencies=admin, status_code=201,
              summary="Añadir imágenes a una clase")
    def add_images(pid: str, req: ImagesRequest, sp=space_dep):
        """Imágenes ya reducidas a 64 × 64 (la consola las recorta y reduce en el navegador)."""
        store = store_of(sp)
        p = wrap(lambda: store.get(pid))
        if p["kind"] != "images":
            raise HTTPException(400, "Este proyecto es de tabla")
        arr = decode_images(req.images)
        added = wrap(lambda: store.add_images(pid, req.label, arr))
        return {"added": [{"id": a["id"], "thumb": store.thumb(pid, a["id"])} for a in added], "label": req.label.strip()}

    @app.delete("/api/ml/projects/{pid}/images/{iid}", tags=["ml · datos"], dependencies=admin, summary="Borrar una imagen")
    def delete_image(pid: str, iid: str, sp=space_dep):
        wrap(lambda: store_of(sp).delete_image(pid, iid))
        return {"ok": True}

    @app.patch("/api/ml/projects/{pid}/classes/{label}", tags=["ml · datos"], dependencies=admin, summary="Renombrar una clase")
    def rename_class(pid: str, label: str, body: dict = Body(..., examples=[{"name": "gato"}]), sp=space_dep):
        wrap(lambda: store_of(sp).rename_class(pid, label, body.get("name", "")))
        return {"ok": True}

    @app.delete("/api/ml/projects/{pid}/classes/{label}", tags=["ml · datos"], dependencies=admin,
                summary="Borrar una clase con sus imágenes")
    def delete_class(pid: str, label: str, sp=space_dep):
        wrap(lambda: store_of(sp).delete_class(pid, label))
        return {"ok": True}

    @app.get("/api/ml/projects/{pid}/images.zip", tags=["ml · datos"], dependencies=admin, summary="Descargar las imágenes")
    def images_zip(pid: str, sp=space_dep):
        """Un ZIP con una carpeta por clase y las imágenes en PNG (lo que espera el script de PyTorch)."""
        store = store_of(sp)
        index = wrap(lambda: store.image_index(pid))
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
            for it in index:
                z.writestr(f"imagenes/{it['label']}/{it['id']}.png", png_encode(store.pixels(pid, it["id"])))
        return Response(buf.getvalue(), media_type="application/zip",
                        headers={"Content-Disposition": f'attachment; filename="{pid}-imagenes.zip"'})

    # -------------------------------------------------------- entrenamientos
    @app.post("/api/ml/projects/{pid}/jobs", tags=["ml · entrenamiento"], dependencies=admin, status_code=202,
              summary="Entrenar")
    def start_job(pid: str, cfg: JobConfig, sp=space_dep):
        """Lanza un entrenamiento en segundo plano y devuelve su id. Consulta cómo va con GET …/jobs/{id}."""
        store = store_of(sp)
        p = wrap(lambda: store.get(pid))
        if p["kind"] == "table" and not p.get("data"):
            raise HTTPException(400, "Sube antes los datos del proyecto")
        if p["kind"] == "images" and not (p.get("data") or {}).get("count"):
            raise HTTPException(400, "Añade antes imágenes de al menos dos clases")
        return runner.start(store, pid, cfg.model_dump())

    @app.get("/api/ml/projects/{pid}/jobs", tags=["ml · entrenamiento"], dependencies=admin, summary="Listar entrenamientos")
    def list_jobs(pid: str, sp=space_dep):
        return wrap(lambda: store_of(sp).list_jobs(pid))

    @app.get("/api/ml/projects/{pid}/jobs/{jid}", tags=["ml · entrenamiento"], dependencies=admin, summary="Cómo va un entrenamiento")
    def read_job(pid: str, jid: str, sp=space_dep):
        """Estado (queued, running, done, failed, cancelled), pasos, registro, avance (0 a 1) y, al terminar, la
        tabla de algoritmos probados con su nota (`leaderboard`) y el mejor (`best`)."""
        return wrap(lambda: runner.view(store_of(sp), pid, jid))

    @app.post("/api/ml/projects/{pid}/jobs/{jid}/cancel", tags=["ml · entrenamiento"], dependencies=admin,
              summary="Cancelar un entrenamiento")
    def cancel_job(pid: str, jid: str, sp=space_dep):
        wrap(lambda: store_of(sp).get_job(pid, jid))
        return {"ok": runner.cancel(jid)}

    @app.delete("/api/ml/projects/{pid}/jobs/{jid}", tags=["ml · entrenamiento"], dependencies=admin,
                summary="Borrar un entrenamiento y sus modelos")
    def delete_job(pid: str, jid: str, sp=space_dep):
        if runner.cancel(jid):
            raise HTTPException(409, "Está en marcha: se ha pedido que se cancele. Bórralo cuando termine.")
        wrap(lambda: store_of(sp).delete_job(pid, jid))
        return {"ok": True}

    # ---------------------------------------------------------------- modelos
    @app.get("/api/ml/projects/{pid}/models", tags=["ml · modelos"], dependencies=admin, summary="Listar modelos")
    def list_models(pid: str, sp=space_dep):
        return wrap(lambda: store_of(sp).list_models(pid))

    @app.get("/api/ml/projects/{pid}/models/{mid}", tags=["ml · modelos"], dependencies=admin, summary="Leer un modelo")
    def read_model(pid: str, mid: str, sp=space_dep):
        """El informe del modelo: métricas (en el examen y con sus propias filas), validación cruzada, gráficos,
        importancia de las columnas, cómo se prepararon los datos y lo que ha aprendido."""
        store = store_of(sp)
        m = wrap(lambda: store.get_model(pid, mid, with_state=False))
        m["schema"] = schema_of(store, pid, mid)
        try:
            m["job"] = {k: v for k, v in store.get_job(pid, m["jobId"]).items() if k in ("id", "name", "config", "createdAt")}
        except NotFound:
            m["job"] = None
        return m

    @app.delete("/api/ml/projects/{pid}/models/{mid}", tags=["ml · modelos"], dependencies=admin, summary="Borrar un modelo")
    def delete_model(pid: str, mid: str, sp=space_dep):
        wrap(lambda: store_of(sp).delete_model(pid, mid))
        return {"ok": True}

    @app.post("/api/ml/projects/{pid}/models/{mid}/predict", tags=["ml · modelos"], dependencies=admin,
              summary="Predecir con un modelo")
    def predict_model(pid: str, mid: str, req: PredictRequest, sp=space_dep):
        """Predicciones de cualquier modelo del proyecto (publicado o no), con su explicación si `explain`."""
        return predict(store_of(sp), pid, mid, req)

    @app.get("/api/ml/projects/{pid}/models/{mid}/code", tags=["ml · modelos"], dependencies=admin,
             summary="Script equivalente en Python")
    def model_code(pid: str, mid: str, sp=space_dep):
        """El script que hace lo mismo con scikit-learn (tablas) o PyTorch (imágenes): para verlo como código o
        llevarlo a Azure ML como «script de entrenamiento personalizado»."""
        store = store_of(sp)
        m = wrap(lambda: store.get_model(pid, mid, with_state=False))
        try:
            config = store.get_job(pid, m["jobId"]).get("config") or {}
        except NotFound:
            config = {}
        r = m["report"]
        text = images_script(r, config) if r["task"] == "images" else table_script(r, config, f"{pid}.csv")
        return PlainTextResponse(text, media_type="text/x-python; charset=utf-8")

    @app.post("/api/ml/projects/{pid}/publish", tags=["ml · modelos"], dependencies=admin, summary="Publicar un modelo")
    def publish(pid: str, body: dict = Body(..., examples=[{"modelId": "m3f9a1c0b7d"}]), sp=space_dep):
        """El modelo que responde en la dirección pública del proyecto (POST /api/ml/<dirección>/predict). `modelId`
        vacío o `null` deja de publicar."""
        store = store_of(sp)
        p = wrap(lambda: store.get(pid))
        mid = body.get("modelId")
        if mid:
            m = wrap(lambda: store.get_model(pid, mid, with_state=False))
            p["published"] = {"modelId": mid, "name": m["report"]["name"], "at": time.time()}
        else:
            p["published"] = None
        store.save(p)
        return project_view(sp, pid)

    # ------------------------------------------------------------- pública
    def published_model(ref: str, request: Request) -> tuple[MLStore, str, str]:
        sp, pid = resolve(ref, request)
        store = store_of(sp)
        p = wrap(lambda: store.get(pid))
        key = p.get("apiKey") or ""
        if key and not is_admin(request):
            given = request.headers.get("x-api-key") or request.query_params.get("key", "")
            if not secrets.compare_digest(given, key):
                raise HTTPException(401, "Clave de API incorrecta")
        mid = (p.get("published") or {}).get("modelId")
        if not mid:
            raise HTTPException(409, "Este proyecto no tiene ningún modelo publicado")
        return store, pid, mid

    @app.post("/api/ml/{ref}/predict", tags=["ml · predicción"], summary="Predecir con el modelo publicado")
    def public_predict(ref: str, req: PredictRequest, request: Request):
        """Lo que llama tu web o tu aplicación. `ref` es la dirección pública del proyecto (en un servidor con
        cuentas, «<espacio>.<proyecto>»: está en la página API del proyecto). Si el proyecto tiene clave de API,
        envíala en la cabecera `X-Api-Key`."""
        store, pid, mid = published_model(ref, request)
        return predict(store, pid, mid, req)

    @app.get("/api/ml/{ref}/schema", tags=["ml · predicción"], summary="Qué espera el modelo publicado")
    def public_schema(ref: str, request: Request):
        """Las columnas que hay que enviar (con su tipo y, en las categorías, sus valores) o el tamaño de las imágenes."""
        store, pid, mid = published_model(ref, request)
        return schema_of(store, pid, mid)

    return runner

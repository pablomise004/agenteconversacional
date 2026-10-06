"""Proyectos de machine learning guardados en la carpeta de cada espacio (data/ml/ o data/spaces/<id>/ml/).

    ml/<proyecto>/project.json       nombre, tipo (tabla o imágenes), tipos de columna elegidos, modelo publicado…
    ml/<proyecto>/data.csv           la tabla, normalizada (comas, punto decimal, fechas AAAA-MM-DD)
    ml/<proyecto>/profile.json       el perfil de cada columna (lo que enseña la página Datos)
    ml/<proyecto>/images/index.json  las imágenes: id y clase de cada una
    ml/<proyecto>/images/<id>.rgb    los píxeles, 64 × 64 × 3 bytes
    ml/<proyecto>/jobs/<id>.json     cada entrenamiento: configuración, pasos, registro y resultados
    ml/<proyecto>/models/<id>.json   cada modelo: su informe y lo aprendido (los arrays, en <id>.npz)
"""

from __future__ import annotations

import io
import json
import os
import re
import secrets
import shutil
import threading
import time
from collections import OrderedDict
from pathlib import Path

import numpy as np

from ..agents import slugify
from . import examples as ex
from .png import data_url
from .table import Table, TableError, convert, describe, read_csv

SIZE = 64
MAX_PROJECTS = 30
MAX_IMAGES = 1500
MAX_CLASSES = 20
_ID = re.compile(r"^[a-z0-9][a-z0-9_-]{0,63}$")


class NotFound(Exception):
    pass


class Limit(Exception):
    pass


def _write_json(path: Path, data) -> None:
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    os.replace(tmp, path)


def _read_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def split_arrays(obj, arrays: dict, prefix: str = "a"):
    """Saca los arrays de numpy de un estado (dict anidado) para guardarlos en un .npz; deja su nombre."""
    if isinstance(obj, np.ndarray):
        key = f"{prefix}{len(arrays)}"
        arrays[key] = obj
        return {"__array__": key}
    if isinstance(obj, dict):
        return {k: split_arrays(v, arrays, prefix) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [split_arrays(v, arrays, prefix) for v in obj]
    if isinstance(obj, np.generic):
        return obj.item()
    return obj


def join_arrays(obj, arrays):
    if isinstance(obj, dict):
        if set(obj) == {"__array__"}:
            return arrays[obj["__array__"]]
        return {k: join_arrays(v, arrays) for k, v in obj.items()}
    if isinstance(obj, list):
        return [join_arrays(v, arrays) for v in obj]
    return obj


class MLStore:
    """Los proyectos de un espacio."""

    def __init__(self, space_dir: Path):
        self.root = Path(space_dir) / "ml"
        self._lock = threading.RLock()
        self._tables: OrderedDict[tuple, Table] = OrderedDict()

    # ------------------------------------------------------------ proyectos
    def _dir(self, pid: str) -> Path:
        if not _ID.match(pid or ""):
            raise NotFound("No existe ese proyecto")
        d = self.root / pid
        if not (d / "project.json").exists():
            raise NotFound("No existe ese proyecto")
        return d

    def list_projects(self) -> list[dict]:
        if not self.root.exists():
            return []
        out = []
        for d in self.root.iterdir():
            f = d / "project.json"
            if f.exists():
                try:
                    out.append(self.summary(_read_json(f)))
                except (OSError, ValueError):
                    continue
        return sorted(out, key=lambda p: -p.get("updatedAt", 0))

    @staticmethod
    def summary(p: dict) -> dict:
        keys = ("id", "name", "description", "kind", "example", "createdAt", "updatedAt", "published", "data", "best")
        return {k: p.get(k) for k in keys}

    def get(self, pid: str) -> dict:
        return _read_json(self._dir(pid) / "project.json")

    def save(self, project: dict) -> dict:
        project["updatedAt"] = time.time()
        _write_json(self.root / project["id"] / "project.json", project)
        return project

    def create(self, name: str, kind: str, description: str = "", example: str | None = None) -> dict:
        if kind not in ("table", "images"):
            raise ValueError("El tipo de proyecto tiene que ser «table» o «images»")
        with self._lock:
            if len(self.list_projects()) >= MAX_PROJECTS:
                raise Limit(f"Ya tienes {MAX_PROJECTS} proyectos: borra alguno para crear otro.")
            self.root.mkdir(parents=True, exist_ok=True)
            base = slugify(name)
            pid, n = base, 2
            while (self.root / pid).exists():
                pid = f"{base}-{n}"
                n += 1
            (self.root / pid / "jobs").mkdir(parents=True)
            (self.root / pid / "models").mkdir()
            now = time.time()
            project = {"id": pid, "name": name.strip()[:80] or "Proyecto", "description": description.strip()[:300],
                       "kind": kind, "example": example, "createdAt": now, "updatedAt": now, "types": {},
                       "published": None, "apiKey": "", "data": None, "best": None}
            self.save(project)
        if example:
            info = ex.get(example)
            if kind == "table":
                self.set_table(pid, ex.csv_bytes(example), f"{example}.csv")
            else:
                labels, pixels = ex.shapes(info["per_class"])
                for label in info["classes"]:
                    self.add_images(pid, label, pixels[[i for i, lbl in enumerate(labels) if lbl == label]], source="ejemplo")
            project = self.get(pid)
        return project

    def delete(self, pid: str) -> None:
        d = self._dir(pid)
        with self._lock:
            shutil.rmtree(d, ignore_errors=True)
            for key in [k for k in self._tables if k[0] == str(d)]:
                self._tables.pop(key, None)

    # --------------------------------------------------------------- tabla
    def set_table(self, pid: str, raw: bytes, filename: str = "") -> dict:
        d = self._dir(pid)
        table = read_csv(raw)
        if table.n_rows < 2:
            raise TableError("Hace falta al menos dos filas de datos.")
        (d / "data.csv").write_text(table.to_csv(), encoding="utf-8")
        project = self.get(pid)
        project["types"] = {}
        prof = describe(table)
        _write_json(d / "profile.json", prof)
        project["data"] = {"rows": table.n_rows, "columns": len(table.columns), "file": filename[:120],
                           "uploadedAt": time.time(), "delimiter": table.delimiter, "decimal": table.decimal}
        self.save(project)
        return prof

    def table(self, pid: str) -> Table:
        """La tabla del proyecto (en memoria mientras no cambie), con los tipos que haya elegido la persona."""
        d = self._dir(pid)
        f = d / "data.csv"
        if not f.exists():
            raise NotFound("Este proyecto todavía no tiene datos")
        project = self.get(pid)
        key = (str(d), f.stat().st_mtime_ns, json.dumps(project.get("types") or {}, sort_keys=True))
        with self._lock:
            t = self._tables.get(key)
            if t is not None:
                self._tables.move_to_end(key)
                return t
        t = read_csv(f.read_bytes())
        for name, kind in (project.get("types") or {}).items():
            try:
                convert(t.column(name), kind, t.decimal)
            except KeyError:
                continue
        with self._lock:
            self._tables[key] = t
            while len(self._tables) > 12:
                self._tables.popitem(last=False)
        return t

    def profile(self, pid: str) -> dict | None:
        f = self._dir(pid) / "profile.json"
        return _read_json(f) if f.exists() else None

    def set_types(self, pid: str, types: dict) -> dict:
        project = self.get(pid)
        t = self.table(pid)
        clean = {n: k for n, k in types.items() if n in t.names and k in ("number", "category", "date", "text")}
        project["types"] = {**(project.get("types") or {}), **clean}
        self.save(project)
        prof = describe(self.table(pid))
        _write_json(self._dir(pid) / "profile.json", prof)
        return prof

    def csv_text(self, pid: str) -> str:
        return (self._dir(pid) / "data.csv").read_text(encoding="utf-8")

    # ------------------------------------------------------------ imágenes
    def _images_dir(self, pid: str) -> Path:
        d = self._dir(pid) / "images"
        d.mkdir(exist_ok=True)
        return d

    def image_index(self, pid: str) -> list[dict]:
        f = self._images_dir(pid) / "index.json"
        return _read_json(f) if f.exists() else []

    def _save_index(self, pid: str, index: list[dict]) -> None:
        _write_json(self._images_dir(pid) / "index.json", index)
        project = self.get(pid)
        counts: dict[str, int] = {}
        for it in index:
            counts[it["label"]] = counts.get(it["label"], 0) + 1
        project["data"] = {"count": len(index), "classes": [{"name": k, "count": v} for k, v in counts.items()]}
        self.save(project)

    def add_images(self, pid: str, label: str, pixels: np.ndarray, source: str = "subida") -> list[dict]:
        label = re.sub(r"\s+", " ", str(label or "")).strip()[:40]
        if not label:
            raise ValueError("Pon un nombre a la clase")
        pixels = np.asarray(pixels, dtype=np.uint8)
        if pixels.ndim != 4 or pixels.shape[1:] != (SIZE, SIZE, 3):
            raise ValueError(f"Cada imagen tiene que llegar a {SIZE} × {SIZE} píxeles en color")
        with self._lock:
            index = self.image_index(pid)
            if len(index) + len(pixels) > MAX_IMAGES:
                raise Limit(f"Como mucho {MAX_IMAGES} imágenes por proyecto.")
            if label not in {i["label"] for i in index} and len({i["label"] for i in index}) >= MAX_CLASSES:
                raise Limit(f"Como mucho {MAX_CLASSES} clases por proyecto.")
            d = self._images_dir(pid)
            added = []
            for px in pixels:
                iid = "i" + secrets.token_hex(5)
                (d / f"{iid}.rgb").write_bytes(px.tobytes())
                item = {"id": iid, "label": label, "createdAt": time.time(), "source": source}
                index.append(item)
                added.append(item)
            self._save_index(pid, index)
        return added

    def delete_image(self, pid: str, iid: str) -> None:
        with self._lock:
            index = self.image_index(pid)
            index = [i for i in index if i["id"] != iid]
            try:
                (self._images_dir(pid) / f"{iid}.rgb").unlink()
            except FileNotFoundError:
                pass
            self._save_index(pid, index)

    def rename_class(self, pid: str, old: str, new: str) -> None:
        new = re.sub(r"\s+", " ", str(new or "")).strip()[:40]
        if not new:
            raise ValueError("Pon un nombre a la clase")
        with self._lock:
            index = self.image_index(pid)
            for i in index:
                if i["label"] == old:
                    i["label"] = new
            self._save_index(pid, index)

    def delete_class(self, pid: str, label: str) -> None:
        with self._lock:
            index = self.image_index(pid)
            d = self._images_dir(pid)
            for i in index:
                if i["label"] == label:
                    try:
                        (d / f"{i['id']}.rgb").unlink()
                    except FileNotFoundError:
                        pass
            self._save_index(pid, [i for i in index if i["label"] != label])

    def pixels(self, pid: str, iid: str) -> np.ndarray:
        raw = (self._images_dir(pid) / f"{iid}.rgb").read_bytes()
        return np.frombuffer(raw, dtype=np.uint8).reshape(SIZE, SIZE, 3)

    def load_images(self, pid: str) -> tuple[list[str], list[str], np.ndarray]:
        index = self.image_index(pid)
        arr = np.stack([self.pixels(pid, i["id"]) for i in index]) if index else np.zeros((0, SIZE, SIZE, 3), np.uint8)
        return [i["id"] for i in index], [i["label"] for i in index], arr

    def thumb(self, pid: str, iid: str) -> str:
        return data_url(self.pixels(pid, iid))

    # ------------------------------------------------------- entrenamientos
    def save_job(self, pid: str, job: dict) -> None:
        _write_json(self._dir(pid) / "jobs" / f"{job['id']}.json", job)

    def get_job(self, pid: str, jid: str) -> dict:
        f = self._dir(pid) / "jobs" / f"{jid}.json"
        if not _ID.match(jid or "") or not f.exists():
            raise NotFound("No existe ese entrenamiento")
        return _read_json(f)

    def list_jobs(self, pid: str) -> list[dict]:
        d = self._dir(pid) / "jobs"
        out = []
        for f in d.glob("*.json"):
            try:
                j = _read_json(f)
            except (OSError, ValueError):
                continue
            out.append({k: j.get(k) for k in ("id", "name", "status", "createdAt", "finishedAt", "config", "best", "error",
                                               "metricName", "task")})
        return sorted(out, key=lambda j: -(j.get("createdAt") or 0))

    def delete_job(self, pid: str, jid: str) -> None:
        job = self.get_job(pid, jid)
        for mid in job.get("models") or []:
            try:
                self.delete_model(pid, mid)
            except NotFound:
                pass
        (self._dir(pid) / "jobs" / f"{jid}.json").unlink()

    # ------------------------------------------------------------- modelos
    def save_model(self, pid: str, report: dict, state: dict, job_id: str) -> str:
        d = self._dir(pid) / "models"
        mid = "m" + secrets.token_hex(5)
        arrays: dict = {}
        light = split_arrays(state, arrays)
        if arrays:
            buf = io.BytesIO()
            np.savez_compressed(buf, **arrays)
            (d / f"{mid}.npz").write_bytes(buf.getvalue())
        report = split_arrays(report, {}, "r")  # el informe no lleva arrays, pero sí números de numpy sueltos
        _write_json(d / f"{mid}.json", {"id": mid, "jobId": job_id, "createdAt": time.time(), "report": report,
                                        "state": light})
        return mid

    def get_model(self, pid: str, mid: str, with_state: bool = True) -> dict:
        d = self._dir(pid) / "models"
        f = d / f"{mid}.json"
        if not _ID.match(mid or "") or not f.exists():
            raise NotFound("No existe ese modelo")
        data = _read_json(f)
        if with_state:
            npz = d / f"{mid}.npz"
            arrays = dict(np.load(npz, allow_pickle=False)) if npz.exists() else {}
            data["state"] = join_arrays(data["state"], arrays)
        else:
            data.pop("state", None)
        return data

    def list_models(self, pid: str) -> list[dict]:
        d = self._dir(pid) / "models"
        out = []
        for f in d.glob("*.json"):
            try:
                m = _read_json(f)
            except (OSError, ValueError):
                continue
            r = m["report"]
            out.append({"id": m["id"], "jobId": m["jobId"], "createdAt": m["createdAt"], "name": r["name"],
                        "algorithm": r["algorithm"], "task": r["task"], "metric": r["metric"],
                        "value": (r.get("metrics") or {}).get(r["metric"]), "cv": r.get("cv"), "best": r.get("best"),
                        "baseline": r.get("baseline"), "paramsText": r.get("paramsText"), "metrics": r.get("metrics"),
                        "target": r.get("target")})
        return sorted(out, key=lambda m: -m["createdAt"])

    def delete_model(self, pid: str, mid: str) -> None:
        d = self._dir(pid) / "models"
        if not _ID.match(mid or "") or not (d / f"{mid}.json").exists():
            raise NotFound("No existe ese modelo")
        for suffix in (".json", ".npz"):
            try:
                (d / f"{mid}{suffix}").unlink()
            except FileNotFoundError:
                pass
        project = self.get(pid)
        if (project.get("published") or {}).get("modelId") == mid:
            project["published"] = None
            self.save(project)

"""Un entrenamiento completo (lo que Azure llama «trabajo»), paso a paso y contando lo que hace.

1. Datos: las filas que se usan (las que tienen valor en la columna que se predice).
2. Separar: una parte para entrenar y otra, escondida, para el examen final (por defecto 80 / 20).
3. Preparar: rellenar vacíos, categorías → 0/1, fechas → números, escalar (prep.py), aprendido solo con
   las filas de entrenamiento.
4. Probar: cada algoritmo candidato con validación cruzada (k rondas: entrena con k−1 trozos y examina el
   que queda) y después con todo el entrenamiento contra el examen final.
5. Elegir: el de mejor nota media en la validación cruzada (o el que se haya pedido, en modo personalizado).
6. Explicar: métricas, matriz de confusión o puntos real/predicho, importancia de las columnas y lo que ha
   aprendido cada modelo.

En agrupación (sin columna que predecir) se prueban varios números de grupos con k-medias y se elige por
la silueta. Las imágenes van aparte (cnn.py), con la misma forma de informar.
"""

from __future__ import annotations

import threading
import time

import numpy as np

from . import algorithms as alg
from .metrics import (METRICS, classification_metrics, higher_is_better, metric_name, pca2, permutation_importance,
                      regression_metrics, roc_curve, score)
from .prep import Preparer, Target
from .table import CATEGORY, DATE, NUMBER, TEXT, Table, format_number

DEFAULT_METRIC = {"classification": "accuracy", "regression": "r2", "clustering": "silhouette", "images": "accuracy"}

# candidatos del modo automático: (algoritmo, ajustes)
AUTO = {
    "classification": [("baseline", {}), ("logistic", {}), ("tree", {"max_depth": 3}), ("tree", {"max_depth": 5}),
                       ("tree", {"max_depth": 8}), ("forest", {"n_trees": 50}), ("knn", {"k": 5}), ("knn", {"k": 11}),
                       ("bayes", {})],
    "regression": [("baseline", {}), ("linear", {}), ("tree", {"max_depth": 3}), ("tree", {"max_depth": 5}),
                   ("tree", {"max_depth": 8}), ("forest", {"n_trees": 50}), ("knn", {"k": 5}), ("knn", {"k": 11})],
}


class Cancelled(Exception):
    pass


class JobError(ValueError):
    """La configuración no vale para estos datos (con un mensaje para la persona)."""


class Progress:
    """Lo que ve la consola mientras entrena: los pasos, un registro y cuánto falta (0 a 1)."""

    def __init__(self, on_change=None):
        self.steps: list[dict] = []
        self.log: list[dict] = []
        self.fraction = 0.0
        self.cancel = threading.Event()
        self.on_change = on_change
        self.t0 = time.time()

    def _changed(self):
        if self.on_change:
            self.on_change(self)

    def check(self):
        if self.cancel.is_set():
            raise Cancelled()

    def step(self, key: str, title: str):
        self.check()
        for s in self.steps:
            if s["status"] == "running":
                s["status"] = "done"
        self.steps.append({"key": key, "title": title, "status": "running", "detail": "", "t": time.time() - self.t0})
        self._changed()

    def detail(self, text: str):
        if self.steps:
            self.steps[-1]["detail"] = text
        self._changed()

    def write(self, text: str):
        self.log.append({"t": round(time.time() - self.t0, 2), "text": text})
        self._changed()

    def advance(self, fraction: float):
        self.fraction = max(self.fraction, min(1.0, fraction))
        self._changed()

    def finish(self):
        for s in self.steps:
            if s["status"] == "running":
                s["status"] = "done"
        self.fraction = 1.0
        self._changed()

    def snapshot(self) -> dict:
        return {"steps": [dict(s) for s in self.steps], "log": list(self.log[-300:]), "fraction": self.fraction}


# ---------------------------------------------------------------- utilidades
def subset(table: Table, names: list[str], idx: np.ndarray) -> dict:
    """Columnas convertidas de unas filas: arrays para los números y listas para lo demás."""
    out = {}
    for n in names:
        col = table.column(n)
        out[n] = col.values[idx] if col.kind == NUMBER else [col.values[i] for i in idx]
    return out


def split_holdout(n: int, y: np.ndarray | None, test_size: float, rng) -> tuple[np.ndarray, np.ndarray]:
    """Separa entrenamiento y examen. En clasificación, por estratos: cada clase en la misma proporción."""
    if y is None:
        perm = rng.permutation(n)
        cut = int(round(n * (1 - test_size)))
        return np.sort(perm[:cut]), np.sort(perm[cut:])
    train, test = [], []
    for k in np.unique(y):
        idx = rng.permutation(np.nonzero(y == k)[0])
        n_test = int(round(len(idx) * test_size)) if len(idx) > 1 else 0
        n_test = min(n_test, len(idx) - 1)
        test.extend(idx[:n_test])
        train.extend(idx[n_test:])
    return np.sort(np.array(train, dtype=int)), np.sort(np.array(test, dtype=int))


def folds_of(n: int, y: np.ndarray | None, k: int, rng) -> np.ndarray:
    """A qué ronda de la validación cruzada va cada fila (por estratos en clasificación)."""
    fold = np.zeros(n, dtype=int)
    if y is None:
        fold[rng.permutation(n)] = np.arange(n) % k
        return fold
    for cls in np.unique(y):
        idx = rng.permutation(np.nonzero(y == cls)[0])
        offset = rng.integers(k)
        fold[idx] = (np.arange(len(idx)) + offset) % k
    return fold


def describe_params(key: str, params: dict) -> str:
    specs = {p["key"]: p for p in alg.ALGORITHMS[key].PARAMS}
    parts = []
    for k, v in params.items():
        spec = specs.get(k)
        if not spec:
            continue
        if spec["type"] == "choice":
            label = next((o["label"] for o in spec["options"] if o["value"] == v), v)
            parts.append(f"{spec['label'].lower()}: {str(label).lower()}")
        else:
            parts.append(f"{spec['label'].lower()} {format_number(v).replace('.', ',') if isinstance(v, (int, float)) else v}")
    return ", ".join(parts)


def centered_bins(values: np.ndarray, target: int = 12) -> np.ndarray:
    """Bordes para el histograma de los errores: barras de un ancho redondo (1, 2, 2,5 o 5 × 10ⁿ) centradas en
    números redondos, con una en el 0. Así el eje dice «−1000, 0, 1000» y no «−999,7, 18,18…»."""
    lo, hi = float(np.min(values)), float(np.max(values))
    raw = (hi - lo) / target if hi > lo else max(abs(hi), 1.0) / target
    mag = 10 ** np.floor(np.log10(raw))
    step = next(m * mag for m in (1, 2, 2.5, 5, 10) if m * mag >= raw)
    k0, k1 = int(np.floor(lo / step + 0.5)), int(np.floor(hi / step + 0.5))
    return (np.arange(k0, k1 + 2) - 0.5) * step


def duration(ms: int) -> str:
    """«96 ms» o, desde un segundo, «6,8 s»."""
    return f"{ms} ms" if ms < 1000 else f"{ms / 1000:.1f} s".replace(".", ",")


def candidate_name(key: str, params: dict) -> str:
    cls = alg.ALGORITHMS[key]
    short = {"tree": f"profundidad {params.get('max_depth')}" if "max_depth" in params else "",
             "forest": f"{params.get('n_trees')} árboles" if "n_trees" in params else "",
             "knn": f"k = {params.get('k')}" if "k" in params else ""}.get(key, "")
    return cls.name + (f" ({short})" if short else "")


# ------------------------------------------------------------ configuración
def check_config(table: Table, config: dict) -> dict:
    """Comprueba y completa la configuración de un entrenamiento de tabla."""
    task = config.get("task")
    if task not in ("classification", "regression", "clustering"):
        raise JobError("Elige qué quieres hacer: clasificar, predecir un número o agrupar.")
    names = set(table.names)
    target = config.get("target") or None
    if task != "clustering":
        if not target or target not in names:
            raise JobError("Elige la columna que quieres predecir.")
        kind = table.column(target).kind
        if task == "regression" and kind != NUMBER:
            raise JobError(f"Para predecir un número, «{target}» tiene que ser una columna de números.")
        if kind == TEXT and task == "classification":
            raise JobError(f"«{target}» es texto libre (casi todos sus valores son distintos): no se puede usar como clase.")
    else:
        target = None
    # al agrupar, la columna con la que se comparan los grupos tampoco se usa para aprender (sería chivarle la respuesta)
    compare = config.get("compare") if task == "clustering" and config.get("compare") in names else None
    features = [f for f in (config.get("features") or []) if f in names and f not in (target, compare)]
    if not features:
        features = [c.name for c in table.columns if c.name not in (target, compare) and c.kind != TEXT and not c.is_id]
    features = [f for f in features if table.column(f).kind in (NUMBER, CATEGORY, DATE)]
    if not features:
        raise JobError("No queda ninguna columna con la que aprender (las de texto libre no se pueden usar).")
    mode = config.get("mode", "auto")
    algorithm = config.get("algorithm")
    params = config.get("params") or {}
    if mode == "custom":
        if task == "clustering":
            algorithm = "kmeans"
        if algorithm not in alg.ALGORITHMS or task not in alg.ALGORITHMS[algorithm].tasks:
            raise JobError("Elige un algoritmo que sirva para esta tarea.")
        specs = {p["key"]: p for p in alg.ALGORITHMS[algorithm].param_specs(task)}
        clean = {}
        for k, v in params.items():
            spec = specs.get(k)
            if not spec:
                continue
            if spec["type"] == "choice":
                if v in [o["value"] for o in spec["options"]]:
                    clean[k] = v
            else:
                try:
                    v = float(v)
                except (TypeError, ValueError):
                    continue
                v = min(max(v, spec.get("min", v)), spec.get("max", v))
                clean[k] = int(round(v)) if spec["type"] == "int" else v
        params = clean
    elif mode != "auto":
        raise JobError("El modo tiene que ser automático o personalizado.")
    valid_metrics = [m for m, _, _ in METRICS[task]]
    metric = config.get("metric") if config.get("metric") in valid_metrics else DEFAULT_METRIC[task]
    test_size = float(config.get("testSize", 0.2) or 0.2)
    test_size = min(0.5, max(0.1, test_size))
    folds = int(config.get("folds", 5) or 0)
    folds = 0 if folds < 2 else min(10, folds)
    return {"task": task, "target": target, "features": features, "mode": mode, "algorithm": algorithm,
            "params": params, "metric": metric, "testSize": test_size, "folds": folds,
            "seed": int(config.get("seed", 42) or 42), "compare": compare}


def model_context(prep: Preparer, target: Target | None, train_rows=None) -> dict:
    return {"features": prep.feature_names, "columns": [g["column"] for g in prep.groups],
            "columnOf": prep.column_of_feature(), "scaleMask": prep.scale_mask.tolist(), "std": prep.std.tolist(),
            "classes": target.classes if target else [], "task": target.task if target else "clustering",
            "trainRows": train_rows}


# ------------------------------------------------------- tabla supervisada
def run_supervised(table: Table, cfg: dict, progress: Progress) -> dict:
    task, metric = cfg["task"], cfg["metric"]
    rng = np.random.default_rng(cfg["seed"])
    progress.step("data", "Leer los datos")
    tcol = table.column(cfg["target"])
    if tcol.kind == NUMBER:
        keep = np.nonzero(~np.isnan(tcol.values))[0]
    else:
        keep = np.array([i for i, v in enumerate(tcol.values) if v is not None], dtype=int)
    dropped = table.n_rows - len(keep)
    if len(keep) < 10:
        raise JobError("Hacen falta al menos 10 filas con valor en la columna que se predice.")
    target = Target.fit(cfg["target"], task, tcol.values[keep] if tcol.kind == NUMBER else [tcol.values[i] for i in keep])
    y_all = target.encode(tcol.values[keep] if tcol.kind == NUMBER else [tcol.values[i] for i in keep])
    if task == "classification" and len(target.classes) < 2:
        raise JobError("La columna que se predice solo tiene un valor: no hay nada que distinguir.")
    if task == "classification" and len(target.classes) > 50:
        raise JobError(f"«{cfg['target']}» tiene {len(target.classes)} valores distintos: demasiadas clases. ¿Quizá "
                       "querías predecir un número (regresión)?")
    progress.detail(f"{len(keep)} filas y {len(cfg['features'])} columnas para aprender"
                    + (f" ({dropped} filas sin valor en «{cfg['target']}» se quedan fuera)" if dropped else ""))
    progress.write(f"Tarea: {'clasificación' if task == 'classification' else 'regresión'} de «{cfg['target']}» "
                   f"con {len(cfg['features'])} columnas.")
    if task == "classification":
        counts = np.bincount(y_all, minlength=len(target.classes))
        progress.write("Clases: " + ", ".join(f"{c} ({n})" for c, n in zip(target.classes, counts)))

    progress.step("split", "Separar entrenamiento y examen")
    tr, te = split_holdout(len(keep), y_all if task == "classification" else None, cfg["testSize"], rng)
    train_rows, test_rows = keep[tr], keep[te]
    y_train, y_test = y_all[tr], y_all[te]
    progress.detail(f"{len(train_rows)} filas para entrenar y {len(test_rows)} para el examen final "
                    f"({round(cfg['testSize'] * 100)} %)")
    progress.write(f"Separadas {len(train_rows)} filas de entrenamiento y {len(test_rows)} de examen "
                   f"(semilla {cfg['seed']}, para que salga siempre igual).")

    progress.step("prep", "Preparar los datos")
    features = [{"name": n, "kind": table.column(n).kind} for n in cfg["features"]]
    prep = Preparer(features).fit(subset(table, cfg["features"], train_rows))
    cols_train, cols_test = subset(table, cfg["features"], train_rows), subset(table, cfg["features"], test_rows)
    raw_train, raw_test = prep.transform(cols_train, scaled=False), prep.transform(cols_test, scaled=False)
    sc_train, sc_test = prep.scale(raw_train), prep.scale(raw_test)
    progress.detail(f"{len(cfg['features'])} columnas → {len(prep.feature_names)} números por fila")
    for s in prep.describe():
        if s["items"]:
            progress.write(f"{s['title']}: " + ", ".join(i["column"] for i in s["items"][:8])
                           + ("…" if len(s["items"]) > 8 else ""))

    if cfg["mode"] == "auto":
        candidates = AUTO[task]
    else:
        candidates = [(cfg["algorithm"], cfg["params"])]
    k = len(target.classes)
    folds = cfg["folds"] if len(train_rows) >= 2 * max(2, cfg["folds"]) else 0
    if folds and len(train_rows) > 20000:
        folds = 3
    fold_of = folds_of(len(train_rows), y_train if task == "classification" else None, folds, rng) if folds else None
    progress.step("try", "Probar los algoritmos" if len(candidates) > 1 else "Entrenar")
    progress.write(f"Métrica para comparar: {metric_name(metric)}"
                   + (f", con validación cruzada de {folds} rondas." if folds else ", con el examen final."))
    results = []
    for ci, (key, params) in enumerate(candidates):
        progress.check()
        cls = alg.ALGORITHMS[key]
        name = candidate_name(key, params) if cfg["mode"] == "auto" else cls.name
        t0 = time.time()
        progress.detail(f"{ci + 1} de {len(candidates)}: {name}")
        base_frac = ci / len(candidates)
        span = 1 / len(candidates)

        def model_progress(f, msg, base=base_frac, span=span):
            progress.advance(0.1 + 0.8 * (base + span * min(1.0, f)))
            progress.check()

        cv_scores = []
        if folds:
            for f in range(folds):
                progress.check()
                fit_idx, val_idx = np.nonzero(fold_of != f)[0], np.nonzero(fold_of == f)[0]
                if len(val_idx) == 0:
                    continue
                p = Preparer(features).fit(subset(table, cfg["features"], train_rows[fit_idx]))
                Xf = p.transform(subset(table, cfg["features"], train_rows[fit_idx]), scaled=cls.scaled)
                Xv = p.transform(subset(table, cfg["features"], train_rows[val_idx]), scaled=cls.scaled)
                m = alg.make(key, task, params, n_classes=k, groups=p.groups)
                m.fit(Xf, y_train[fit_idx])
                cv_scores.append(score(task, metric, y_train[val_idx], m.predict(Xv), k))
                model_progress((f + 1) / (folds + 1), "")
        Xtr, Xte = (sc_train, sc_test) if cls.scaled else (raw_train, raw_test)
        model = alg.make(key, task, params, n_classes=k, groups=prep.groups)
        model.fit(Xtr, y_train, progress=lambda f, msg: model_progress((folds + f) / (folds + 1), msg))
        pred_test, pred_train = model.predict(Xte), model.predict(Xtr)
        if task == "classification":
            m_test = classification_metrics(y_test, pred_test, k)
            m_train = classification_metrics(y_train, pred_train, k)
        else:
            m_test, m_train = regression_metrics(y_test, pred_test), regression_metrics(y_train, pred_train)
        ms = int((time.time() - t0) * 1000)
        cv = {"metric": metric, "scores": [float(s) for s in cv_scores], "mean": float(np.mean(cv_scores)),
              "std": float(np.std(cv_scores))} if cv_scores else None
        shown = cv["mean"] if cv else m_test[metric]
        progress.write(f"{name}: {metric_name(metric).lower()} {fmt_metric(metric, shown)}"
                       + (f" (±\u00a0{fmt_metric(metric, cv['std'], plain=True)} entre rondas)" if cv else "")
                       + f" · examen {fmt_metric(metric, m_test[metric])} · {duration(ms)}")
        results.append({"key": key, "name": name, "params": dict(model.params), "model": model, "cv": cv,
                        "test": m_test, "train": m_train, "ms": ms, "predTest": pred_test, "Xte": Xte})
        progress.advance(0.1 + 0.8 * (ci + 1) / len(candidates))

    progress.step("choose", "Elegir el mejor" if len(results) > 1 else "Evaluar")
    hib = higher_is_better(metric)

    def rank_value(r):
        v = r["cv"]["mean"] if r["cv"] else r["test"][metric]
        return v if hib else -v

    ranked = sorted([r for r in results if r["key"] != "baseline"] or results, key=rank_value, reverse=True)
    best = ranked[0]
    if len(results) > 1:
        progress.detail(f"El mejor: {best['name']}")
        progress.write(f"Elegido: {best['name']} (mejor {metric_name(metric).lower()} "
                       f"{'en la validación cruzada' if best['cv'] else 'en el examen'}).")

    progress.step("explain", "Explicar los modelos")
    models = []
    for r in results:
        progress.check()
        ctx = model_context(prep, target, train_rows if r["key"] == "knn" else None)
        model = r["model"]
        charts = {}
        if task == "classification":
            charts["confusion"] = {"labels": target.classes, "counts": r["test"]["confusion"]}
            if k == 2 and hasattr(model, "predict_proba"):
                charts["roc"] = roc_curve(y_test, model.predict_proba(r["Xte"])[:, 1])
        else:
            sample = np.arange(len(y_test))
            if len(sample) > 400:
                sample = np.sort(rng.choice(len(sample), 400, replace=False))
            charts["scatter"] = [{"x": float(y_test[i]), "y": float(r["predTest"][i]), "row": int(test_rows[i])}
                                 for i in sample]
            resid = r["predTest"] - y_test
            if len(resid):
                counts, edges = np.histogram(resid, bins=centered_bins(resid))
                charts["residuals"] = {"edges": edges.tolist(), "counts": counts.tolist()}
        if r["key"] != "baseline":
            n_imp = min(len(y_test), 2000)
            charts["importance"] = permutation_importance(model.predict, r["Xte"][:n_imp], y_test[:n_imp], prep.groups,
                                                          task, metric, k)
        report = {"algorithm": r["key"], "name": r["name"], "params": r["params"], "task": task,
                  "summary": alg.ALGORITHMS[r["key"]].summary, "paramsText": describe_params(r["key"], r["params"]),
                  "target": cfg["target"], "classes": target.classes, "metric": metric,
                  "metrics": strip_confusion(r["test"]), "trainMetrics": strip_confusion(r["train"]), "cv": r["cv"],
                  "rows": {"train": int(len(train_rows)), "test": int(len(test_rows))}, "ms": r["ms"],
                  "charts": charts, "learned": model.learned(ctx), "prep": prep.describe(),
                  "example": {"row": int(test_rows[0]), "steps": prep.explain_row(cols_test, 0)} if len(test_rows) else None,
                  "features": features, "best": r is best, "baseline": r["key"] == "baseline"}
        models.append({"report": report, "state": {"model": model.to_state(), "prep": prep.to_state(),
                                                   "target": target.to_state(),
                                                   "trainRows": train_rows if r["key"] == "knn" else None}})
    leaderboard = [{"name": r["name"], "algorithm": r["key"], "params": r["params"], "cv": r["cv"],
                    "test": r["test"][metric], "train": r["train"][metric], "ms": r["ms"], "best": r is best,
                    "baseline": r["key"] == "baseline"} for r in results]
    progress.finish()
    return {"task": task, "metric": metric, "metricName": metric_name(metric), "models": models,
            "bestIndex": results.index(best), "leaderboard": leaderboard,
            "rows": {"total": int(table.n_rows), "used": int(len(keep)), "train": int(len(train_rows)),
                     "test": int(len(test_rows))}}


def strip_confusion(m: dict) -> dict:
    return {k: v for k, v in m.items() if k != "confusion"}


def fmt_metric(metric: str, v: float, plain: bool = False) -> str:
    if metric in ("accuracy", "balanced_accuracy", "f1_macro") and not plain:
        return f"{v * 100:.1f}\u00a0%".replace(".", ",")  # sin partir la línea entre el número y el %
    if metric in ("accuracy", "balanced_accuracy", "f1_macro"):
        return f"{v * 100:.1f}".replace(".", ",")
    return f"{v:.3f}".replace(".", ",") if abs(v) < 100 else f"{v:,.0f}".replace(",", ".")


# ------------------------------------------------------------- agrupación
def run_clustering(table: Table, cfg: dict, progress: Progress) -> dict:
    progress.step("data", "Leer los datos")
    rows = np.arange(table.n_rows)
    if len(rows) < 10:
        raise JobError("Hacen falta al menos 10 filas para agrupar.")
    progress.detail(f"{len(rows)} filas y {len(cfg['features'])} columnas")
    progress.write(f"Agrupar {len(rows)} filas sin decirle la respuesta, con {len(cfg['features'])} columnas.")
    progress.step("prep", "Preparar los datos")
    features = [{"name": n, "kind": table.column(n).kind} for n in cfg["features"]]
    cols = subset(table, cfg["features"], rows)
    prep = Preparer(features).fit(cols)
    raw = prep.transform(cols, scaled=False)
    X = prep.scale(raw)
    progress.detail(f"{len(cfg['features'])} columnas → {len(prep.feature_names)} números escalados por fila")
    progress.step("try", "Buscar grupos (k-medias)")
    params = dict(cfg["params"]) if cfg["mode"] == "custom" else {}
    model = alg.make("kmeans", "clustering", params)
    t0 = time.time()

    def mp(f, msg):
        progress.advance(0.1 + 0.8 * f)
        progress.write(msg)
        progress.check()

    model.fit(X, progress=mp)
    ms = int((time.time() - t0) * 1000)
    progress.step("explain", "Describir los grupos")
    labels = model.labels_
    sizes = np.bincount(labels, minlength=model.k)
    mean, axes, ratio = pca2(X)
    P = (X - mean) @ axes.T
    C = (model.centers - mean) @ axes.T
    rng = np.random.default_rng(cfg["seed"])
    sample = np.arange(len(X)) if len(X) <= 1000 else np.sort(rng.choice(len(X), 1000, replace=False))
    points = [{"x": float(P[i, 0]), "y": float(P[i, 1]), "group": int(labels[i]) + 1, "row": int(rows[i])} for i in sample]
    profiles = []
    for g in range(model.k):
        members = labels == g
        prof = {"group": g + 1, "size": int(sizes[g]), "columns": []}
        for spec, grp in zip(prep.specs, prep.groups):
            if spec["kind"] == NUMBER:
                v = raw[members, grp["start"]]
                prof["columns"].append({"column": spec["name"], "kind": NUMBER, "mean": float(v.mean()) if len(v) else None,
                                        "overall": float(raw[:, grp["start"]].mean())})
            elif spec["kind"] == CATEGORY:
                block = raw[members, grp["start"]:grp["end"]].sum(axis=0)
                j = int(np.argmax(block)) if block.sum() else 0
                prof["columns"].append({"column": spec["name"], "kind": CATEGORY, "top": spec["categories"][j],
                                        "share": float(block[j] / max(1, members.sum()))})
        profiles.append(prof)
    charts = {"points": points, "centers": [{"x": float(c[0]), "y": float(c[1]), "group": i + 1} for i, c in enumerate(C)],
              "variance": ratio, "search": model.search, "sizes": sizes.tolist()}
    if cfg.get("compare"):
        col = table.column(cfg["compare"])
        from .prep import label_of
        real = [label_of(v) for v in (col.values if col.kind == NUMBER else col.values)]
        classes = sorted({r for r in real if r is not None})
        table_counts = [[int(sum(1 for i in range(len(labels)) if labels[i] == g and real[i] == c)) for c in classes]
                        for g in range(model.k)]
        purity = sum(max(row) for row in table_counts) / max(1, sum(sum(r) for r in table_counts))
        charts["compare"] = {"column": cfg["compare"], "classes": classes, "counts": table_counts, "purity": purity}
        progress.write(f"Comparado con «{cfg['compare']}»: cada grupo coincide con una clase en el "
                       f"{purity * 100:.0f} % de las filas.")
    progress.write(f"{model.k} grupos, silueta {model.sil:.3f}".replace(".", ",") + f", en {duration(ms)}.")
    ctx = model_context(prep, None)
    report = {"algorithm": "kmeans", "name": f"k-medias (k = {model.k})", "params": dict(model.params, k=model.k),  # la k elegida
              "task": "clustering",
              "summary": alg.KMeans.summary, "paramsText": f"{model.k} grupos", "target": None, "classes": [],
              "metric": "silhouette", "metrics": {"silhouette": model.sil, "inertia": model.inertia, "k": model.k},
              "trainMetrics": None, "cv": None, "rows": {"train": int(len(rows)), "test": 0}, "ms": ms,
              "charts": charts, "learned": model.learned(ctx), "prep": prep.describe(), "profiles": profiles,
              "example": {"row": int(rows[0]), "steps": prep.explain_row(cols, 0)}, "features": features, "best": True,
              "baseline": False}
    state = {"model": model.to_state(), "prep": prep.to_state(), "target": None,
             "pca": {"mean": mean.tolist(), "axes": axes.tolist()}}
    progress.finish()
    leaderboard = [{"name": f"k-medias (k = {s['k']})", "algorithm": "kmeans", "params": {"k": s["k"]}, "cv": None,
                    "test": s["silhouette"], "train": None, "ms": None, "best": s["k"] == model.k, "baseline": False}
                   for s in model.search]
    return {"task": "clustering", "metric": "silhouette", "metricName": "Silueta", "models": [{"report": report, "state": state}],
            "bestIndex": 0, "leaderboard": leaderboard,
            "rows": {"total": int(table.n_rows), "used": int(len(rows)), "train": int(len(rows)), "test": 0}}


def run_table(table: Table, config: dict, progress: Progress) -> dict:
    cfg = check_config(table, config)
    out = run_clustering(table, cfg, progress) if cfg["task"] == "clustering" else run_supervised(table, cfg, progress)
    out["config"] = cfg
    return out


# ------------------------------------------------------------- predecir
class Bundle:
    """Un modelo guardado listo para predecir: preparación, algoritmo y columna que se predice."""

    def __init__(self, state: dict, report: dict):
        self.report = report
        self.prep = Preparer.from_state(state["prep"])
        self.target = Target.from_state(state["target"]) if state.get("target") else None
        mstate = state["model"]
        self.model = alg.ALGORITHMS[mstate["key"]].from_state(mstate)
        self.train_rows = state.get("trainRows")
        self.pca = state.get("pca")

    @property
    def task(self) -> str:
        return self.report["task"]

    def ctx(self) -> dict:
        return model_context(self.prep, self.target, self.train_rows)

    def predict(self, records: list[dict], explain: bool = False) -> list[dict]:
        cols = self.prep.records_to_cols(records)
        scaled = getattr(self.model, "scaled", True)
        X = self.prep.transform(cols, scaled=scaled)
        out = []
        if self.task == "classification":
            proba = self.model.predict_proba(X)
            for i, p in enumerate(proba):
                k = int(np.argmax(p))
                out.append({"prediction": self.target.classes[k], "confidence": float(p[k]),
                            "probabilities": {c: float(v) for c, v in zip(self.target.classes, p)}})
        elif self.task == "regression":
            for v in self.model.predict(X):
                out.append({"prediction": float(v)})
        else:
            groups = self.model.predict(X)
            for i, g in enumerate(groups):
                item = {"prediction": int(g) + 1}
                if self.pca:
                    pt = (X[i] - np.array(self.pca["mean"])) @ np.array(self.pca["axes"]).T
                    item["point"] = {"x": float(pt[0]), "y": float(pt[1])}
                out.append(item)
        if explain:
            ctx = self.ctx()
            for i, item in enumerate(out):
                item["explanation"] = self.model.explain(X[i], ctx)
                item["prepared"] = self.prep.explain_row(cols, i)
        return out

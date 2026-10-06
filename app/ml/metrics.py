"""Cómo de bien funciona un modelo: métricas, matriz de confusión, curva ROC e importancia de las columnas."""

from __future__ import annotations

import numpy as np

# métrica principal de cada tarea: (clave, nombre, ¿más alto es mejor?)
METRICS = {
    "classification": [("accuracy", "Exactitud", True), ("balanced_accuracy", "Exactitud equilibrada", True),
                       ("f1_macro", "F1 (media de las clases)", True)],
    "regression": [("r2", "R²", True), ("rmse", "Error cuadrático medio (RMSE)", False),
                   ("mae", "Error absoluto medio (MAE)", False)],
    "clustering": [("silhouette", "Silueta", True)],
}


def higher_is_better(metric: str) -> bool:
    for items in METRICS.values():
        for key, _, hib in items:
            if key == metric:
                return hib
    return True


def metric_name(metric: str) -> str:
    for items in METRICS.values():
        for key, name, _ in items:
            if key == metric:
                return name
    return metric


def confusion(y_true: np.ndarray, y_pred: np.ndarray, k: int) -> np.ndarray:
    m = np.zeros((k, k), dtype=int)
    np.add.at(m, (y_true, y_pred), 1)
    return m


def classification_metrics(y_true: np.ndarray, y_pred: np.ndarray, k: int) -> dict:
    cm = confusion(y_true, y_pred, k)
    support = cm.sum(axis=1)
    predicted = cm.sum(axis=0)
    tp = np.diag(cm).astype(float)
    with np.errstate(divide="ignore", invalid="ignore"):
        precision = np.where(predicted > 0, tp / predicted, 0.0)
        recall = np.where(support > 0, tp / support, 0.0)
        f1 = np.where(precision + recall > 0, 2 * precision * recall / (precision + recall), 0.0)
    present = support > 0
    n = max(1, len(y_true))
    return {
        "accuracy": float(tp.sum() / n),
        "balanced_accuracy": float(recall[present].mean()) if present.any() else 0.0,
        "f1_macro": float(f1[present].mean()) if present.any() else 0.0,
        "precision_macro": float(precision[present].mean()) if present.any() else 0.0,
        "recall_macro": float(recall[present].mean()) if present.any() else 0.0,
        "perClass": [{"precision": float(p), "recall": float(r), "f1": float(f), "support": int(s)}
                     for p, r, f, s in zip(precision, recall, f1, support)],
        "confusion": cm.tolist(),
    }


def regression_metrics(y_true: np.ndarray, y_pred: np.ndarray) -> dict:
    err = y_pred - y_true
    ss_res = float(np.sum(err ** 2))
    ss_tot = float(np.sum((y_true - y_true.mean()) ** 2)) if len(y_true) else 0.0
    return {
        "r2": 1 - ss_res / ss_tot if ss_tot > 0 else 0.0,
        "rmse": float(np.sqrt(np.mean(err ** 2))) if len(err) else 0.0,
        "mae": float(np.mean(np.abs(err))) if len(err) else 0.0,
        "maxError": float(np.max(np.abs(err))) if len(err) else 0.0,
        "meanTarget": float(y_true.mean()) if len(y_true) else 0.0,
    }


def score(task: str, metric: str, y_true, y_pred, k: int = 0) -> float:
    if task == "classification":
        return classification_metrics(y_true, y_pred, k)[metric]
    return regression_metrics(y_true, y_pred)[metric]


def roc_curve(y_true: np.ndarray, scores: np.ndarray) -> dict:
    """Curva ROC de una clasificación de dos clases: para cada umbral, qué parte de los positivos se acierta
    (sensibilidad) frente a qué parte de los negativos se toma por positivo (falsos positivos)."""
    order = np.argsort(-scores, kind="stable")
    y = y_true[order]
    s = scores[order]
    pos, neg = int(y.sum()), int(len(y) - y.sum())
    if pos == 0 or neg == 0:
        return {"points": [], "auc": None}
    tps = np.cumsum(y)
    fps = np.cumsum(1 - y)
    keep = np.r_[np.nonzero(np.diff(s))[0], len(s) - 1]
    tpr = np.r_[0, tps[keep] / pos]
    fpr = np.r_[0, fps[keep] / neg]
    auc = float(np.trapezoid(tpr, fpr)) if hasattr(np, "trapezoid") else float(np.trapz(tpr, fpr))
    step = max(1, len(fpr) // 120)
    pts = [{"x": float(a), "y": float(b)} for a, b in zip(fpr[::step], tpr[::step])]
    if pts[-1]["x"] != 1.0 or pts[-1]["y"] != 1.0:
        pts.append({"x": 1.0, "y": 1.0})
    return {"points": pts, "auc": auc}


def permutation_importance(predict, X: np.ndarray, y: np.ndarray, groups: list[dict], task: str, metric: str,
                           k: int = 0, repeats: int = 3, seed: int = 0) -> list[dict]:
    """Cuánto empeora el modelo si se barajan los valores de una columna (rompiendo su relación con lo que
    se predice). Si apenas empeora, el modelo no la usa; si se hunde, depende mucho de ella. Vale para
    cualquier algoritmo (Azure lo llama «importancia de las características»)."""
    rng = np.random.default_rng(seed)
    base = score(task, metric, y, predict(X), k)
    sign = 1 if higher_is_better(metric) else -1
    out = []
    for g in groups:
        drops = []
        for _ in range(repeats):
            Xp = X.copy()
            perm = rng.permutation(len(X))
            Xp[:, g["start"]:g["end"]] = X[perm, g["start"]:g["end"]]
            drops.append(sign * (base - score(task, metric, y, predict(Xp), k)))
        out.append({"column": g["column"], "value": float(np.mean(drops)), "std": float(np.std(drops))})
    out.sort(key=lambda r: -r["value"])
    return out


def pca2(X: np.ndarray) -> tuple[np.ndarray, np.ndarray, list[float]]:
    """Proyección en 2 dimensiones (análisis de componentes principales) para dibujar los puntos en un plano.
    Devuelve la media, los dos ejes y qué parte de la variación explica cada uno."""
    mean = X.mean(axis=0)
    Xc = X - mean
    if Xc.shape[1] == 1:
        axes = np.array([[1.0], [0.0]])
        return mean, axes, [1.0, 0.0]
    _, s, vt = np.linalg.svd(Xc, full_matrices=False)
    var = s ** 2
    ratio = (var / var.sum()).tolist() if var.sum() > 0 else [0.0] * len(var)
    axes = vt[:2]
    if axes.shape[0] < 2:
        axes = np.vstack([axes, np.zeros_like(axes[0])])
    return mean, axes, [float(r) for r in ratio[:2]] + [0.0] * (2 - len(ratio[:2]))

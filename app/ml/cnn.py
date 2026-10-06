"""Imágenes: una red neuronal convolucional pequeña escrita con numpy, y dos líneas base con los píxeles.

Las imágenes se guardan a 64 × 64 en color y se entrenan a 32 × 32 (o a 64 × 64, más lento). La red:

    imagen (cada una normalizada: media 0 y desviación 1; en gris si se elige «solo forma»)
      → [convolución 3×3 + ReLU + max-pooling 2×2] × 3 bloques (8, 16 y 32 filtros)
      → global max pooling: para cada filtro, su valor más alto en toda la imagen
      → capa densa → softmax (una probabilidad por clase)

Cada convolución pasa unos filtros pequeños por toda la imagen buscando un dibujo (un borde, una esquina,
un color); el max-pooling se queda con lo más fuerte de cada cuadradito de 2×2 y reduce la imagen a la
mitad, y el global max pooling responde «¿aparece este dibujo en alguna parte?», así que da igual dónde
esté la forma. Se entrena con retropropagación (backpropagation) y el optimizador Adam, por lotes.
"""

from __future__ import annotations

import time

import numpy as np
from numpy.lib.stride_tricks import sliding_window_view

from . import algorithms as alg
from .metrics import classification_metrics
from .png import data_url, normalized
from .runner import JobError, Progress, split_holdout

SIZE = 64  # tamaño al que se guardan las imágenes

IMAGE_ALGORITHMS = {
    "cnn": {"name": "Red neuronal convolucional",
            "summary": "Aprende sus propios filtros para encontrar bordes, esquinas y colores, y los combina para decidir.",
            "params": [
                alg._p("epochs", "Vueltas (épocas)", "int", 30, "Cuántas veces ve todas las imágenes de entrenamiento.",
                       min=1, max=100, step=1),
                alg._p("lr", "Tasa de aprendizaje", "float", 0.003, "Lo grande que es cada corrección de los pesos (Adam).",
                       min=0.0005, max=0.02, step=0.0005),
                alg._p("color", "Qué mira", "choice", "color", "Con color o solo la forma (la imagen en gris). Si el color "
                       "no ayuda a distinguir las clases (o despista), en gris aprende antes y mejor.",
                       options=[{"value": "color", "label": "Color"}, {"value": "gris", "label": "Solo forma (gris)"}]),
                alg._p("size", "Tamaño de entrada", "choice", 32, "A 32 × 32 entrena unas cuatro veces más rápido; a 64 × 64 "
                       "ve más detalle.", options=[{"value": 32, "label": "32 × 32"}, {"value": 64, "label": "64 × 64"}]),
                alg._p("augment", "Aumentar los datos", "choice", "si", "Cada vuelta ve las imágenes un poco movidas, "
                       "volteadas o con otro brillo: aprende mejor con pocas fotos. Si la izquierda y la derecha "
                       "importan (letras, flechas), mejor sin voltear.",
                       options=[{"value": "si", "label": "Mover, voltear y brillo"}, {"value": "sin_voltear", "label": "Mover y brillo"},
                                {"value": "no", "label": "No"}]),
            ]},
    "pixels_logistic": {"name": "Píxeles + regresión logística",
                        "summary": "Cada píxel (a 16 × 16) es una columna; aprende un peso por píxel y clase. No sabe nada de formas.",
                        "params": []},
    "pixels_knn": {"name": "Píxeles + k vecinos",
                   "summary": "Busca las imágenes de entrenamiento con los píxeles más parecidos (a 16 × 16).",
                   "params": [alg._p("k", "Vecinos (k)", "int", 3, "Cuántas imágenes parecidas consulta.", min=1, max=15, step=1)]},
}
AUTO_IMAGES = [("pixels_knn", {}), ("pixels_logistic", {}), ("cnn", {"color": "color"}), ("cnn", {"color": "gris"})]


def image_catalog() -> list[dict]:
    return [{"key": k, "name": v["name"], "summary": v["summary"], "params": v["params"]} for k, v in IMAGE_ALGORITHMS.items()]


def resize(X: np.ndarray, size: int) -> np.ndarray:
    """De 64 × 64 a `size` × `size` (media de cada bloque), como números entre 0 y 1."""
    X = np.asarray(X, dtype=np.float32) / 255.0
    f = SIZE // size
    if f == 1:
        return X
    n = X.shape[0]
    return X.reshape(n, size, f, size, f, 3).mean(axis=(2, 4))


# ------------------------------------------------------------ capas
def conv_forward(X, W, b):
    """Convolución 3×3 con relleno de un píxel: cada salida = suma de (trozo 3×3 de la entrada × filtro)."""
    n, h, w, c = X.shape
    kh, kw, _, f = W.shape
    Xp = np.pad(X, ((0, 0), (1, 1), (1, 1), (0, 0)))
    cols = sliding_window_view(Xp, (kh, kw), axis=(1, 2)).transpose(0, 1, 2, 4, 5, 3).reshape(n * h * w, kh * kw * c)
    out = cols @ W.reshape(kh * kw * c, f) + b
    return out.reshape(n, h, w, f), cols


def conv_backward(dout, cols, x_shape, W):
    n, h, w, c = x_shape
    kh, kw, _, f = W.shape
    d = dout.reshape(-1, f)
    dW = (cols.T @ d).reshape(W.shape)
    db = d.sum(axis=0)
    dcols = (d @ W.reshape(-1, f).T).reshape(n, h, w, kh, kw, c)
    dXp = np.zeros((n, h + 2, w + 2, c), dtype=dout.dtype)
    for i in range(kh):
        for j in range(kw):
            dXp[:, i:i + h, j:j + w, :] += dcols[:, :, :, i, j, :]
    return dXp[:, 1:-1, 1:-1, :], dW, db


def pool_forward(X):
    n, h, w, c = X.shape
    Xr = X.reshape(n, h // 2, 2, w // 2, 2, c)
    out = Xr.max(axis=(2, 4))
    mask = Xr == out[:, :, None, :, None, :]
    return out, mask


def pool_backward(dout, mask):
    n, h, w, c = dout.shape
    counts = mask.sum(axis=(2, 4), keepdims=True)
    return (mask * (dout[:, :, None, :, None, :] / counts)).reshape(n, h * 2, w * 2, c)


class ConvNet:
    """La red: tres bloques (convolución 3×3 + ReLU + max-pooling 2×2), global max pooling y una capa densa."""

    def __init__(self, n_classes: int, size: int = 32, filters=(8, 16, 32), color: bool = True, seed: int = 0):
        rng = np.random.default_rng(seed)
        self.size, self.k, self.filters, self.color = size, n_classes, tuple(int(f) for f in filters), bool(color)
        self.params: dict[str, np.ndarray] = {}
        cin = 3 if self.color else 1
        for i, f in enumerate(self.filters):
            self.params[f"W{i}"] = rng.normal(0, np.sqrt(2 / (9 * cin)), (3, 3, cin, f)).astype(np.float32)
            self.params[f"b{i}"] = np.zeros(f, np.float32)
            cin = f
        self.params["Wd"] = rng.normal(0, np.sqrt(1 / cin), (cin, n_classes)).astype(np.float32)
        self.params["bd"] = np.zeros(n_classes, np.float32)
        self.history: list[dict] = []

    def layers(self) -> list[dict]:
        s, ch = self.size, 3 if self.color else 1
        out = [{"name": "Imagen", "shape": f"{s} × {s} × {ch}", "params": 0,
                "text": ("los píxeles en rojo, verde y azul" if self.color else "la imagen en gris") + ", normalizados"}]
        cin, side = ch, s
        texts = ["cada filtro busca un dibujo pequeño (un borde, un color) en toda la imagen",
                 "combina lo de la capa anterior: esquinas, curvas, trozos de forma",
                 "combinaciones más grandes: partes de la forma"]
        for i, f in enumerate(self.filters):
            out.append({"name": f"Convolución 3×3 ({f} filtros) + ReLU", "shape": f"{side} × {side} × {f}",
                        "params": 9 * cin * f + f, "text": texts[min(i, 2)]})
            side //= 2
            out.append({"name": "Max-pooling 2×2", "shape": f"{side} × {side} × {f}", "params": 0,
                        "text": "se queda con lo más fuerte de cada cuadradito de 2 × 2: la mitad de ancho y de alto"})
            cin = f
        out.append({"name": "Global max pooling", "shape": f"{cin} números", "params": 0,
                    "text": "para cada filtro, su valor más alto en toda la imagen: «¿aparece este dibujo en alguna parte?»"})
        out.append({"name": "Capa densa + softmax", "shape": f"{self.k} clases", "params": cin * self.k + self.k,
                    "text": "suma esos números con un peso por clase y lo convierte en probabilidades"})
        return out

    def prepare(self, X: np.ndarray) -> np.ndarray:
        """Cada imagen con media 0 y desviación 1 (así la luz de la foto pesa menos); en gris si «solo forma»."""
        if not self.color:
            X = X.mean(axis=3, keepdims=True)
        m = X.mean(axis=(1, 2, 3), keepdims=True)
        sd = X.std(axis=(1, 2, 3), keepdims=True) + 1e-6
        return ((X - m) / sd).astype(np.float32)

    def forward(self, X):
        caches = []
        a = X
        for i in range(len(self.filters)):
            z, cols = conv_forward(a, self.params[f"W{i}"], self.params[f"b{i}"])
            pooled, mask = pool_forward(np.maximum(z, 0))
            caches.append((a.shape, cols, z, mask))
            a = pooled
        n, h, w, c = a.shape
        flat = a.reshape(n, h * w, c)
        where = flat.argmax(axis=1)
        feats = flat.max(axis=1)
        logits = feats @ self.params["Wd"] + self.params["bd"]
        return logits, (caches, a.shape, where, feats)

    def backward(self, cache, dlogits, want_input=False):
        caches, shape, where, feats = cache
        dlogits = dlogits.astype(feats.dtype)
        g = {"Wd": feats.T @ dlogits, "bd": dlogits.sum(axis=0)}
        dfeats = dlogits @ self.params["Wd"].T
        n, h, w, c = shape
        da = np.zeros((n, h * w, c), feats.dtype)
        np.put_along_axis(da, where[:, None, :], dfeats[:, None, :], axis=1)
        da = da.reshape(shape)
        for i in reversed(range(len(self.filters))):
            xs, cols, z, mask = caches[i]
            dz = pool_backward(da, mask) * (z > 0)
            da, g[f"W{i}"], g[f"b{i}"] = conv_backward(dz, cols, xs, self.params[f"W{i}"])
        return (g, da) if want_input else g

    def predict_proba(self, X, batch: int = 128):
        out = []
        for s in range(0, len(X), batch):
            logits, _ = self.forward(self.prepare(X[s:s + batch]))
            out.append(alg.softmax(logits.astype(np.float64)))
        return np.vstack(out) if out else np.zeros((0, self.k))

    def fit(self, X, y, X_test, y_test, epochs=30, lr=0.003, batch=32, augment="si", progress=None, seed=0):
        rng = np.random.default_rng(seed)
        m = {k: np.zeros_like(v) for k, v in self.params.items()}
        v = {k: np.zeros_like(v) for k, v in self.params.items()}
        b1, b2, t = 0.9, 0.999, 0
        self.history = []
        n = len(X)
        Y = np.eye(self.k, dtype=np.float32)
        for ep in range(1, epochs + 1):
            perm = rng.permutation(n)
            for s in range(0, n, batch):
                idx = perm[s:s + batch]
                xb = augmented(X[idx], rng, augment) if augment != "no" else X[idx]
                logits, cache = self.forward(self.prepare(xb))
                P = alg.softmax(logits.astype(np.float64)).astype(np.float32)
                grads = self.backward(cache, (P - Y[y[idx]]) / len(idx))
                t += 1
                for k in self.params:
                    m[k] = b1 * m[k] + (1 - b1) * grads[k]
                    v[k] = b2 * v[k] + (1 - b2) * grads[k] ** 2
                    mh, vh = m[k] / (1 - b1 ** t), v[k] / (1 - b2 ** t)
                    self.params[k] -= (lr * mh / (np.sqrt(vh) + 1e-8)).astype(np.float32)
            Ptr = self.predict_proba(X)
            loss = float(-np.mean(np.log(Ptr[np.arange(n), y] + 1e-12)))
            acc = float(np.mean(Ptr.argmax(axis=1) == y))
            test_acc = float(np.mean(self.predict_proba(X_test).argmax(axis=1) == y_test)) if len(X_test) else None
            self.history.append({"epoch": ep, "loss": loss, "accuracy": acc, "testAccuracy": test_acc})
            if progress:
                progress(ep / epochs, f"vuelta {ep}: error {loss:.3f}, acierta el {acc * 100:.0f} % de las de entrenamiento"
                         + (f" y el {test_acc * 100:.0f} % del examen" if test_acc is not None else ""))
        return self

    # -------------------------------------------------- mirar dentro
    def filters_png(self) -> list[str]:
        W = self.params["W0"]
        return [data_url(normalized(W[:, :, :, j] if self.color else W[:, :, 0, j])) for j in range(W.shape[3])]

    def inside(self, x: np.ndarray) -> dict:
        """Lo que ve la red con una imagen: los mapas de cada capa, qué detectores se encendieron y qué píxeles
        pesaron más en la decisión (saliencia: el gradiente de la puntuación respecto a cada píxel)."""
        xp = self.prepare(x[None])
        logits, cache = self.forward(xp)
        P = alg.softmax(logits.astype(np.float64))[0]
        k = int(np.argmax(P))
        d = np.zeros_like(logits, dtype=np.float32)
        d[0, k] = 1.0
        _, dx = self.backward(cache, d, want_input=True)
        sal = np.abs(dx[0]).max(axis=2)
        caches, _, _, feats = cache
        maps = []
        for i, (_, _, z, _) in enumerate(caches):
            z0 = np.maximum(z[0], 0)
            maps.append({"layer": i + 1, "size": int(z0.shape[0]),
                         "images": [data_url(normalized(z0[:, :, j])) for j in range(z0.shape[2])]})
        contrib = feats[0] * self.params["Wd"][:, k]
        order = np.argsort(-np.abs(contrib))[:8]
        return {"probabilities": P.tolist(), "class": k, "maps": maps, "saliency": data_url(normalized(sal)),
                "detectors": [{"index": int(j) + 1, "value": float(feats[0, j]), "contribution": float(contrib[j])}
                              for j in order]}

    def to_state(self) -> dict:
        s = dict(self.params)
        s.update(size=self.size, k=self.k, filters=list(self.filters), color=self.color, history=self.history)
        return s

    @classmethod
    def from_state(cls, s: dict) -> "ConvNet":
        net = cls(int(s["k"]), int(s["size"]), tuple(s["filters"]), bool(s.get("color", True)))
        for key in net.params:
            net.params[key] = np.asarray(s[key], dtype=np.float32)
        net.history = s.get("history", [])
        return net


def augmented(X: np.ndarray, rng, mode: str = "si") -> np.ndarray:
    """Imágenes un poco cambiadas en cada vuelta: movidas unos píxeles, volteadas (si se puede) y con otro brillo."""
    n, s = X.shape[0], X.shape[1]
    out = X.copy()
    if mode == "si":
        flip = rng.random(n) < 0.5
        out[flip] = out[flip, :, ::-1]
    m = max(1, s // 10)
    padded = np.pad(out, ((0, 0), (m, m), (m, m), (0, 0)), mode="edge")
    dx, dy = rng.integers(0, 2 * m + 1, n), rng.integers(0, 2 * m + 1, n)
    for i in range(n):
        out[i] = padded[i, dy[i]:dy[i] + s, dx[i]:dx[i] + s]
    out = out * rng.uniform(0.85, 1.15, (n, 1, 1, 1)).astype(np.float32)
    return np.clip(out, 0, 1)


# ------------------------------------------------------- píxeles a secas
PIXELS = 16


def pixel_features(images: np.ndarray) -> np.ndarray:
    return resize(images, PIXELS).reshape(len(images), -1).astype(np.float64)


# ----------------------------------------------------------- entrenar
def run_images(images: np.ndarray, labels: list[str], config: dict, progress: Progress, ids: list[str] | None = None) -> dict:
    """Entrena con imágenes (n × 64 × 64 × 3, enteros 0-255), sus etiquetas y (opcional) sus ids."""
    mode = config.get("mode", "auto")
    if mode == "custom":
        key = config.get("algorithm")
        if key not in IMAGE_ALGORITHMS:
            raise JobError("Elige uno de los algoritmos para imágenes.")
        params = {p["key"]: p["default"] for p in IMAGE_ALGORITHMS[key]["params"]}
        for p in IMAGE_ALGORITHMS[key]["params"]:
            v = (config.get("params") or {}).get(p["key"])
            if v is None:
                continue
            if p["type"] == "choice":
                opts = [o["value"] for o in p["options"]]
                v = next((o for o in opts if str(o) == str(v)), None)
                if v is not None:
                    params[p["key"]] = v
            else:
                try:
                    v = min(max(float(v), p["min"]), p["max"])
                    params[p["key"]] = int(round(v)) if p["type"] == "int" else v
                except (TypeError, ValueError):
                    pass
        candidates = [(key, params)]
    else:
        candidates = [(k, {**{p["key"]: p["default"] for p in IMAGE_ALGORITHMS[k]["params"]}, **extra})
                      for k, extra in AUTO_IMAGES]
    test_size = min(0.5, max(0.1, float(config.get("testSize", 0.2) or 0.2)))
    seed = int(config.get("seed", 42) or 42)
    rng = np.random.default_rng(seed)

    progress.step("data", "Leer las imágenes")
    classes = sorted(set(labels))
    if len(classes) < 2:
        raise JobError("Hacen falta al menos dos clases con imágenes.")
    y = np.array([classes.index(lbl) for lbl in labels], dtype=int)
    counts = np.bincount(y, minlength=len(classes))
    if counts.min() < 2:
        raise JobError(f"Cada clase necesita al menos 2 imágenes (a «{classes[int(counts.argmin())]}» le faltan).")
    progress.detail(f"{len(y)} imágenes de {len(classes)} clases")
    progress.write("Imágenes por clase: " + ", ".join(f"{c} ({n})" for c, n in zip(classes, counts)))

    progress.step("split", "Separar entrenamiento y examen")
    tr, te = split_holdout(len(y), y, test_size, rng)
    progress.detail(f"{len(tr)} para entrenar y {len(te)} para el examen")
    progress.write(f"{len(tr)} imágenes para entrenar y {len(te)} para el examen ({round(test_size * 100)} %). "
                   "Con imágenes no se hace validación cruzada: tardaría mucho.")

    progress.step("try", "Probar los algoritmos" if len(candidates) > 1 else "Entrenar")
    results = []
    for ci, (key, params) in enumerate(candidates):
        progress.check()
        name = image_model_name(key, params)
        progress.detail(f"{ci + 1} de {len(candidates)}: {name}")
        t0 = time.time()
        span = 1 / len(candidates)

        def mp(f, msg, base=ci / len(candidates), span=span):
            progress.advance(0.1 + 0.8 * (base + span * f))
            if msg:
                progress.write(f"{name}: {msg}")
            progress.check()

        if key == "cnn":
            size = int(params["size"])
            Xtr, Xte = resize(images[tr], size), resize(images[te], size)
            net = ConvNet(len(classes), size=size, color=params.get("color", "color") == "color", seed=seed)
            net.fit(Xtr, y[tr], Xte, y[te], epochs=int(params["epochs"]), lr=float(params["lr"]),
                    augment=str(params["augment"]), progress=mp, seed=seed)
            proba_te, proba_tr = net.predict_proba(Xte), net.predict_proba(Xtr)
            model = net
        else:
            Ftr, Fte = pixel_features(images[tr]), pixel_features(images[te])
            mean, std = Ftr.mean(axis=0), Ftr.std(axis=0) + 1e-6
            inner = "logistic" if key == "pixels_logistic" else "knn"
            m = alg.make(inner, "classification", {"k": params.get("k", 3)} if inner == "knn" else {}, n_classes=len(classes))
            m.fit((Ftr - mean) / std, y[tr], progress=lambda f, msg: mp(f, ""))
            proba_te, proba_tr = m.predict_proba((Fte - mean) / std), m.predict_proba((Ftr - mean) / std)
            model = {"inner": m, "mean": mean, "std": std}
        pred_te, pred_tr = proba_te.argmax(axis=1), proba_tr.argmax(axis=1)
        mt = classification_metrics(y[te], pred_te, len(classes))
        mtr = classification_metrics(y[tr], pred_tr, len(classes))
        ms = int((time.time() - t0) * 1000)
        progress.write(f"{name}: acierta el {mt['accuracy'] * 100:.1f} % del examen "
                       f"({mtr['accuracy'] * 100:.0f} % de las de entrenamiento) · {ms} ms")
        results.append({"key": key, "name": name, "params": params, "model": model, "test": mt, "train": mtr, "ms": ms,
                        "probaTest": proba_te})

    progress.step("choose", "Elegir el mejor" if len(results) > 1 else "Evaluar")
    best = max(results, key=lambda r: (r["test"]["accuracy"], r["key"] == "cnn"))
    if len(results) > 1:
        progress.detail(f"El mejor: {best['name']}")
        progress.write(f"Elegido: {best['name']} (mejor acierto en el examen).")

    progress.step("explain", "Explicar los modelos")
    png = data_url
    models = []
    for r in results:
        pred = r["probaTest"].argmax(axis=1)
        wrong = [int(i) for i in np.nonzero(pred != y[te])[0][:12]]
        mistakes = [{"thumb": png(images[te[i]]), "real": classes[int(y[te[i]])], "predicted": classes[int(pred[i])],
                     "confidence": float(r["probaTest"][i].max())} for i in wrong]
        if r["key"] == "cnn":
            net = r["model"]
            learned = {"kind": "cnn", "layers": net.layers(), "filters": net.filters_png(), "history": net.history,
                       "params": int(sum(v.size for v in net.params.values()))}
            sample = int(te[0])
            example = net.inside(resize(images[sample:sample + 1], net.size)[0])
            example.update(thumb=data_url(images[sample]), real=classes[int(y[sample])])
            learned["example"] = example
            state = {"kind": "cnn", "net": net.to_state(), "classes": classes}
        else:
            inner = r["model"]["inner"]
            if r["key"] == "pixels_logistic":
                W = inner.W  # (16·16·3) × clases, en unidades escaladas
                templates = [{"class": c, "image": png(normalized(W[:, k].reshape(PIXELS, PIXELS, 3)))}
                             for k, c in enumerate(classes)]
                learned = {"kind": "pixels_logistic", "templates": templates, "history": inner.history}
            else:
                learned = {"kind": "pixels_knn", "rows": int(len(tr)),
                           "text": f"Guarda las {len(tr)} imágenes de entrenamiento a {PIXELS} × {PIXELS} y busca las más parecidas."}
            state = {"kind": "pixels", "key": r["key"], "model": inner.to_state(), "mean": r["model"]["mean"],
                     "std": r["model"]["std"], "classes": classes,
                     "trainIds": [ids[i] for i in tr] if ids is not None and r["key"] == "pixels_knn" else None}
        report = {"algorithm": r["key"], "name": r["name"], "params": r["params"], "task": "images",
                  "summary": IMAGE_ALGORITHMS[r["key"]]["summary"], "paramsText": params_text(r["key"], r["params"]),
                  "target": "clase", "classes": classes, "metric": "accuracy",
                  "metrics": {k: v for k, v in r["test"].items() if k != "confusion"},
                  "trainMetrics": {k: v for k, v in r["train"].items() if k != "confusion"}, "cv": None,
                  "rows": {"train": int(len(tr)), "test": int(len(te))}, "ms": r["ms"],
                  "charts": {"confusion": {"labels": classes, "counts": r["test"]["confusion"]}, "mistakes": mistakes},
                  "learned": learned, "best": r is best, "baseline": False}
        models.append({"report": report, "state": state})
    leaderboard = [{"name": r["name"], "algorithm": r["key"], "params": r["params"], "cv": None,
                    "test": r["test"]["accuracy"], "train": r["train"]["accuracy"], "ms": r["ms"], "best": r is best,
                    "baseline": False} for r in results]
    progress.finish()
    return {"task": "images", "metric": "accuracy", "metricName": "Exactitud", "models": models,
            "bestIndex": results.index(best), "leaderboard": leaderboard,
            "rows": {"total": int(len(y)), "used": int(len(y)), "train": int(len(tr)), "test": int(len(te))},
            "config": {"task": "images", "mode": mode, "algorithm": candidates[0][0] if mode == "custom" else None,
                       "params": candidates[0][1] if mode == "custom" else {}, "testSize": test_size, "seed": seed,
                       "metric": "accuracy", "classes": classes}}


def image_model_name(key: str, params: dict) -> str:
    if key == "cnn":
        return "Red convolucional (" + ("solo forma" if params.get("color") == "gris" else "color") + ")"
    return IMAGE_ALGORITHMS[key]["name"]


def params_text(key: str, params: dict) -> str:
    specs = {p["key"]: p for p in IMAGE_ALGORITHMS[key]["params"]}
    parts = []
    for k, v in params.items():
        spec = specs.get(k)
        if spec:
            label = next((o["label"] for o in spec.get("options", []) if str(o["value"]) == str(v)), v)
            parts.append(f"{spec['label'].lower()}: {label}")
    return ", ".join(parts)


class ImageBundle:
    """Un modelo de imágenes guardado, listo para predecir."""

    def __init__(self, state: dict, report: dict):
        self.report = report
        self.kind = state["kind"]
        self.classes = state["classes"]
        if self.kind == "cnn":
            self.net = ConvNet.from_state(state["net"])
        else:
            self.key = state["key"]
            m = state["model"]
            self.inner = alg.ALGORITHMS[m["key"]].from_state(m)
            self.mean, self.std = np.asarray(state["mean"]), np.asarray(state["std"])
            self.train_ids = state.get("trainIds")

    def predict(self, images: np.ndarray, explain: bool = False, thumbs=None) -> list[dict]:
        if self.kind == "cnn":
            X = resize(images, self.net.size)
            proba = self.net.predict_proba(X)
        else:
            F = (pixel_features(images) - self.mean) / self.std
            proba = self.inner.predict_proba(F)
        out = []
        for i, p in enumerate(proba):
            k = int(np.argmax(p))
            item = {"prediction": self.classes[k], "confidence": float(p[k]),
                    "probabilities": {c: float(v) for c, v in zip(self.classes, p)}}
            if explain:
                if self.kind == "cnn":
                    item["inside"] = self.net.inside(X[i])
                elif self.key == "pixels_knn":
                    idx, dist = self.inner.neighbors(F[i:i + 1])
                    item["neighbors"] = [{"index": int(j), "distance": float(d),
                                          "label": self.classes[int(self.inner.y[j])],
                                          "id": str(self.train_ids[j]) if self.train_ids is not None else None}
                                         for j, d in zip(idx[0], dist[0])]
                else:
                    z = F[i] @ self.inner.W + self.inner.b
                    item["scores"] = [{"class": c, "score": float(v)} for c, v in zip(self.classes, z)]
            out.append(item)
        return out

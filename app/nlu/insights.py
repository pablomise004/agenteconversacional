"""Información para entender (y enseñar) cómo aprende el agente.

- top_features: los rasgos que más empujan hacia cada intención (pesos del modelo).
- projection:   mapa 2D de las frases de entrenamiento según lo que "piensa" el modelo.
- explain:      el recorrido completo de una frase, paso a paso.
- evaluate:     examen con validación cruzada (frases que el modelo no ha visto).
"""

from __future__ import annotations

import copy
import random
import time
from collections import Counter, defaultdict

import numpy as np

from .engine import FALLBACK_PREFIX, NLUEngine
from .features import featurize

KIND_LABELS = {"w": "palabra", "b": "pareja de palabras", "e": "entidad", "c": "trozo de letras",
               "p": "signo de pregunta"}
FALLBACK_LABEL = "__fallback__"


# ----------------------------------------------------------------- rasgos
def _word_for(engine: NLUEngine, stem: str) -> str:
    if stem.startswith("@") or stem.startswith("#"):
        return stem
    words = engine.stem_words.get(stem)
    return words.most_common(1)[0][0] if words else stem


def describe_feature(engine: NLUEngine, feature: str) -> dict:
    """Traduce un rasgo interno ("w:reserv", "b:quier_reserv"...) a algo legible."""
    kind, _, value = feature.partition(":")
    out = {"feature": feature, "kind": kind, "kindLabel": KIND_LABELS.get(kind, kind)}
    if kind == "w":
        word = _word_for(engine, value)
        out["label"] = word
        if word != value:
            out["detail"] = f"raíz «{value}»"
    elif kind == "b":
        a, _, b = value.partition("_")
        out["label"] = f"{_word_for(engine, a)} {_word_for(engine, b)}"
    elif kind == "e":
        out["label"] = value
    elif kind == "c":
        start, end = value.startswith("<"), value.endswith(">")
        core = value.strip("<>")
        out["label"] = ("" if start else "…") + core + ("" if end else "…")
        out["detail"] = "principio de palabra" if start else "final de palabra" if end else "dentro de palabra"
    elif kind == "p":
        out["label"] = "¿…?"
    else:
        out["label"] = value
    return out


def _label_info(engine: NLUEngine, label: str) -> dict:
    is_fb = label.startswith(FALLBACK_PREFIX)
    intent_id = label[len(FALLBACK_PREFIX):] if is_fb else label
    intent = engine.intents.get(intent_id, {})
    return {"id": intent_id, "name": intent.get("name", intent_id), "isFallback": is_fb}


def top_features(engine: NLUEngine, k: int = 8, include_chars: bool = False) -> list[dict]:
    clf = engine.classifier
    if clf.W is None or not clf.labels:
        return []
    names = list(clf.fidx)
    out = []
    counts = Counter(clf.example_labels)
    for col, label in enumerate(clf.labels):
        weights = clf.W[:, col]
        order = np.argsort(-weights)
        items = []
        for i in order:
            if len(items) >= k or weights[i] <= 0:
                break
            f = names[i]
            if not include_chars and f.startswith("c:"):
                continue
            items.append(dict(describe_feature(engine, f), weight=round(float(weights[i]), 4)))
        info = _label_info(engine, label)
        out.append(dict(info, phrases=counts[label], features=items))
    out.sort(key=lambda r: (r["isFallback"], r["name"].lower()))
    return out


# ------------------------------------------------------------------- mapa 2D
def _tsne(Y: np.ndarray, perplexity: float = 20.0, iters: int = 400, seed: int = 0) -> np.ndarray:
    """t-SNE exacto y compacto (suficiente para unos cientos de frases)."""
    n = len(Y)
    if n < 3:
        return np.zeros((n, 2))
    perplexity = min(perplexity, max(2.0, (n - 1) / 3))
    rng = np.random.default_rng(seed)
    D = ((Y[:, None, :] - Y[None, :, :]) ** 2).sum(-1)
    P = np.zeros((n, n))
    target = np.log(perplexity)
    for i in range(n):
        lo, hi, beta = 1e-20, 1e20, 1.0
        p = np.zeros(n)
        for _ in range(60):
            p = np.exp(-D[i] * beta)
            p[i] = 0.0
            total = p.sum()
            if total <= 0:
                p[:] = 1.0 / (n - 1)
                p[i] = 0.0
                break
            p /= total
            nz = p[p > 0]
            H = -(nz * np.log(nz)).sum()
            if abs(H - target) < 1e-4:
                break
            if H > target:
                lo = beta
                beta = beta * 2 if hi >= 1e19 else (beta + hi) / 2
            else:
                hi = beta
                beta = (beta + lo) / 2
        P[i] = p
    P = np.maximum((P + P.T) / (2 * n), 1e-12)
    Z = rng.normal(0, 1e-4, (n, 2))
    V = np.zeros_like(Z)
    for it in range(iters):
        exaggeration = 4.0 if it < 100 else 1.0
        diff = Z[:, None, :] - Z[None, :, :]
        num = 1.0 / (1.0 + (diff ** 2).sum(-1))
        np.fill_diagonal(num, 0.0)
        Q = np.maximum(num / num.sum(), 1e-12)
        G = 4.0 * (((exaggeration * P - Q) * num)[:, :, None] * diff).sum(1)
        V = (0.5 if it < 250 else 0.8) * V - 100.0 * G
        Z = Z + V
    return Z


def _relax(Z: np.ndarray, min_dist: float = 0.022, iters: int = 80) -> np.ndarray:
    """Separa los puntos que quedan uno encima de otro sin mover los grupos.

    t-SNE junta mucho las frases de una misma intención (el modelo las puntúa casi
    igual); con esta repulsión de corto alcance cada frase se ve por separado."""
    Z = Z + np.random.default_rng(0).normal(0, 1e-4, Z.shape)
    for _ in range(iters):
        diff = Z[:, None, :] - Z[None, :, :]
        d = np.maximum(np.sqrt((diff ** 2).sum(-1)), 1e-6) + np.eye(len(Z))
        push = np.clip(min_dist - d, 0, None)
        np.fill_diagonal(push, 0.0)
        if not push.any():
            break
        Z = np.clip(Z + 0.5 * ((push / d)[:, :, None] * diff).sum(1), 0.0, 1.0)
    return Z


def projection(engine: NLUEngine, max_points: int = 700) -> dict:
    """Coloca cada frase de entrenamiento en un plano: las que el modelo ve
    parecidas quedan juntas. Se calcula sobre las puntuaciones del modelo
    (una por intención) con t-SNE, y se guarda en caché por versión del modelo."""
    cached = getattr(engine, "_projection", None)
    if cached is not None:
        return cached
    clf = engine.classifier
    idx = list(range(len(clf.examples)))
    if len(idx) > max_points:  # muestra estratificada por intención
        rng = random.Random(0)
        by = defaultdict(list)
        for i in idx:
            by[clf.example_labels[i]].append(i)
        share = max_points / len(idx)
        idx = sorted(j for items in by.values()
                     for j in rng.sample(items, max(1, round(len(items) * share))))
    if not idx or clf.W is None:
        engine._projection = {"points": [], "sampled": False}
        return engine._projection
    L = np.array([clf.logits(clf.examples[i]) for i in idx])
    L = L - L.mean(1, keepdims=True)
    Z = _tsne(L)
    if len(Z):
        mn, mx = Z.min(0), Z.max(0)
        span = np.where(mx - mn > 1e-9, mx - mn, 1.0)
        Z = _relax((Z - mn) / span)
    points = []
    for (x, y), i in zip(Z, idx):
        ex = engine.examples[i]
        info = _label_info(engine, clf.example_labels[i])
        points.append({"x": round(float(x), 4), "y": round(float(y), 4), "text": ex["text"],
                       "intentId": info["id"], "intentName": info["name"],
                       "isFallback": info["isFallback"]})
    engine._projection = {"points": points, "sampled": len(idx) < len(clf.examples),
                          "_logits": L, "_coords": Z}
    return engine._projection


def place_on_map(engine: NLUEngine, x: dict, k: int = 5) -> dict | None:
    """Posición aproximada de una frase nueva: media de sus vecinos más cercanos
    en el espacio de puntuaciones del modelo."""
    proj = projection(engine)
    L, Z = proj.get("_logits"), proj.get("_coords")
    if L is None or not len(L):
        return None
    z = engine.classifier.logits(x)
    z = z - z.mean()
    d = np.sqrt(((L - z) ** 2).sum(1))
    nearest = np.argsort(d)[:k]
    w = 1.0 / (d[nearest] + 1e-6)
    pos = (Z[nearest] * w[:, None]).sum(0) / w.sum()
    return {"x": round(float(pos[0]), 4), "y": round(float(pos[1]), 4)}


def public_projection(engine: NLUEngine) -> dict:
    proj = projection(engine)
    return {"points": proj["points"], "sampled": proj["sampled"]}


# ------------------------------------------------------------- explicación
def explain(engine: NLUEngine, text: str, contexts=None, threshold: float = 0.3) -> dict:
    t0 = time.perf_counter()
    a = engine.analyze(text, contexts or [], neighbors=5)
    spans = [(c.tstart, c.tend, c.entity) for c in a.entities]
    words, chars = featurize(a.tokens, spans, engine.feature_config)
    raw = {**words, **chars}
    idf = engine.vectorizer.idf
    vec = a.vector
    features = []
    for f, v in sorted(vec.items(), key=lambda kv: -kv[1]):
        features.append(dict(describe_feature(engine, f), count=round(raw.get(f, 0), 3),
                             idf=round(idf.get(f, 0), 3), weight=round(v, 4)))
    unknown = [describe_feature(engine, f) for f in raw if f not in idf]
    clf = engine.classifier
    contributions = []
    for r in a.ranking[:3]:
        label = (FALLBACK_PREFIX + r["id"]) if r["isFallback"] else r["id"]
        if label not in clf.labels:
            continue
        col = clf.labels.index(label)
        parts = []
        for f, v in vec.items():
            i = clf.fidx.get(f)
            if i is not None:
                c = float(v * clf.W[i, col])
                if abs(c) > 1e-6:
                    parts.append(dict(describe_feature(engine, f), contribution=round(c, 4)))
        parts.sort(key=lambda p: -p["contribution"])
        positive = [p for p in parts if p["contribution"] > 0][:8]
        negative = sorted([p for p in parts if p["contribution"] < 0], key=lambda p: p["contribution"])[:5]
        contributions.append({"id": r["id"], "name": r["name"], "bias": round(float(clf.b[col]), 4),
                              "score": round(float(clf.logits(vec)[col]), 4),
                              "positive": positive, "negative": negative})
    best = a.best
    accepted = bool(best and not best["isFallback"] and best["confidence"] >= threshold)
    return {
        "text": text,
        "tokens": [t.to_dict() for t in a.tokens],
        "entities": [e.to_dict() for e in a.entities],
        "features": features,
        "featureCounts": {"total": len(vec), "unknown": len(unknown)},
        "unknownFeatures": unknown[:20],
        "ranking": [{k: (round(v, 4) if isinstance(v, float) else v) for k, v in r.items()}
                    for r in a.ranking[:6]],
        "contributions": contributions,
        "template": ({"intent": a.template["intent"], "phrase": a.template["phrase"]}
                     if a.template else None),
        "neighbors": a.neighbors,
        "threshold": threshold,
        "accepted": accepted,
        "position": place_on_map(engine, vec) if vec else None,
        "ms": int((time.perf_counter() - t0) * 1000),
    }


# ------------------------------------------------------------------ examen
def evaluate(agent: dict, folds: int = 5, seed: int = 0) -> dict:
    """Validación cruzada: se esconde una parte de las frases, se entrena con el
    resto y se comprueba si el agente acierta las escondidas. Se repite hasta que
    todas las frases han estado escondidas una vez."""
    t0 = time.perf_counter()
    threshold = float((agent.get("settings") or {}).get("threshold", 0.3))
    rng = random.Random(seed)
    items = []  # (intent, phrase_index, fold)
    for intent in agent.get("intents") or []:
        phrases = [i for i, p in enumerate(intent.get("trainingPhrases") or []) if p.get("text", "").strip()]
        rng.shuffle(phrases)
        offset = rng.randrange(folds)
        for n, pi in enumerate(phrases):
            items.append((intent, pi, (n + offset) % folds))
    names = {i["id"]: i["name"] for i in agent.get("intents") or []}
    expected_of = lambda intent: FALLBACK_LABEL if intent.get("isFallback") else intent["id"]  # noqa: E731
    results = []
    for fold in range(folds):
        held = [(it, pi) for it, pi, f in items if f == fold]
        if not held:
            continue
        hidden = defaultdict(set)
        for it, pi in held:
            hidden[it["id"]].add(pi)
        reduced = copy.deepcopy(agent)
        for it in reduced["intents"]:
            it["trainingPhrases"] = [p for i, p in enumerate(it.get("trainingPhrases") or [])
                                     if i not in hidden.get(it["id"], ())]
        engine = NLUEngine(reduced)
        for it, pi in held:
            text = it["trainingPhrases"][pi]["text"]
            a = engine.analyze(text, it.get("inputContexts") or [])
            best = a.best
            if best and not best["isFallback"] and best["confidence"] >= threshold:
                predicted, conf = best["id"], best["confidence"]
            else:
                predicted, conf = FALLBACK_LABEL, best["confidence"] if best else 0.0
            results.append({"text": text, "expected": expected_of(it), "predicted": predicted,
                            "confidence": round(conf, 4), "intentId": it["id"]})
    labels = sorted({r["expected"] for r in results} | {r["predicted"] for r in results},
                    key=lambda l: (l == FALLBACK_LABEL, names.get(l, l).lower()))
    li = {l: i for i, l in enumerate(labels)}
    matrix = [[0] * len(labels) for _ in labels]
    for r in results:
        matrix[li[r["expected"]]][li[r["predicted"]]] += 1
    label_name = lambda l: "No entendida (fallback)" if l == FALLBACK_LABEL else names.get(l, l)  # noqa: E731
    per_intent = []
    for l in labels:
        row = matrix[li[l]]
        total = sum(row)
        col_total = sum(matrix[r][li[l]] for r in range(len(labels)))
        if not total:
            continue
        confused = sorted(((labels[j], c) for j, c in enumerate(row) if j != li[l] and c),
                          key=lambda x: -x[1])
        per_intent.append({
            "id": l, "name": label_name(l), "phrases": total, "correct": row[li[l]],
            "recall": round(row[li[l]] / total, 4) if total else None,
            "precision": round(row[li[l]] / col_total, 4) if col_total else None,
            "confusedWith": [{"id": c, "name": label_name(c), "count": n} for c, n in confused],
        })
    errors = [dict(r, expectedName=label_name(r["expected"]), predictedName=label_name(r["predicted"]))
              for r in results if r["expected"] != r["predicted"]]
    errors.sort(key=lambda r: (r["expectedName"].lower(), -r["confidence"]))
    correct = sum(1 for r in results if r["expected"] == r["predicted"])
    return {
        "folds": folds,
        "total": len(results),
        "correct": correct,
        "accuracy": round(correct / len(results), 4) if results else None,
        "threshold": threshold,
        "perIntent": per_intent,
        "errors": errors,
        "matrix": {"labels": [{"id": l, "name": label_name(l)} for l in labels], "counts": matrix},
        "ms": int((time.perf_counter() - t0) * 1000),
    }

"""Clasificador de intenciones.

Combina dos modelos sobre vectores TF-IDF:
  - Regresión logística (softmax) entrenada con SGD: decide qué intención es
    la más probable.
  - Similitud coseno con las frases de entrenamiento y con el centroide de cada
    intención: indica cuánto se parece de verdad la frase a lo que conoce el
    agente. Sirve para detectar frases fuera de tema (fallback) y para
    explicar la decisión mostrando las frases más parecidas.
"""

import math
import time
from collections import Counter, defaultdict

import numpy as np


def _l2(d: dict) -> dict:
    n = math.sqrt(sum(v * v for v in d.values()))
    return {k: v / n for k, v in d.items()} if n else {}


class Vectorizer:
    """TF-IDF donde el IDF se calcula por intenciones: una palabra que aparece
    en todas las intenciones pesa poco; una exclusiva de una intención, mucho."""

    def __init__(self, char_weight: float = 0.45):
        self.char_weight = char_weight
        self.idf: dict[str, float] = {}

    def fit(self, feats: list[tuple[dict, dict]], labels: list[str]) -> "Vectorizer":
        classes = defaultdict(set)
        for (words, chars), label in zip(feats, labels):
            for f in words:
                classes[f].add(label)
            for f in chars:
                classes[f].add(label)
        k = len(set(labels))
        self.idf = {f: math.log((1 + k) / (1 + len(c))) + 1.0 for f, c in classes.items()}
        return self

    def transform(self, feat: tuple[dict, dict]) -> dict[str, float]:
        words, chars = feat
        idf = self.idf

        def block(d):
            return _l2({f: (1.0 + math.log(v) if v >= 1 else v) * idf[f]
                        for f, v in d.items() if f in idf and v > 0})

        a = self.char_weight
        out = {f: v * math.sqrt(1 - a) for f, v in block(words).items()}
        for f, v in block(chars).items():
            out[f] = v * math.sqrt(a)
        return out


class NaiveBayes:
    """Naive Bayes multinomial con los mismos rasgos y frases que la regresión logística, pero con sus
    cuentas (sin TF-IDF). No decide nada: está para compararlos en «Por dentro» (insights.explain).

        P(k | frase) ∝ P(k) · Π_f P(f | k)^n_f,   P(f | k) = (cuenta de f en k + α) / (total de k + α·V)
    """

    def __init__(self, alpha: float = 1.0):
        self.alpha = alpha
        self.labels: list[str] = []
        self.docs: Counter = Counter()
        self.counts: dict[str, dict[str, float]] = {}
        self.totals: dict[str, float] = {}
        self.vocab = 0

    def fit(self, feats: list[dict], labels: list[str]) -> "NaiveBayes":
        self.labels = sorted(set(labels))
        self.docs = Counter(labels)
        counts: dict[str, dict[str, float]] = {label: defaultdict(float) for label in self.labels}
        vocab = set()
        for f, label in zip(feats, labels):
            for name, n in f.items():
                counts[label][name] += n
                vocab.add(name)
        self.counts = {label: dict(c) for label, c in counts.items()}
        self.totals = {label: sum(c.values()) for label, c in self.counts.items()}
        self.vocab = len(vocab)
        return self

    def known(self, feature: str) -> bool:
        return any(feature in c for c in self.counts.values())

    def log_prior(self, label: str) -> float:
        return math.log(self.docs[label] / sum(self.docs.values()))

    def log_likelihood(self, feature: str, label: str) -> float:
        """ln P(f | k), con el suavizado de Laplace (α) para lo que no ha visto nunca en esa intención."""
        return (math.log(self.counts[label].get(feature, 0.0) + self.alpha)
                - math.log(self.totals[label] + self.alpha * self.vocab))

    def scores(self, raw: dict[str, float]) -> dict[str, float]:
        """ln P(k) + Σ_f n_f · ln P(f | k) de cada intención (los rasgos desconocidos no cuentan)."""
        seen = {f: n for f, n in raw.items() if self.known(f)}
        return {label: self.log_prior(label) + sum(n * self.log_likelihood(f, label) for f, n in seen.items())
                for label in self.labels}


class IntentClassifier:
    LR_WEIGHT = 0.85
    KNN_TEMPERATURE = 0.1

    def __init__(self, epochs: int = 15, lr0: float = 0.5, reg: float = 1e-4, seed: int = 0):
        self.epochs, self.lr0, self.reg, self.seed = epochs, lr0, reg, seed
        self.labels: list[str] = []
        self.fidx: dict[str, int] = {}
        self.W = None
        self.b = None
        self.examples: list[dict] = []
        self.example_labels: list[str] = []
        self.inverted: dict[str, list[tuple[int, float]]] = {}
        self.centroids: dict[str, dict] = {}
        self.history: list[dict] = []
        self.timing: dict[str, float] = {}

    # ------------------------------------------------------------ training
    def fit(self, X: list[dict], y: list[str]) -> "IntentClassifier":
        self.labels = sorted(set(y))
        li = {label: i for i, label in enumerate(self.labels)}
        self.examples, self.example_labels = X, list(y)
        self.fidx = {}
        rows = []
        for x in X:
            idx = np.fromiter((self.fidx.setdefault(f, len(self.fidx)) for f in x), dtype=np.int64,
                              count=len(x))
            rows.append((idx, np.fromiter(x.values(), dtype=np.float64, count=len(x))))
        k, nf = len(self.labels), len(self.fidx)
        W = np.zeros((nf, k))
        b = np.zeros(k)
        self.history = []
        t0 = time.perf_counter()
        if k > 1:
            yi = [li[label] for label in y]
            rng = np.random.default_rng(self.seed)
            order = np.arange(len(X))
            # muestra fija para medir el error tras cada época (curva de aprendizaje)
            probe = rng.choice(len(X), size=min(len(X), 400), replace=False)
            self.history.append(self._measure(rows, yi, probe, W, b, 0))
            for epoch in range(self.epochs):
                rng.shuffle(order)
                lr = self.lr0 / (1 + 0.02 * epoch)
                for n in order:
                    idx, v = rows[n]
                    if not len(idx):
                        continue
                    wi = W[idx]
                    z = v @ wi + b
                    z -= z.max()
                    p = np.exp(z)
                    p /= p.sum()
                    p[yi[n]] -= 1.0
                    W[idx] = wi - lr * (np.outer(v, p) + self.reg * wi)
                    b -= lr * p
                self.history.append(self._measure(rows, yi, probe, W, b, epoch + 1))
        self.W, self.b = W, b
        self.timing = {"sgd": time.perf_counter() - t0}

        t0 = time.perf_counter()
        inverted = defaultdict(list)
        cents = defaultdict(lambda: defaultdict(float))
        for j, (x, label) in enumerate(zip(X, y)):
            for f, v in x.items():
                inverted[f].append((j, v))
                cents[label][f] += v
        self.inverted = dict(inverted)
        self.centroids = {label: _l2(c) for label, c in cents.items()}
        self.timing["index"] = time.perf_counter() - t0
        return self

    @staticmethod
    def _measure(rows, yi, probe, W, b, epoch: int) -> dict:
        """Error medio (entropía cruzada) y aciertos sobre una muestra fija."""
        loss = 0.0
        hits = 0
        for n in probe:
            idx, v = rows[n]
            z = (v @ W[idx] + b) if len(idx) else b.copy()
            z = z - z.max()
            p = np.exp(z)
            p /= p.sum()
            loss -= math.log(max(p[yi[n]], 1e-12))
            hits += int(np.argmax(z) == yi[n])
        count = max(1, len(probe))
        return {"epoch": epoch, "loss": loss / count, "accuracy": hits / count}

    # ---------------------------------------------------------- prediction
    def logits(self, x: dict) -> np.ndarray:
        z = self.b.copy()
        for f, v in x.items():
            i = self.fidx.get(f)
            if i is not None:
                z += v * self.W[i]
        return z

    def example_similarities(self, x: dict) -> dict[int, float]:
        sims: dict[int, float] = defaultdict(float)
        for f, v in x.items():
            for j, xv in self.inverted.get(f, ()):
                sims[j] += v * xv
        return sims

    def predict(self, x: dict, candidates=None) -> list[dict]:
        """Devuelve [{intent, prob, sim}] ordenado de más a menos probable.

        candidates: intenciones permitidas (por contexto); None = todas.
        """
        if not self.labels:
            return []
        allowed = [i for i, label in enumerate(self.labels)
                   if candidates is None or label in candidates]
        if not allowed:
            return []
        z = self.logits(x)[allowed]
        z -= z.max()
        p = np.exp(z)
        p /= p.sum()

        sims = self.example_similarities(x)
        best_ex: dict[str, list[float]] = defaultdict(list)
        for j, s in sims.items():
            best_ex[self.example_labels[j]].append(s)
        rows = []
        for pi, i in zip(p, allowed):
            label = self.labels[i]
            ss = sorted(best_ex.get(label, [0.0]), reverse=True)
            knn = 0.7 * ss[0] + 0.3 * (ss[1] if len(ss) > 1 else ss[0])
            cent = sum(v * self.centroids[label].get(f, 0.0) for f, v in x.items())
            rows.append((label, float(pi), float(max(knn, cent))))
        # Con pocas frases el vecino más cercano es una pista muy fiable: se mezcla
        # la probabilidad del modelo (85 %) con una "probabilidad por parecido" (15 %).
        ex = [math.exp(s / self.KNN_TEMPERATURE) for _, _, s in rows]
        total = sum(ex)
        out = []
        for (label, pi, sim), e in zip(rows, ex):
            mixed = self.LR_WEIGHT * pi + (1 - self.LR_WEIGHT) * e / total
            out.append({"intent": label, "prob": mixed, "sim": sim, "lr": pi})
        out.sort(key=lambda r: r["prob"], reverse=True)
        return out

    def neighbors(self, x: dict, k: int = 5) -> list[tuple[int, float]]:
        sims = self.example_similarities(x)
        return sorted(sims.items(), key=lambda kv: kv[1], reverse=True)[:k]

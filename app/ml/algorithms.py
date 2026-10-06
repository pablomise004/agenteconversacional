"""Algoritmos de machine learning para tablas, escritos con numpy para que se pueda leer cómo aprenden.

Todos tienen la misma forma: `fit(X, y)` aprende, `predict(X)` predice, `predict_proba(X)` da las
probabilidades (clasificación), `learned(ctx)` cuenta lo que ha aprendido y `explain(x, ctx)` explica una
predicción concreta. `to_state()` / `from_state()` los guardan (los arrays van a un .npz).

`X` llega ya preparado (prep.py): escalado para los que miden distancias o suman pesos (`scaled = True`)
y tal cual para los árboles. En clasificación `y` son números de clase (0, 1, 2…); en regresión, números.
"""

from __future__ import annotations

import math

import numpy as np

CLASSIFICATION, REGRESSION, CLUSTERING = "classification", "regression", "clustering"


def softmax(z: np.ndarray) -> np.ndarray:
    z = z - z.max(axis=1, keepdims=True)
    e = np.exp(z)
    return e / e.sum(axis=1, keepdims=True)


def _p(key, label, kind, default, help_, **extra):
    return {"key": key, "label": label, "type": kind, "default": default, "help": help_, **extra}


class Model:
    key = ""
    name = ""
    tasks: tuple[str, ...] = ()
    scaled = True
    PARAMS: list[dict] = []
    summary = ""

    def __init__(self, task: str, **params):
        self.task = task
        self.params = {p["key"]: p["default"] for p in self.param_specs(task)}
        for k, v in params.items():
            if k in self.params:
                self.params[k] = v
        self.n_classes = 0

    @classmethod
    def param_specs(cls, task: str) -> list[dict]:
        return [p for p in cls.PARAMS if not p.get("tasks") or task in p["tasks"]]

    def predict_proba(self, X):
        raise NotImplementedError

    def predict(self, X):
        if self.task == CLASSIFICATION:
            return self.predict_proba(X).argmax(axis=1)
        raise NotImplementedError

    def to_state(self) -> dict:
        return {"key": self.key, "task": self.task, "params": self.params, "nClasses": self.n_classes}

    def _restore(self, state: dict) -> None:
        self.n_classes = state.get("nClasses", 0)

    @classmethod
    def from_state(cls, state: dict) -> "Model":
        m = cls(state["task"], **state["params"])
        m._restore(state)
        return m

    def learned(self, ctx: dict) -> dict:
        return {}

    def explain(self, x: np.ndarray, ctx: dict) -> dict:
        return {}


# ------------------------------------------------------------ línea base
class Baseline(Model):
    key, name = "baseline", "Línea base (adivinar)"
    tasks = (CLASSIFICATION, REGRESSION)
    scaled = False
    summary = "Siempre dice lo más común (la clase más frecuente o la media). Sirve para saber si los demás aprenden algo."

    def fit(self, X, y, progress=None):
        if self.task == CLASSIFICATION:
            counts = np.bincount(y, minlength=self.n_classes).astype(float)
            self.prior = counts / max(1.0, counts.sum())
        else:
            self.mean = float(np.mean(y)) if len(y) else 0.0
        return self

    def predict_proba(self, X):
        return np.tile(self.prior, (len(X), 1))

    def predict(self, X):
        if self.task == CLASSIFICATION:
            return np.full(len(X), int(np.argmax(self.prior)))
        return np.full(len(X), self.mean)

    def to_state(self):
        s = super().to_state()
        s.update(prior=self.prior.tolist() if self.task == CLASSIFICATION else None,
                 mean=None if self.task == CLASSIFICATION else self.mean)
        return s

    def _restore(self, state):
        super()._restore(state)
        if self.task == CLASSIFICATION:
            self.prior = np.array(state["prior"])
        else:
            self.mean = state["mean"]

    def learned(self, ctx):
        if self.task == CLASSIFICATION:
            k = int(np.argmax(self.prior))
            return {"kind": "baseline", "text": f"Dice siempre «{ctx['classes'][k]}», la clase más frecuente "
                                                f"({self.prior[k] * 100:.0f} % de las filas de entrenamiento)."}
        return {"kind": "baseline", "text": f"Dice siempre {self.mean:.4g}, la media de entrenamiento."}

    def explain(self, x, ctx):
        return {"kind": "baseline"}


# ------------------------------------------------------- regresión lineal
class LinearRegression(Model):
    key, name = "linear", "Regresión lineal"
    tasks = (REGRESSION,)
    summary = "Suma cada columna multiplicada por un peso. Los pesos se calculan de una vez (mínimos cuadrados)."
    PARAMS = [_p("l2", "Regularización (ridge)", "float", 0.0,
                 "Castiga los pesos grandes. Con 0 es la regresión lineal de toda la vida; más alto, pesos más "
                 "pequeños y prudentes.", min=0, max=10, step=0.1)]

    def fit(self, X, y, progress=None):
        self.x_mean = X.mean(axis=0)
        self.y_mean = float(y.mean())
        Xc, yc = X - self.x_mean, y - self.y_mean
        lam = float(self.params["l2"])
        if lam > 0:
            A = Xc.T @ Xc + lam * len(X) * np.eye(X.shape[1])
            self.w = np.linalg.solve(A, Xc.T @ yc)
        else:
            self.w = np.linalg.lstsq(Xc, yc, rcond=None)[0]
        self.b = self.y_mean - float(self.x_mean @ self.w)
        return self

    def predict(self, X):
        return X @ self.w + self.b

    def to_state(self):
        s = super().to_state()
        s.update(w=self.w, b=self.b, x_mean=self.x_mean, y_mean=self.y_mean)
        return s

    def _restore(self, state):
        super()._restore(state)
        self.w, self.b = np.asarray(state["w"], dtype=float), float(state["b"])
        self.x_mean, self.y_mean = np.asarray(state["x_mean"], dtype=float), float(state["y_mean"])

    def learned(self, ctx):
        names, std = ctx["features"], ctx["std"]
        coefs = [{"feature": n, "weight": float(w), "perUnit": float(w / s) if ctx["scaleMask"][j] else None}
                 for j, (n, w, s) in enumerate(zip(names, self.w, std))]
        coefs.sort(key=lambda c: -abs(c["weight"]))
        return {"kind": "linear", "intercept": self.b, "mean": self.y_mean, "coefficients": coefs}

    def explain(self, x, ctx):
        contrib = self.w * (x - self.x_mean)
        items = [{"feature": n, "value": float(c)} for n, c in zip(ctx["features"], contrib)]
        items.sort(key=lambda c: -abs(c["value"]))
        return {"kind": "additive", "start": self.y_mean, "startLabel": "media de entrenamiento",
                "contributions": items, "total": float(self.y_mean + contrib.sum())}


# ----------------------------------------------------- regresión logística
class LogisticRegression(Model):
    key, name = "logistic", "Regresión logística"
    tasks = (CLASSIFICATION,)
    summary = "Da a cada clase una puntuación (suma de columnas por pesos) y la convierte en probabilidad. Aprende los pesos poco a poco (descenso por gradiente)."
    PARAMS = [
        _p("epochs", "Vueltas (épocas)", "int", 300, "Cuántas veces repasa todos los datos para corregir los pesos.",
           min=20, max=1000, step=10),
        _p("lr", "Tasa de aprendizaje", "float", 0.5, "Lo grande que es cada corrección. Muy grande: da saltos y no "
           "se asienta; muy pequeña: aprende muy despacio.", min=0.01, max=2, step=0.01),
        _p("l2", "Regularización", "float", 0.001, "Castiga los pesos grandes para que no se aprenda los datos de memoria.",
           min=0, max=0.5, step=0.001),
    ]

    def fit(self, X, y, progress=None):
        n, d = X.shape
        K = self.n_classes
        Y = np.eye(K)[y]
        self.W = np.zeros((d, K))
        self.b = np.zeros(K)
        lr, l2, epochs = float(self.params["lr"]), float(self.params["l2"]), int(self.params["epochs"])
        every = max(1, epochs // 60)
        self.history = []
        for ep in range(epochs + 1):
            P = softmax(X @ self.W + self.b)
            if ep % every == 0 or ep == epochs:
                loss = float(-np.mean(np.log(P[np.arange(n), y] + 1e-12)))
                acc = float(np.mean(P.argmax(axis=1) == y))
                self.history.append({"epoch": ep, "loss": loss, "accuracy": acc})
                if progress:
                    progress(ep / epochs, f"vuelta {ep}: error {loss:.3f}")
            if ep == epochs:
                break
            G = (P - Y) / n
            self.W -= lr * (X.T @ G + l2 * self.W)
            self.b -= lr * G.sum(axis=0)
        return self

    def predict_proba(self, X):
        return softmax(X @ self.W + self.b)

    def to_state(self):
        s = super().to_state()
        s.update(W=self.W, b=self.b, history=self.history)
        return s

    def _restore(self, state):
        super()._restore(state)
        self.W, self.b = np.asarray(state["W"], dtype=float), np.asarray(state["b"], dtype=float)
        self.history = state.get("history", [])

    def learned(self, ctx):
        names, classes = ctx["features"], ctx["classes"]
        per_class = []
        for k, c in enumerate(classes):
            w = self.W[:, k]
            order = np.argsort(-np.abs(w))[:8]
            per_class.append({"class": c, "bias": float(self.b[k]),
                              "weights": [{"feature": names[j], "weight": float(w[j])} for j in order]})
        return {"kind": "logistic", "history": self.history, "perClass": per_class}

    def explain(self, x, ctx):
        z = x @ self.W + self.b
        k = int(np.argmax(z))
        contrib = self.W[:, k] * x
        items = [{"feature": n, "value": float(c)} for n, c in zip(ctx["features"], contrib)]
        items.sort(key=lambda c: -abs(c["value"]))
        return {"kind": "additive", "start": float(self.b[k]), "startLabel": "punto de partida de la clase",
                "contributions": items, "total": float(z[k]), "class": ctx["classes"][k],
                "scores": [{"class": c, "score": float(v)} for c, v in zip(ctx["classes"], z)]}


# ------------------------------------------------------- árbol de decisión
class _Tree:
    """Un árbol de decisión (CART) guardado en arrays: en cada nodo, una pregunta «columna ≤ umbral»."""

    def __init__(self):
        self.feature = np.zeros(0, dtype=int)

    @classmethod
    def build(cls, X, y, task, n_classes, max_depth, min_leaf, max_features=None, criterion="gini", rng=None):
        t = cls()
        n, d = X.shape
        cls_task = task == CLASSIFICATION
        onehot = np.eye(n_classes) if cls_task else None
        feature, threshold, left, right, value, count, impurity = [], [], [], [], [], [], []
        importance = np.zeros(d)

        def node_stats(yn):
            if cls_task:
                counts = np.bincount(yn, minlength=n_classes).astype(float)
                p = counts / max(1.0, counts.sum())
                imp = float(1 - np.sum(p ** 2)) if criterion == "gini" else float(-np.sum(p[p > 0] * np.log2(p[p > 0])))
                return p, imp
            mean = float(yn.mean())
            return mean, float(np.mean((yn - mean) ** 2))

        def new_node(yn):
            val, imp = node_stats(yn)
            feature.append(-1)
            threshold.append(0.0)
            left.append(-1)
            right.append(-1)
            value.append(val)
            count.append(len(yn))
            impurity.append(imp)
            return len(feature) - 1

        root = new_node(y)
        stack = [(root, np.arange(n), 0)]
        while stack:
            node, idx, depth = stack.pop()
            imp = impurity[node]
            if depth >= max_depth or len(idx) < 2 * min_leaf or imp <= 1e-12:
                continue
            Xn, yn = X[idx], y[idx]
            m = len(idx)
            feats = np.arange(d) if not max_features or max_features >= d else rng.choice(d, max_features, replace=False)
            best = None
            best_score = imp - 1e-12
            lo, hi = min_leaf - 1, m - min_leaf - 1
            if hi < lo:
                continue
            nl = np.arange(1, m, dtype=float)
            nr = m - nl
            for j in feats:
                x = Xn[:, j]
                order = np.argsort(x, kind="stable")
                xs = x[order]
                valid = xs[:-1] < xs[1:]
                valid[:lo] = False
                valid[hi + 1:] = False
                if not valid.any():
                    continue
                if cls_task:
                    cum = np.cumsum(onehot[yn[order]], axis=0)
                    lc, total = cum[:-1], cum[-1]
                    rc = total - lc
                    pl, pr = lc / nl[:, None], rc / nr[:, None]
                    if criterion == "gini":
                        il, ir = 1 - np.sum(pl ** 2, axis=1), 1 - np.sum(pr ** 2, axis=1)
                    else:
                        with np.errstate(divide="ignore", invalid="ignore"):
                            il = -np.nansum(np.where(pl > 0, pl * np.log2(pl), 0), axis=1)
                            ir = -np.nansum(np.where(pr > 0, pr * np.log2(pr), 0), axis=1)
                    score = (nl * il + nr * ir) / m
                else:
                    ys = yn[order]
                    cs, cs2 = np.cumsum(ys)[:-1], np.cumsum(ys ** 2)[:-1]
                    tot, tot2 = ys.sum(), (ys ** 2).sum()
                    sse = (cs2 - cs ** 2 / nl) + ((tot2 - cs2) - (tot - cs) ** 2 / nr)
                    score = sse / m
                score = np.where(valid, score, np.inf)
                i = int(np.argmin(score))
                if score[i] < best_score:
                    best_score = float(score[i])
                    best = (int(j), float((xs[i] + xs[i + 1]) / 2))
            if best is None:
                continue
            j, thr = best
            mask = Xn[:, j] <= thr
            li, ri = idx[mask], idx[~mask]
            importance[j] += m * (imp - best_score)
            feature[node], threshold[node] = j, thr
            left[node] = new_node(y[li])
            right[node] = new_node(y[ri])
            stack.append((right[node], ri, depth + 1))
            stack.append((left[node], li, depth + 1))
        t.feature = np.array(feature, dtype=int)
        t.threshold = np.array(threshold, dtype=float)
        t.left = np.array(left, dtype=int)
        t.right = np.array(right, dtype=int)
        t.value = np.array(value, dtype=float)
        t.count = np.array(count, dtype=int)
        t.impurity = np.array(impurity, dtype=float)
        t.importance = importance / n
        return t

    def apply(self, X) -> np.ndarray:
        node = np.zeros(len(X), dtype=int)
        active = self.feature[node] >= 0
        while active.any():
            idx = np.nonzero(active)[0]
            cur = node[idx]
            go_left = X[idx, self.feature[cur]] <= self.threshold[cur]
            node[idx] = np.where(go_left, self.left[cur], self.right[cur])
            active[idx] = self.feature[node[idx]] >= 0
        return node

    def path(self, x) -> list[int]:
        node, out = 0, [0]
        while self.feature[node] >= 0:
            node = self.left[node] if x[self.feature[node]] <= self.threshold[node] else self.right[node]
            out.append(int(node))
        return out

    def depth(self) -> int:
        depth = np.zeros(len(self.feature), dtype=int)
        for i in range(len(self.feature)):
            if self.feature[i] >= 0:
                depth[self.left[i]] = depth[self.right[i]] = depth[i] + 1
        return int(depth.max()) if len(depth) else 0

    def arrays(self, prefix=""):
        return {f"{prefix}feature": self.feature, f"{prefix}threshold": self.threshold, f"{prefix}left": self.left,
                f"{prefix}right": self.right, f"{prefix}value": self.value, f"{prefix}count": self.count,
                f"{prefix}impurity": self.impurity}

    @classmethod
    def from_arrays(cls, a: dict, prefix=""):
        t = cls()
        t.feature = np.asarray(a[f"{prefix}feature"], dtype=int)
        t.threshold = np.asarray(a[f"{prefix}threshold"], dtype=float)
        t.left = np.asarray(a[f"{prefix}left"], dtype=int)
        t.right = np.asarray(a[f"{prefix}right"], dtype=int)
        t.value = np.asarray(a[f"{prefix}value"], dtype=float)
        t.count = np.asarray(a[f"{prefix}count"], dtype=int)
        t.impurity = np.asarray(a[f"{prefix}impurity"], dtype=float)
        return t

    def to_json(self, ctx: dict, max_depth: int = 6, highlight: list[int] | None = None) -> dict:
        """El árbol para dibujarlo (hasta `max_depth` niveles), con cada pregunta en palabras."""
        hl = set(highlight or [])

        def walk(i, depth):
            node = {"id": int(i), "n": int(self.count[i]), "impurity": float(self.impurity[i]), "on": i in hl}
            v = self.value[i]
            if ctx["task"] == CLASSIFICATION:
                node["dist"] = [float(p) for p in v]
                node["label"] = ctx["classes"][int(np.argmax(v))]
            else:
                node["mean"] = float(v)
            if self.feature[i] >= 0:
                node["question"] = question(ctx, int(self.feature[i]), float(self.threshold[i]))
                if depth < max_depth:
                    node["children"] = [walk(self.left[i], depth + 1), walk(self.right[i], depth + 1)]
                else:
                    node["more"] = True
            return node

        return walk(0, 0)


def question(ctx: dict, j: int, thr: float) -> dict:
    """La pregunta de un nodo en palabras: «aleta_mm ≤ 206,5» o «isla = Dream» (rasgos de 0/1)."""
    name = ctx["features"][j]
    if not ctx["scaleMask"][j] and " = " in name:  # columna de 0/1 (one-hot): la respuesta es sí o no
        col, _, val = name.partition(" = ")
        return {"feature": name, "column": col, "category": val, "yes": "no es", "text": f"{col} = {val}",
                "leftIs": "no", "threshold": thr}
    return {"feature": name, "column": name, "text": f"{name} ≤ {thr:.4g}", "threshold": thr, "leftIs": "yes"}


class DecisionTree(Model):
    key, name = "tree", "Árbol de decisión"
    tasks = (CLASSIFICATION, REGRESSION)
    scaled = False
    summary = "Hace preguntas de sí o no sobre las columnas («¿aleta ≤ 206 mm?») hasta llegar a una respuesta."
    PARAMS = [
        _p("max_depth", "Profundidad máxima", "int", 5, "Cuántas preguntas seguidas puede hacer. Más profundo aprende más "
           "detalles, pero puede aprenderse los datos de memoria (sobreajuste).", min=1, max=15, step=1),
        _p("min_leaf", "Mínimo de filas por hoja", "int", 2, "Una pregunta solo se hace si a cada lado quedan al menos "
           "estas filas. Más alto: un árbol más prudente.", min=1, max=50, step=1),
        _p("criterion", "Cómo mide la mezcla", "choice", "gini", "Lo mezcladas que están las clases en un grupo: "
           "índice de Gini o entropía. Suelen dar árboles muy parecidos.", tasks=(CLASSIFICATION,),
           options=[{"value": "gini", "label": "Gini"}, {"value": "entropy", "label": "Entropía"}]),
    ]

    def fit(self, X, y, progress=None):
        self.tree = _Tree.build(X, y, self.task, self.n_classes, int(self.params["max_depth"]), int(self.params["min_leaf"]),
                                criterion=self.params.get("criterion", "gini"))
        return self

    def predict_proba(self, X):
        return self.tree.value[self.tree.apply(X)]

    def predict(self, X):
        v = self.tree.value[self.tree.apply(X)]
        return v.argmax(axis=1) if self.task == CLASSIFICATION else v

    def to_state(self):
        s = super().to_state()
        s.update(self.tree.arrays())
        s["importance"] = self.tree.importance
        return s

    def _restore(self, state):
        super()._restore(state)
        self.tree = _Tree.from_arrays(state)
        self.tree.importance = np.asarray(state["importance"], dtype=float)

    def learned(self, ctx):
        return {"kind": "tree", "tree": self.tree.to_json(ctx), "nodes": int(len(self.tree.feature)),
                "leaves": int(np.sum(self.tree.feature < 0)), "depth": self.tree.depth(),
                "importance": importance_items(ctx, self.tree.importance)}

    def explain(self, x, ctx):
        path = self.tree.path(x)
        steps = []
        for a, b in zip(path, path[1:]):
            q = question(ctx, int(self.tree.feature[a]), float(self.tree.threshold[a]))
            went_left = b == self.tree.left[a]
            steps.append({"question": q, "value": float(x[self.tree.feature[a]]), "answer": went_left})
        return {"kind": "path", "steps": steps, "leaf": int(path[-1]), "tree": self.tree.to_json(ctx, highlight=path)}


def importance_items(ctx: dict, imp: np.ndarray) -> list[dict]:
    """Importancia de cada columna original (sumando sus rasgos), de mayor a menor, en tanto por uno."""
    by_col = np.zeros(len(ctx["columns"]))
    for j, k in enumerate(ctx["columnOf"]):
        by_col[k] += imp[j]
    total = by_col.sum()
    if total > 0:
        by_col = by_col / total
    items = [{"column": c, "value": float(v)} for c, v in zip(ctx["columns"], by_col)]
    return sorted(items, key=lambda i: -i["value"])


# ---------------------------------------------------------- bosque aleatorio
class RandomForest(Model):
    key, name = "forest", "Bosque aleatorio"
    tasks = (CLASSIFICATION, REGRESSION)
    scaled = False
    summary = "Muchos árboles, cada uno aprendiendo con una muestra distinta de filas y de columnas, que votan juntos."
    PARAMS = [
        _p("n_trees", "Número de árboles", "int", 50, "Cada árbol aprende con una muestra distinta de filas y vota. Más "
           "árboles: más estable, pero más lento.", min=5, max=200, step=5),
        _p("max_depth", "Profundidad máxima", "int", 10, "Lo profundo que puede ser cada árbol.", min=1, max=20, step=1),
        _p("min_leaf", "Mínimo de filas por hoja", "int", 1, "Filas mínimas a cada lado de una pregunta.",
           min=1, max=50, step=1),
        _p("max_features", "Columnas en cada pregunta", "choice", "sqrt", "Cuántas columnas puede mirar cada pregunta, "
           "elegidas al azar: así los árboles salen distintos entre sí y el voto es mejor.",
           options=[{"value": "sqrt", "label": "Raíz cuadrada"}, {"value": "third", "label": "Un tercio"},
                    {"value": "all", "label": "Todas"}]),
    ]

    def fit(self, X, y, progress=None):
        n, d = X.shape
        rng = np.random.default_rng(7)
        mf = {"sqrt": max(1, int(math.sqrt(d))), "third": max(1, d // 3), "all": d}[self.params["max_features"]]
        self.trees = []
        imp = np.zeros(d)
        n_trees = int(self.params["n_trees"])
        for t in range(n_trees):
            sample = rng.integers(0, n, n)
            tree = _Tree.build(X[sample], y[sample], self.task, self.n_classes, int(self.params["max_depth"]),
                               int(self.params["min_leaf"]), max_features=mf, rng=rng)
            imp += tree.importance
            self.trees.append(tree)
            if progress and (t % 5 == 4 or t == n_trees - 1):
                progress((t + 1) / n_trees, f"árbol {t + 1} de {n_trees}")
        self.importance = imp / max(1, n_trees)
        return self

    def tree_outputs(self, X) -> np.ndarray:
        return np.stack([t.value[t.apply(X)] for t in self.trees])

    def predict_proba(self, X):
        return self.tree_outputs(X).mean(axis=0)

    def predict(self, X):
        out = self.tree_outputs(X).mean(axis=0)
        return out.argmax(axis=1) if self.task == CLASSIFICATION else out

    def to_state(self):
        s = super().to_state()
        s["nTrees"] = len(self.trees)
        for i, t in enumerate(self.trees):
            s.update(t.arrays(f"t{i}_"))
        s["importance"] = self.importance
        return s

    def _restore(self, state):
        super()._restore(state)
        self.trees = [_Tree.from_arrays(state, f"t{i}_") for i in range(int(state["nTrees"]))]
        self.importance = np.asarray(state["importance"], dtype=float)

    def learned(self, ctx):
        sizes = [len(t.feature) for t in self.trees]
        return {"kind": "forest", "trees": len(self.trees), "avgNodes": float(np.mean(sizes)),
                "importance": importance_items(ctx, self.importance),
                "example": self.trees[0].to_json(ctx, max_depth=3)}

    def explain(self, x, ctx):
        outs = self.tree_outputs(x[None, :])[:, 0]
        if self.task == CLASSIFICATION:
            votes = np.bincount(outs.argmax(axis=1), minlength=self.n_classes)
            return {"kind": "votes", "votes": [{"class": c, "votes": int(v)} for c, v in zip(ctx["classes"], votes)],
                    "trees": len(self.trees)}
        return {"kind": "spread", "values": [float(v) for v in outs], "mean": float(outs.mean()),
                "min": float(outs.min()), "max": float(outs.max()), "trees": len(self.trees)}


# ---------------------------------------------------------------- vecinos
def sq_distances(A: np.ndarray, B: np.ndarray) -> np.ndarray:
    """Distancias al cuadrado entre las filas de A y las de B: |a|² + |b|² − 2·a·b (sin bucles)."""
    d = (A ** 2).sum(axis=1)[:, None] + (B ** 2).sum(axis=1)[None, :] - 2 * A @ B.T
    return np.maximum(d, 0)


class KNN(Model):
    key, name = "knn", "k vecinos más cercanos"
    tasks = (CLASSIFICATION, REGRESSION)
    summary = "No aprende pesos: guarda las filas y, para predecir, busca las k más parecidas y las pone de acuerdo."
    PARAMS = [
        _p("k", "Vecinos (k)", "int", 5, "Cuántas filas parecidas consulta. Pocos: se fía de casos sueltos; muchos: lo "
           "suaviza todo.", min=1, max=30, step=1),
        _p("weights", "Peso de cada vecino", "choice", "uniform", "Todos cuentan igual, o los más cercanos cuentan más.",
           options=[{"value": "uniform", "label": "Todos igual"}, {"value": "distance", "label": "Más el más cercano"}]),
    ]

    def fit(self, X, y, progress=None):
        self.X, self.y = X.copy(), y.copy()
        return self

    def neighbors(self, X, k=None):
        k = min(int(k or self.params["k"]), len(self.X))
        idx_all, dist_all = [], []
        for s in range(0, len(X), 512):
            d = sq_distances(X[s:s + 512], self.X)
            idx = np.argpartition(d, k - 1, axis=1)[:, :k]
            dd = np.take_along_axis(d, idx, axis=1)
            order = np.argsort(dd, axis=1)
            idx_all.append(np.take_along_axis(idx, order, axis=1))
            dist_all.append(np.sqrt(np.take_along_axis(dd, order, axis=1)))
        return np.vstack(idx_all), np.vstack(dist_all)

    def _weights(self, dist):
        if self.params["weights"] == "distance":
            return 1.0 / (dist + 1e-9)
        return np.ones_like(dist)

    def predict_proba(self, X):
        idx, dist = self.neighbors(X)
        w = self._weights(dist)
        P = np.zeros((len(X), self.n_classes))
        labels = self.y[idx]
        for k in range(self.n_classes):
            P[:, k] = (w * (labels == k)).sum(axis=1)
        return P / P.sum(axis=1, keepdims=True)

    def predict(self, X):
        if self.task == CLASSIFICATION:
            return self.predict_proba(X).argmax(axis=1)
        idx, dist = self.neighbors(X)
        w = self._weights(dist)
        return (w * self.y[idx]).sum(axis=1) / w.sum(axis=1)

    def to_state(self):
        s = super().to_state()
        s.update(X=self.X, y=self.y)
        return s

    def _restore(self, state):
        super()._restore(state)
        self.X = np.asarray(state["X"], dtype=float)
        self.y = np.asarray(state["y"], dtype=int if self.task == CLASSIFICATION else float)

    def learned(self, ctx):
        return {"kind": "knn", "rows": int(len(self.X)),
                "text": f"Guarda las {len(self.X)} filas de entrenamiento. Para predecir mira las {self.params['k']} más "
                        "parecidas (distancia euclídea con los números escalados)."}

    def explain(self, x, ctx):
        idx, dist = self.neighbors(x[None, :])
        out = []
        for i, d in zip(idx[0], dist[0]):
            row = {"index": int(i), "distance": float(d)}
            if self.task == CLASSIFICATION:
                row["label"] = ctx["classes"][int(self.y[i])]
            else:
                row["value"] = float(self.y[i])
            if ctx.get("trainRows") is not None:
                row["row"] = int(ctx["trainRows"][i])
            out.append(row)
        return {"kind": "neighbors", "neighbors": out}


# ------------------------------------------------------------- Naive Bayes
class NaiveBayes(Model):
    key, name = "bayes", "Naive Bayes"
    tasks = (CLASSIFICATION,)
    scaled = False
    summary = "Calcula, con el teorema de Bayes, lo probable que es cada clase mirando cada columna por separado."
    PARAMS = [_p("alpha", "Suavizado (Laplace)", "float", 1.0, "Cuenta inventada que se suma a cada categoría: así una "
                 "que no salió con una clase no le da probabilidad cero.", min=0, max=5, step=0.1)]

    def fit(self, X, y, progress=None):
        K = self.n_classes
        groups = self.groups
        counts = np.bincount(y, minlength=K).astype(float)
        self.log_prior = np.log((counts + 1e-9) / counts.sum())
        alpha = float(self.params["alpha"])
        self.num, self.cat = [], []
        for g in groups:
            cols = slice(g["start"], g["end"])
            if g["kind"] == "category":
                Xi = X[:, cols]
                table = np.stack([Xi[y == k].sum(axis=0) for k in range(K)])  # K × categorías
                probs = (table + alpha) / (table.sum(axis=1, keepdims=True) + alpha * Xi.shape[1])
                self.cat.append({"start": g["start"], "end": g["end"], "column": g["column"],
                                 "logp": np.log(np.maximum(probs, 1e-12))})
            else:
                for j in range(g["start"], g["end"]):
                    v = X[:, j]
                    means = np.array([v[y == k].mean() if counts[k] else 0.0 for k in range(K)])
                    var = np.array([v[y == k].var() if counts[k] else 1.0 for k in range(K)])
                    var = var + 1e-9 * max(1.0, float(v.var()))
                    self.num.append({"j": j, "column": g["column"], "mean": means, "var": np.maximum(var, 1e-12)})
        return self

    def _parts(self, X):
        """Log-verosimilitud que aporta cada columna a cada clase (n × K por columna)."""
        parts = []
        for nb in self.num:
            v = X[:, nb["j"]][:, None]
            parts.append((nb["column"], -0.5 * (np.log(2 * np.pi * nb["var"]) + (v - nb["mean"]) ** 2 / nb["var"])))
        for c in self.cat:
            Xi = X[:, c["start"]:c["end"]]
            known = Xi.sum(axis=1) > 0
            ll = Xi @ c["logp"].T
            ll[~known] = 0.0  # valor nuevo: esa columna no inclina hacia ninguna clase
            parts.append((c["column"], ll))
        return parts

    def joint(self, X):
        out = np.tile(self.log_prior, (len(X), 1))
        for _, ll in self._parts(X):
            out = out + ll
        return out

    def predict_proba(self, X):
        return softmax(self.joint(X))

    def to_state(self):
        s = super().to_state()
        s["logPrior"] = self.log_prior
        s["num"] = [{"j": n["j"], "column": n["column"], "mean": n["mean"].tolist(), "var": n["var"].tolist()} for n in self.num]
        s["cat"] = [{"start": c["start"], "end": c["end"], "column": c["column"], "logp": c["logp"].tolist()} for c in self.cat]
        return s

    def _restore(self, state):
        super()._restore(state)
        self.log_prior = np.asarray(state["logPrior"], dtype=float)
        self.num = [{"j": n["j"], "column": n["column"], "mean": np.array(n["mean"]), "var": np.array(n["var"])}
                    for n in state["num"]]
        self.cat = [{"start": c["start"], "end": c["end"], "column": c["column"], "logp": np.array(c["logp"])}
                    for c in state["cat"]]

    def learned(self, ctx):
        classes = ctx["classes"]
        prior = np.exp(self.log_prior)
        nums = [{"column": n["column"], "mean": [float(m) for m in n["mean"]], "std": [float(math.sqrt(v)) for v in n["var"]]}
                for n in self.num]
        cats = []
        for c in self.cat:
            values = [ctx["features"][j].partition(" = ")[2] for j in range(c["start"], c["end"])]
            cats.append({"column": c["column"], "values": values, "probs": np.exp(c["logp"]).tolist()})
        return {"kind": "bayes", "classes": classes, "prior": prior.tolist(), "numeric": nums, "categorical": cats}

    def explain(self, x, ctx):
        X = x[None, :]
        joint = self.joint(X)[0]
        order = np.argsort(-joint)
        a, b = int(order[0]), int(order[1]) if len(order) > 1 else int(order[0])
        items = [{"feature": col, "value": float(ll[0, a] - ll[0, b])} for col, ll in self._parts(X)]
        items.sort(key=lambda i: -abs(i["value"]))
        return {"kind": "additive", "start": float(self.log_prior[a] - self.log_prior[b]),
                "startLabel": "lo frecuente que es cada clase", "contributions": items,
                "total": float(joint[a] - joint[b]), "class": ctx["classes"][a], "versus": ctx["classes"][b],
                "units": "log"}


# ---------------------------------------------------------------- k-medias
def kmeans_once(X, k, rng, max_iter=100, tol=1e-6):
    """Una pasada de k-medias con inicio k-means++. Devuelve centros, grupos e historia de la inercia."""
    n = len(X)
    centers = [X[rng.integers(n)]]
    for _ in range(1, k):
        d = sq_distances(X, np.array(centers)).min(axis=1)
        total = d.sum()
        probs = d / total if total > 0 else np.full(n, 1 / n)
        centers.append(X[rng.choice(n, p=probs)])
    C = np.array(centers, dtype=float)
    history = []
    prev = np.inf
    for _ in range(max_iter):
        d = sq_distances(X, C)
        labels = d.argmin(axis=1)
        inertia = float(d[np.arange(n), labels].sum())
        history.append(inertia)
        for j in range(k):
            members = X[labels == j]
            C[j] = members.mean(axis=0) if len(members) else X[rng.integers(n)]
        if prev - inertia <= tol * max(1.0, prev):
            break
        prev = inertia
    d = sq_distances(X, C)
    labels = d.argmin(axis=1)
    return C, labels, float(d[np.arange(n), labels].sum()), history


def silhouette(X: np.ndarray, labels: np.ndarray, max_n: int = 1500, seed: int = 0) -> float:
    """Silueta media: para cada punto, (b − a) / max(a, b), con a = distancia media a los de su grupo y b = a los
    del grupo vecino más cercano. Cerca de 1, grupos bien separados; cerca de 0, mezclados."""
    n = len(X)
    if len(np.unique(labels)) < 2:
        return 0.0
    if n > max_n:
        idx = np.random.default_rng(seed).choice(n, max_n, replace=False)
        X, labels = X[idx], labels[idx]
    D = np.sqrt(sq_distances(X, X))
    ks = np.unique(labels)
    scores = []
    for i in range(len(X)):
        own = labels[i]
        same = labels == own
        if same.sum() <= 1:
            scores.append(0.0)
            continue
        a = D[i, same].sum() / (same.sum() - 1)
        b = min(D[i, labels == k].mean() for k in ks if k != own)
        scores.append((b - a) / max(a, b) if max(a, b) > 0 else 0.0)
    return float(np.mean(scores))


class KMeans(Model):
    key, name = "kmeans", "k-medias"
    tasks = (CLUSTERING,)
    summary = "Coloca k centros y repite: cada fila va con su centro más cercano y cada centro se mueve a la media de su grupo."
    PARAMS = [
        _p("k", "Número de grupos (k)", "int", 0, "0 = que lo elija solo: prueba de 2 a 8 grupos y se queda con el de "
           "mejor silueta.", min=0, max=10, step=1),
        _p("n_init", "Intentos", "int", 5, "Cuántas veces empieza con centros distintos; se queda con el mejor.",
           min=1, max=20, step=1),
    ]

    def fit(self, X, y=None, progress=None):
        rng = np.random.default_rng(3)
        k_param = int(self.params["k"])
        ks = [k_param] if k_param >= 2 else list(range(2, min(8, len(X) - 1) + 1))
        self.search = []
        best = None
        for idx, k in enumerate(ks):
            runs = [kmeans_once(X, k, rng) for _ in range(int(self.params["n_init"]))]
            C, labels, inertia, history = min(runs, key=lambda r: r[2])
            sil = silhouette(X, labels)
            self.search.append({"k": k, "inertia": inertia, "silhouette": sil})
            if best is None or (k_param < 2 and sil > best[4]) or k_param >= 2:
                best = (C, labels, inertia, history, sil, k)
            if progress:
                progress((idx + 1) / len(ks), f"k = {k}: silueta {sil:.3f}")
        self.centers, self.labels_, self.inertia, self.history, self.sil, self.k = best
        self.n_classes = self.k
        return self

    def predict(self, X):
        return sq_distances(X, self.centers).argmin(axis=1)

    def to_state(self):
        s = super().to_state()
        s.update(centers=self.centers, inertia=self.inertia, history=self.history, silhouette=self.sil, k=self.k,
                 search=self.search)
        return s

    def _restore(self, state):
        super()._restore(state)
        self.centers = np.asarray(state["centers"], dtype=float)
        self.inertia, self.history, self.sil = state["inertia"], state["history"], state["silhouette"]
        self.k, self.search = int(state["k"]), state.get("search", [])

    def learned(self, ctx):
        return {"kind": "kmeans", "k": self.k, "inertia": self.inertia, "silhouette": self.sil,
                "history": self.history, "search": self.search}

    def explain(self, x, ctx):
        d = np.sqrt(sq_distances(x[None, :], self.centers)[0])
        return {"kind": "centroids", "distances": [{"group": int(j) + 1, "distance": float(v)} for j, v in enumerate(d)],
                "group": int(np.argmin(d)) + 1}


ALGORITHMS: dict[str, type[Model]] = {m.key: m for m in
                                      (Baseline, LinearRegression, LogisticRegression, DecisionTree, RandomForest, KNN,
                                       NaiveBayes, KMeans)}


def make(key: str, task: str, params: dict | None = None, n_classes: int = 0, groups=None) -> Model:
    cls = ALGORITHMS[key]
    if task not in cls.tasks:
        raise ValueError(f"{cls.name} no sirve para esta tarea")
    m = cls(task, **(params or {}))
    m.n_classes = n_classes
    m.groups = groups or []
    return m


def catalog(task: str) -> list[dict]:
    """Los algoritmos de una tarea con sus ajustes, para el formulario de la consola."""
    return [{"key": c.key, "name": c.name, "summary": c.summary, "params": c.param_specs(task)}
            for c in ALGORITHMS.values() if task in c.tasks and c.key != "baseline"]

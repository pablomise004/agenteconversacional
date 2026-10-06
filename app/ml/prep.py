"""Preparar los datos: de una fila de la tabla a una lista de números que entiende un algoritmo.

Lo que se aprende con las filas de entrenamiento (y se guarda con el modelo para usarlo igual al predecir):

1. Rellenar los vacíos: los números con la mediana; las categorías, con su propia categoría «(vacío)».
2. Fechas → tres números: año, mes y día de la semana.
3. Categorías → una columna de 0/1 por valor («isla = Dream»): codificación one-hot. Las poco frecuentes
   (más allá de las 30 primeras) se juntan en «(otras)».
4. Escalar los números (estandarizar): restar la media y dividir por la desviación típica, para que todos
   pesen parecido. Lo necesitan los algoritmos que miden distancias o suman pesos (vecinos, logística,
   lineal, k-medias); los árboles trabajan con los valores tal cual, que se leen mejor («aleta ≤ 206 mm»).
"""

from __future__ import annotations

from datetime import date

import numpy as np

from .table import CATEGORY, DATE, NUMBER, format_number, is_missing, to_date, to_number

MAX_CATEGORIES = 30
EMPTY = "(vacío)"
OTHER = "(otras)"
DATE_PARTS = ("año", "mes", "día de la semana")
WEEKDAYS = ("lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo")


def _date_parts(d: date | None) -> tuple[float, float, float]:
    return (np.nan, np.nan, np.nan) if d is None else (float(d.year), float(d.month), float(d.weekday()))


def parse_value(value, kind: str):
    """Un valor que llega de fuera (JSON del formulario o de la API) convertido como en la tabla."""
    if value is None:
        return np.nan if kind == NUMBER else None
    if kind == NUMBER:
        if isinstance(value, bool):
            return float(value)
        if isinstance(value, (int, float)):
            return float(value)
        s = str(value)
        if is_missing(s):
            return np.nan
        v = to_number(s, ",") if "," in s and "." not in s else to_number(s, ".")
        return np.nan if v is None else v
    s = str(value).strip()
    if is_missing(s):
        return None
    if kind == DATE:
        return to_date(s)
    if isinstance(value, float) and value.is_integer():
        return format_number(value)
    return s


class Preparer:
    """Convierte columnas (número, categoría o fecha) en una matriz de números."""

    def __init__(self, features: list[dict]):
        self.features = [{"name": f["name"], "kind": f["kind"]} for f in features]
        self.specs: list[dict] = []
        self.feature_names: list[str] = []
        self.groups: list[dict] = []
        self.mean = np.zeros(0)
        self.std = np.ones(0)
        self.scale_mask = np.zeros(0, dtype=bool)

    # ------------------------------------------------------------ aprender
    def fit(self, cols: dict) -> "Preparer":
        """`cols`: nombre → valores ya convertidos (array con NaN para números; lista con None si no)."""
        self.specs, names, groups, scale = [], [], [], []
        for f in self.features:
            name, kind, values = f["name"], f["kind"], cols[f["name"]]
            start = len(names)
            if kind == NUMBER:
                v = np.asarray(values, dtype=float)
                present = v[~np.isnan(v)]
                fill = float(np.median(present)) if len(present) else 0.0
                spec = {"name": name, "kind": kind, "missing": int(np.isnan(v).sum()), "fill": fill}
                names.append(name)
                scale.append(True)
            elif kind == DATE:
                parts = np.array([_date_parts(d) for d in values], dtype=float).reshape(-1, 3)
                fills = [float(np.nanmedian(parts[:, k])) if np.any(~np.isnan(parts[:, k])) else 0.0 for k in range(3)]
                spec = {"name": name, "kind": kind, "missing": int(sum(1 for d in values if d is None)), "fill": fills}
                names += [f"{name} · {p}" for p in DATE_PARTS]
                scale += [True, True, True]
            elif kind == CATEGORY:
                counts: dict[str, int] = {}
                missing = 0
                for x in values:
                    if x is None:
                        missing += 1
                    else:
                        counts[x] = counts.get(x, 0) + 1
                ordered = sorted(counts, key=lambda k: (-counts[k], k))
                cats = ordered[:MAX_CATEGORIES]
                other = len(ordered) > MAX_CATEGORIES
                if other:
                    cats.append(OTHER)
                if missing:
                    cats.append(EMPTY)
                spec = {"name": name, "kind": kind, "missing": missing, "categories": cats, "other": other,
                        "counts": {k: counts[k] for k in cats if k in counts}}
                names += [f"{name} = {c}" for c in cats]
                scale += [False] * len(cats)
            else:
                raise ValueError(f"Tipo de columna no admitido para aprender: {kind}")
            groups.append({"column": name, "kind": kind, "start": start, "end": len(names)})
            self.specs.append(spec)
        self.feature_names, self.groups = names, groups
        self.scale_mask = np.array(scale, dtype=bool)
        raw = self.transform(cols, scaled=False)
        self.mean = np.where(self.scale_mask, raw.mean(axis=0) if len(raw) else 0.0, 0.0)
        std = raw.std(axis=0) if len(raw) else np.ones(len(names))
        self.std = np.where(self.scale_mask & (std > 1e-12), std, 1.0)
        for spec, g in zip(self.specs, groups):
            if spec["kind"] == NUMBER:
                spec["mean"], spec["std"] = float(self.mean[g["start"]]), float(self.std[g["start"]])
            elif spec["kind"] == DATE:
                spec["mean"] = [float(x) for x in self.mean[g["start"]:g["end"]]]
                spec["std"] = [float(x) for x in self.std[g["start"]:g["end"]]]
        return self

    # ---------------------------------------------------------- convertir
    def transform(self, cols: dict, scaled: bool = True) -> np.ndarray:
        n = len(next(iter(cols.values()))) if cols else 0
        out = np.zeros((n, len(self.feature_names)))
        for spec, g in zip(self.specs, self.groups):
            values = cols[spec["name"]]
            s = g["start"]
            if spec["kind"] == NUMBER:
                v = np.asarray(values, dtype=float).copy()
                v[np.isnan(v)] = spec["fill"]
                out[:, s] = v
            elif spec["kind"] == DATE:
                parts = np.array([_date_parts(d) for d in values], dtype=float).reshape(-1, 3)
                for k in range(3):
                    col = parts[:, k]
                    col[np.isnan(col)] = spec["fill"][k]
                    out[:, s + k] = col
            else:
                index = {c: i for i, c in enumerate(spec["categories"])}
                for r, x in enumerate(values):
                    j = index.get(EMPTY if x is None else x)
                    if j is None and spec["other"]:
                        j = index[OTHER]
                    if j is not None:
                        out[r, s + j] = 1.0
        if scaled and len(self.mean):
            out = (out - self.mean) / self.std
        return out

    def scale(self, raw: np.ndarray) -> np.ndarray:
        return (raw - self.mean) / self.std

    def records_to_cols(self, records: list[dict]) -> dict:
        """Filas que llegan como diccionarios (formulario, API) → columnas convertidas como en la tabla."""
        cols = {}
        for spec in self.specs:
            vals = [parse_value(r.get(spec["name"]), spec["kind"]) for r in records]
            cols[spec["name"]] = np.array(vals, dtype=float) if spec["kind"] == NUMBER else vals
        return cols

    # ------------------------------------------------------------ explicar
    def describe(self) -> list[dict]:
        """Los pasos de la preparación con lo aprendido en cada uno (para la consola)."""
        steps = []
        fills = [{"column": s["name"], "kind": s["kind"], "missing": s["missing"],
                  "fill": (format_number(s["fill"]) if s["kind"] == NUMBER else
                           EMPTY if s["kind"] == CATEGORY else "la mediana de cada parte")}
                 for s in self.specs if s["missing"]]
        steps.append({"key": "missing", "title": "Rellenar los vacíos",
                      "text": "Los números vacíos se rellenan con la mediana de entrenamiento; en las categorías, el vacío es una "
                              "categoría más, «(vacío)».",
                      "items": fills})
        dates = [s["name"] for s in self.specs if s["kind"] == DATE]
        if dates:
            steps.append({"key": "dates", "title": "Fechas → año, mes y día de la semana",
                          "text": "Una fecha no se puede sumar ni comparar tal cual: se parte en tres números.",
                          "items": [{"column": d, "parts": list(DATE_PARTS)} for d in dates]})
        cats = [{"column": s["name"], "categories": s["categories"], "counts": s.get("counts", {})}
                for s in self.specs if s["kind"] == CATEGORY]
        if cats:
            steps.append({"key": "onehot", "title": "Categorías → columnas de 0 y 1 (one-hot)",
                          "text": "Cada valor de una categoría pasa a ser una columna que vale 1 si la fila lo tiene y 0 si "
                                  "no. Así «Dream» no vale «más» que «Biscoe».",
                          "items": cats})
        nums = [{"column": s["name"], "mean": s["mean"], "std": s["std"]} for s in self.specs if s["kind"] == NUMBER]
        if nums or dates:
            steps.append({"key": "scale", "title": "Escalar los números (estandarizar)",
                          "text": "A cada número se le resta su media y se divide por su desviación típica: así un peso en "
                                  "gramos (miles) no aplasta a una longitud en milímetros (decenas). Los árboles no lo "
                                  "necesitan y usan los valores tal cual.",
                          "items": nums})
        return steps

    def explain_row(self, cols: dict, i: int) -> list[dict]:
        """Cómo queda una fila concreta: cada columna, su valor y los números en que se convierte."""
        raw = self.transform({k: (v[i:i + 1] if isinstance(v, np.ndarray) else v[i:i + 1]) for k, v in cols.items()},
                             scaled=False)[0]
        scaled = self.scale(raw)
        out = []
        for spec, g in zip(self.specs, self.groups):
            v = cols[spec["name"]][i]
            if spec["kind"] == NUMBER:
                shown = None if np.isnan(v) else format_number(round(float(v), 6))
            elif spec["kind"] == DATE:
                shown = None if v is None else v.isoformat()
            else:
                shown = v
            out.append({"column": spec["name"], "kind": spec["kind"], "value": shown,
                        "features": [{"name": self.feature_names[j], "raw": float(raw[j]), "scaled": float(scaled[j])}
                                     for j in range(g["start"], g["end"])]})
        return out

    def column_of_feature(self) -> list[int]:
        """Para cada rasgo, el número de la columna original de la que sale."""
        out = [0] * len(self.feature_names)
        for k, g in enumerate(self.groups):
            for j in range(g["start"], g["end"]):
                out[j] = k
        return out

    # ------------------------------------------------------------ guardar
    def to_state(self) -> dict:
        return {"features": self.features, "specs": self.specs, "featureNames": self.feature_names,
                "groups": self.groups, "mean": self.mean.tolist(), "std": self.std.tolist(),
                "scaleMask": self.scale_mask.tolist()}

    @classmethod
    def from_state(cls, state: dict) -> "Preparer":
        p = cls(state["features"])
        p.specs, p.feature_names, p.groups = state["specs"], state["featureNames"], state["groups"]
        p.mean, p.std = np.array(state["mean"], dtype=float), np.array(state["std"], dtype=float)
        p.scale_mask = np.array(state["scaleMask"], dtype=bool)
        return p


class Target:
    """La columna que se predice: las clases (clasificación) o los números (regresión)."""

    def __init__(self, name: str, task: str, classes: list[str] | None = None):
        self.name, self.task = name, task
        self.classes = classes or []

    @classmethod
    def fit(cls, name: str, task: str, values) -> "Target":
        if task == "classification":
            labels = [label_of(v) for v in values]
            classes = sorted({x for x in labels if x is not None}, key=_natural)
            return cls(name, task, classes)
        return cls(name, task)

    def encode(self, values) -> np.ndarray:
        if self.task == "classification":
            index = {c: i for i, c in enumerate(self.classes)}
            return np.array([index.get(label_of(v), -1) for v in values], dtype=int)
        return np.asarray(values, dtype=float)

    def to_state(self) -> dict:
        return {"name": self.name, "task": self.task, "classes": self.classes}

    @classmethod
    def from_state(cls, state: dict) -> "Target":
        return cls(state["name"], state["task"], state.get("classes"))


def label_of(v) -> str | None:
    """La etiqueta de clase de un valor (los números enteros sin «.0»)."""
    if v is None:
        return None
    if isinstance(v, (float, np.floating)):
        return None if np.isnan(v) else format_number(float(v))
    if isinstance(v, date):
        return v.isoformat()
    return str(v)


def _natural(s: str):
    try:
        return (0, float(s), s)
    except ValueError:
        return (1, 0.0, s.lower())


def weekday_name(i: int) -> str:
    return WEEKDAYS[int(i) % 7]

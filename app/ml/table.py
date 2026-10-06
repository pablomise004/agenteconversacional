"""Tablas de datos (CSV): leer, adivinar el tipo de cada columna y describirla.

Un CSV entra como bytes y sale como una Table: columnas con sus valores ya convertidos (números, fechas,
categorías o texto) y un perfil de cada una para la consola (vacíos, valores distintos, histograma o los
valores más frecuentes). Se entienden los CSV de Excel en español: separador «;» y coma decimal.
"""

from __future__ import annotations

import csv
import io
import re
from collections import Counter
from datetime import date

import numpy as np

# Tipos de columna (identificadores en inglés; la consola los enseña en español)
NUMBER, CATEGORY, DATE, TEXT = "number", "category", "date", "text"
KINDS = (NUMBER, CATEGORY, DATE, TEXT)

MISSING = {"", "na", "n/a", "nan", "null", "none", "?", "-", "#n/a", "#¡valor!", "#value!"}
MAX_BYTES = 20 * 1024 * 1024
MAX_ROWS = 100_000
MAX_COLUMNS = 200
MAX_CELLS = 1_000_000  # filas × columnas: así una tabla cabe en memoria sin apuros en el servidor público

_NUM_DOT = re.compile(r"^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$")
_NUM_COMMA = re.compile(r"^[+-]?(?:\d{1,3}(?:\.\d{3})+|\d+)(?:,\d+)?$")
_COMMA_DECIMAL = re.compile(r"^[+-]?\d+,\d+$")
_DOT_DECIMAL = re.compile(r"^[+-]?\d+\.\d+$")
_DATE_YMD = re.compile(r"^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[ T]\d{1,2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$")
_DATE_DMY = re.compile(r"^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})(?: \d{1,2}:\d{2}(?::\d{2})?)?$")
_ID_NAMES = {"id", "instant", "index", "indice", "codigo", "code", "identificador", "fila", "row", "n", "num", "no"}


class TableError(ValueError):
    """El fichero no se puede leer como tabla (con un mensaje para la persona)."""


class Column:
    """Una columna: el texto tal como venía (`raw`, "" si falta) y sus valores ya convertidos."""

    __slots__ = ("name", "raw", "kind", "values", "is_id", "dayfirst")

    def __init__(self, name: str, raw: list[str]):
        self.name = name
        self.raw = raw
        self.kind = TEXT
        self.values: list | np.ndarray = raw
        self.is_id = False
        self.dayfirst = True

    def missing_mask(self) -> np.ndarray:
        if self.kind == NUMBER:
            return np.isnan(self.values)
        return np.array([v is None for v in self.values], dtype=bool)


class Table:
    """Una tabla leída de un CSV: columnas del mismo largo, con su tipo ya adivinado."""

    def __init__(self, columns: list[Column], decimal: str = ".", delimiter: str = ","):
        self.columns = columns
        self.decimal = decimal
        self.delimiter = delimiter

    @property
    def n_rows(self) -> int:
        return len(self.columns[0].raw) if self.columns else 0

    @property
    def names(self) -> list[str]:
        return [c.name for c in self.columns]

    def column(self, name: str) -> Column:
        for c in self.columns:
            if c.name == name:
                return c
        raise KeyError(name)

    def set_kind(self, name: str, kind: str) -> None:
        """Cambia el tipo de una columna (la persona sabe más que la adivinanza)."""
        convert(self.column(name), kind, self.decimal)

    def rows(self, start: int = 0, stop: int | None = None) -> list[list[str]]:
        """Filas como texto, para la vista previa."""
        stop = self.n_rows if stop is None else min(stop, self.n_rows)
        return [[c.raw[i] for c in self.columns] for i in range(start, stop)]

    def to_csv(self) -> str:
        """El CSV normalizado que se guarda: separado por comas, punto decimal y fechas AAAA-MM-DD."""
        out = io.StringIO()
        w = csv.writer(out, lineterminator="\n")
        w.writerow(self.names)
        cells = []
        for c in self.columns:
            if c.kind == NUMBER:
                cells.append(["" if np.isnan(v) else format_number(v) for v in c.values])
            elif c.kind == DATE:
                cells.append(["" if v is None else v.isoformat() for v in c.values])
            else:
                cells.append(["" if is_missing(s) else s for s in c.raw])
        for i in range(self.n_rows):
            w.writerow([col[i] for col in cells])
        return out.getvalue()


# ------------------------------------------------------------------ leer
def decode(raw: bytes) -> str:
    """UTF-8 (con o sin BOM); si no, Windows-1252, que es lo que guarda Excel en español."""
    for enc in ("utf-8-sig", "cp1252", "latin-1"):
        try:
            return raw.decode(enc)
        except UnicodeDecodeError:
            continue
    raise TableError("No se entiende la codificación del fichero.")


def sniff(text: str) -> str:
    """El separador: el que más se repite igual en las primeras líneas (coma, punto y coma, tabulador o |)."""
    lines = [ln for ln in text.splitlines()[:30] if ln.strip()]
    if not lines:
        raise TableError("El fichero está vacío.")
    best, best_score = ",", -1.0
    for d in (",", ";", "\t", "|"):
        counts = [len(next(csv.reader([ln], delimiter=d))) for ln in lines]
        if counts[0] < 2:
            continue
        same = sum(1 for c in counts if c == counts[0]) / len(counts)
        score = same * 10 + min(counts[0], 50) / 50
        if score > best_score:
            best, best_score = d, score
    return best


def is_missing(s: str) -> bool:
    return s.strip().lower() in MISSING


def guess_decimal(columns: list[list[str]]) -> str:
    """Coma decimal si hay más números como «3,5» que como «3.5» (CSV de Excel en español)."""
    comma = dot = 0
    for raw in columns:
        for s in raw[:300]:
            s = s.strip()
            if _COMMA_DECIMAL.match(s):
                comma += 1
            elif _DOT_DECIMAL.match(s):
                dot += 1
    return "," if comma > dot else "."


def to_number(s: str, decimal: str = ".") -> float | None:
    t = s.strip().replace(" ", "").replace(" ", "")
    if decimal == ",":
        if _NUM_COMMA.match(t):
            return float(t.replace(".", "").replace(",", "."))
        if _DOT_DECIMAL.match(t):
            return float(t)
        return None
    return float(t) if _NUM_DOT.match(t) else None


def to_date(s: str, dayfirst: bool = True) -> date | None:
    t = s.strip()
    try:
        m = _DATE_YMD.match(t)
        if m:
            return date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
        m = _DATE_DMY.match(t)
        if m:
            a, b, y = int(m.group(1)), int(m.group(2)), int(m.group(3))
            return date(y, b, a) if dayfirst else date(y, a, b)
    except ValueError:
        return None
    return None


def format_number(v: float) -> str:
    return str(int(v)) if float(v).is_integer() and abs(v) < 1e15 else format(v, ".10g")


def read_csv(raw: bytes) -> Table:
    """Lee un CSV (bytes) y adivina el tipo de cada columna."""
    if len(raw) > MAX_BYTES:
        raise TableError(f"El fichero ocupa más de {MAX_BYTES // (1024 * 1024)} MB.")
    text = decode(raw)
    delimiter = sniff(text)
    rows = [r for r in csv.reader(io.StringIO(text), delimiter=delimiter) if any(c.strip() for c in r)]
    if len(rows) < 2:
        raise TableError("Hace falta una fila de títulos y al menos una fila de datos.")
    header = [h.strip() for h in rows[0]]
    if len(header) < 1:
        raise TableError("No hay columnas.")
    if len(header) > MAX_COLUMNS:
        raise TableError(f"Hay {len(header)} columnas; como mucho se admiten {MAX_COLUMNS}.")
    data = rows[1:]
    if len(data) > MAX_ROWS or len(data) * len(header) > MAX_CELLS:
        raise TableError(f"La tabla es demasiado grande ({len(data)} filas × {len(header)} columnas). Como mucho "
                         f"{MAX_ROWS:,} filas y {MAX_CELLS:,} casillas.".replace(",", "."))
    names = unique_names(header)
    width = len(names)
    raw_cols = [[(r[j].strip() if j < len(r) else "") for r in data] for j in range(width)]
    decimal = guess_decimal(raw_cols)
    columns = [Column(n, c) for n, c in zip(names, raw_cols)]
    for col in columns:
        convert(col, infer_kind(col.raw, decimal), decimal)
        col.is_id = looks_like_id(col)
    return Table(columns, decimal, delimiter)


def unique_names(header: list[str]) -> list[str]:
    """Títulos sin repetir ni vacíos («columna 3», «edad (2)»)."""
    out, seen = [], Counter()
    for i, h in enumerate(header):
        name = h or f"columna {i + 1}"
        seen[name] += 1
        out.append(name if seen[name] == 1 else f"{name} ({seen[name]})")
    return out


# --------------------------------------------------------------- tipos
def infer_kind(raw: list[str], decimal: str = ".") -> str:
    vals = [s for s in raw if not is_missing(s)]
    n = len(vals)
    if not n:
        return TEXT
    sample = vals if n <= 2000 else vals[:: max(1, n // 2000)]
    m = len(sample)
    if sum(1 for s in sample if to_number(s, decimal) is not None) >= 0.95 * m:
        return NUMBER
    if sum(1 for s in sample if to_date(s) is not None) >= 0.95 * m:
        return DATE
    unique = len(set(vals))
    if unique <= 50 or (unique <= 200 and unique <= 0.05 * n):
        return CATEGORY
    return TEXT


def convert(col: Column, kind: str, decimal: str = ".") -> None:
    """Convierte los valores de la columna al tipo dado (lo que no encaja queda como vacío)."""
    if kind not in KINDS:
        raise TableError(f"Tipo desconocido: {kind}")
    col.kind = kind
    if kind == NUMBER:
        out = np.full(len(col.raw), np.nan)
        for i, s in enumerate(col.raw):
            if not is_missing(s):
                v = to_number(s, decimal)
                if v is not None:
                    out[i] = v
        col.values = out
    elif kind == DATE:
        # «03/04/2024»: día/mes, salvo que algún valor solo tenga sentido como mes/día (EE. UU.)
        slashed = [_DATE_DMY.match(s.strip()) for s in col.raw if not is_missing(s)]
        col.dayfirst = not any(m and int(m.group(2)) > 12 for m in slashed)
        col.values = [None if is_missing(s) else to_date(s, col.dayfirst) for s in col.raw]
    else:
        col.values = [None if is_missing(s) else s for s in col.raw]


def looks_like_id(col: Column) -> bool:
    """Columnas que identifican cada fila (número de fila, código…): no sirven para aprender."""
    n = len(col.raw)
    if n < 20:
        return False
    plain = re.sub(r"[^a-z]", "", col.name.lower())
    if col.kind == NUMBER:
        v = col.values
        if np.isnan(v).any() or not np.all(np.mod(v, 1) == 0):
            return False
        if len(np.unique(v)) != n:
            return False
        steps = np.diff(v)
        return plain in _ID_NAMES or bool(np.all(steps == 1))
    if col.kind == TEXT:
        vals = [x for x in col.values if x is not None]
        return len(set(vals)) == len(vals) == n
    return False


def suggest_task(table: Table, target: str | None) -> str:
    """Clasificación si lo que se predice es una categoría (o un número con pocos valores enteros);
    regresión si es un número de verdad; agrupación si no hay columna que predecir."""
    if not target:
        return "clustering"
    col = table.column(target)
    if col.kind == NUMBER:
        v = col.values[~np.isnan(col.values)]
        if len(np.unique(v)) <= 10 and np.all(np.mod(v, 1) == 0):
            return "classification"
        return "regression"
    return "classification"


# ------------------------------------------------------------- perfiles
def profile(col: Column, bins: int = 12) -> dict:
    """Lo que la consola enseña de una columna: cuántos vacíos, valores distintos y su distribución."""
    missing = int(col.missing_mask().sum())
    n = len(col.raw)
    out: dict = {"name": col.name, "kind": col.kind, "count": n, "missing": missing, "isId": col.is_id}
    present = [s for s in col.raw if not is_missing(s)]
    out["examples"] = list(dict.fromkeys(present))[:3]
    if col.kind == NUMBER:
        v = col.values[~np.isnan(col.values)]
        out["unique"] = int(len(np.unique(v)))
        if len(v):
            integer = bool(np.all(np.mod(v, 1) == 0))
            out.update(min=float(v.min()), max=float(v.max()), mean=float(v.mean()), median=float(np.median(v)),
                       std=float(v.std()), integer=integer)
            if integer and out["unique"] <= 15:
                counts = Counter(v.tolist())
                out["bars"] = [{"value": format_number(k), "count": int(c)} for k, c in sorted(counts.items())]
            else:
                counts, edges = np.histogram(v, bins=min(bins, max(1, out["unique"])))
                out["hist"] = {"edges": [float(e) for e in edges], "counts": [int(c) for c in counts]}
    elif col.kind == DATE:
        days = [d.toordinal() for d in col.values if d is not None]
        out["unique"] = len(set(days))
        if days:
            out.update(min=date.fromordinal(min(days)).isoformat(), max=date.fromordinal(max(days)).isoformat())
            counts, edges = np.histogram(days, bins=min(bins, max(1, out["unique"])))
            out["hist"] = {"edges": [date.fromordinal(int(e)).isoformat() for e in edges], "counts": [int(c) for c in counts]}
    else:
        counts = Counter(x for x in col.values if x is not None)
        out["unique"] = len(counts)
        top = counts.most_common(10)
        out["top"] = [{"value": k, "count": int(c)} for k, c in top]
        out["others"] = int(sum(counts.values()) - sum(c for _, c in top))
        if col.kind == TEXT:
            lengths = [len(x) for x in counts]
            out["avgLength"] = float(np.mean(lengths)) if lengths else 0.0
    return out


def describe(table: Table) -> dict:
    """Resumen de toda la tabla: tamaño, separador, decimal y el perfil de cada columna."""
    return {"rows": table.n_rows, "delimiter": table.delimiter, "decimal": table.decimal,
            "columns": [profile(c) for c in table.columns]}

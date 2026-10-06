"""Proyectos de ejemplo de machine learning: con qué datos empiezan y de dónde salen.

No se copian a cada cuenta: al elegir uno en «Nuevo proyecto» se crea un proyecto tuyo con sus datos.
Las tablas están en examples/ml/ (las genera tools/build_ml_examples.py, en español); las imágenes de
«Formas» se dibujan aquí, siempre iguales (semilla fija), para no guardar ficheros binarios en el repositorio.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent.parent
DIR = ROOT / "examples" / "ml"

EXAMPLES = [
    {"id": "pinguinos", "name": "Pingüinos", "kind": "table", "file": "pinguinos.csv", "task": "classification",
     "target": "especie", "icon": "bird",
     "description": "344 pingüinos de la Antártida con las medidas del pico, la aleta y el peso. Clasifica la especie "
                    "(Adelia, Barbijo o Papúa) o agrúpalos sin decirle la especie.",
     "source": "Palmer Penguins: Gorman, Williams y Fraser (2014), paquete palmerpenguins de Horst, Hill y Gorman. "
               "Licencia CC0."},
    {"id": "bicis", "name": "Alquiler de bicis", "kind": "table", "file": "bicis.csv", "task": "regression",
     "target": "alquileres", "icon": "bike",
     "description": "731 días de alquiler de bicis en Washington (2011-2012) con el tiempo que hizo. Predice cuántas "
                    "bicis se alquilarán un día: como el laboratorio de ML automatizado de Azure.",
     "source": "Bike Sharing Dataset: Fanaee-T y Gama (2013), UCI Machine Learning Repository. Licencia CC BY 4.0."},
    {"id": "formas", "name": "Formas", "kind": "images", "task": "images", "icon": "image",
     "classes": ["círculo", "cuadrado", "triángulo"], "per_class": 50,
     "description": "150 dibujos de 64 × 64 píxeles: círculos, cuadrados y triángulos de colores, tamaños y posiciones "
                    "distintos. Compara una red convolucional con mirar los píxeles a secas.",
     "source": "Dibujadas por Lince (app/ml/examples.py)."},
]


def get(example_id: str) -> dict | None:
    return next((e for e in EXAMPLES if e["id"] == example_id), None)


def public() -> list[dict]:
    """Los ejemplos para la consola (sin rutas de ficheros)."""
    out = []
    for e in EXAMPLES:
        item = {k: v for k, v in e.items() if k not in ("file", "per_class")}
        if e["kind"] == "images":
            item["count"] = e["per_class"] * len(e["classes"])
        else:
            item["rows"] = sum(1 for _ in open(DIR / e["file"], encoding="utf-8")) - 1
        out.append(item)
    return out


def csv_bytes(example_id: str) -> bytes:
    return (DIR / get(example_id)["file"]).read_bytes()


# ------------------------------------------------------------- formas
def _shape_mask(kind: str, size: int, cx: float, cy: float, r: float, angle: float) -> np.ndarray:
    """Máscara de una forma (con 4× más resolución y luego promediada: bordes suaves)."""
    s = 4
    yy, xx = np.mgrid[0:size * s, 0:size * s] / s
    x, y = xx - cx, yy - cy
    c, si = np.cos(angle), np.sin(angle)
    xr, yr = c * x + si * y, -si * x + c * y
    if kind == "círculo":
        m = x ** 2 + y ** 2 <= r ** 2
    elif kind == "cuadrado":
        h = r * 0.82
        m = (np.abs(xr) <= h) & (np.abs(yr) <= h)
    else:  # triángulo equilátero con radio r
        pts = [(r * np.cos(a), r * np.sin(a)) for a in (-np.pi / 2, np.pi / 6, 5 * np.pi / 6)]
        m = np.ones_like(xr, dtype=bool)
        for (x1, y1), (x2, y2) in zip(pts, pts[1:] + pts[:1]):
            m &= (x2 - x1) * (yr - y1) - (y2 - y1) * (xr - x1) >= 0
    return m.reshape(size, s, size, s).mean(axis=(1, 3))


def shapes(per_class: int = 50, size: int = 64, seed: int = 2026) -> tuple[list[str], np.ndarray]:
    """Las imágenes del ejemplo «Formas»: etiquetas y píxeles (n × 64 × 64 × 3, 0-255)."""
    rng = np.random.default_rng(seed)
    classes = get("formas")["classes"]
    labels, images = [], []
    for i in range(per_class):
        for kind in classes:
            bg = rng.uniform(150, 245, 3)
            fg = rng.uniform(0, 255, 3)
            while np.abs(fg - bg).sum() < 200:  # que se vea bien la forma
                fg = rng.uniform(0, 255, 3)
            r = rng.uniform(11, 23)
            margin = r + 2
            cx, cy = rng.uniform(margin, size - margin, 2)
            mask = _shape_mask(kind, size, cx, cy, r, rng.uniform(0, 2 * np.pi))[:, :, None]
            img = bg * (1 - mask) + fg * mask + rng.normal(0, 8, (size, size, 3))
            images.append(np.clip(img, 0, 255).astype(np.uint8))
            labels.append(kind)
    return labels, np.stack(images)

"""PNG mínimo (sin Pillow): convierte un array de píxeles en una imagen para la consola (data: URL)."""

from __future__ import annotations

import base64
import struct
import zlib

import numpy as np


def _chunk(kind: bytes, data: bytes) -> bytes:
    return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)


def encode(pixels: np.ndarray) -> bytes:
    """`pixels`: alto × ancho (gris) o alto × ancho × 3 (color), valores 0-255."""
    a = np.clip(np.asarray(pixels), 0, 255).astype(np.uint8)
    if a.ndim == 2:
        color = 0
        rows = a
    else:
        color = 2
        rows = a.reshape(a.shape[0], -1)
    h, w = a.shape[0], a.shape[1]
    raw = b"".join(b"\x00" + rows[i].tobytes() for i in range(h))  # filtro 0 en cada fila
    return (b"\x89PNG\r\n\x1a\n" + _chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, color, 0, 0, 0))
            + _chunk(b"IDAT", zlib.compress(raw, 6)) + _chunk(b"IEND", b""))


def data_url(pixels: np.ndarray) -> str:
    return "data:image/png;base64," + base64.b64encode(encode(pixels)).decode("ascii")


def normalized(a: np.ndarray) -> np.ndarray:
    """Lleva cualquier array al rango 0-255 (para ver filtros y activaciones)."""
    a = np.asarray(a, dtype=float)
    lo, hi = float(a.min()), float(a.max())
    if hi - lo < 1e-12:
        return np.zeros_like(a)
    return (a - lo) / (hi - lo) * 255

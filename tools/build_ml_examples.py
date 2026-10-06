"""Genera los datos de los proyectos de ejemplo de machine learning (examples/ml/*.csv) en español.

Uso: python tools/build_ml_examples.py

Descarga los datos originales (hace falta internet) y los traduce: nombres de columnas, valores y códigos
numéricos convertidos en palabras («weathersit = 2» → «nublado»). Las imágenes del ejemplo «Formas» no
se guardan: las dibuja app/ml/examples.py siempre igual (con una semilla fija).

- Pingüinos: Palmer Penguins (Gorman, Williams y Fraser, 2014; paquete palmerpenguins de Horst, Hill y
  Gorman). Licencia CC0. https://allisonhorst.github.io/palmerpenguins/
- Alquiler de bicis: Bike Sharing Dataset (Fanaee-T y Gama, 2013), UCI Machine Learning Repository.
  Licencia CC BY 4.0. https://archive.ics.uci.edu/dataset/275/bike+sharing+dataset
"""

import csv
import io
import sys
import urllib.request
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "examples" / "ml"
PENGUINS = "https://raw.githubusercontent.com/allisonhorst/palmerpenguins/main/inst/extdata/penguins.csv"
BIKES = "https://archive.ics.uci.edu/static/public/275/bike+sharing+dataset.zip"


def download(url: str) -> bytes:
    with urllib.request.urlopen(url, timeout=60) as r:
        return r.read()


def write(name: str, header: list[str], rows: list[list]) -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    with open(OUT / name, "w", encoding="utf-8", newline="") as f:
        w = csv.writer(f, lineterminator="\n")
        w.writerow(header)
        w.writerows(rows)
    print(f"examples/ml/{name}: {len(rows)} filas")


def penguins() -> None:
    species = {"Adelie": "Adelia", "Chinstrap": "Barbijo", "Gentoo": "Papúa"}
    sex = {"male": "macho", "female": "hembra"}
    text = download(PENGUINS).decode("utf-8")
    rows = []
    for r in csv.DictReader(io.StringIO(text)):
        na = lambda v: "" if v in ("NA", "") else v  # noqa: E731
        rows.append([species[r["species"]], r["island"], na(r["bill_length_mm"]), na(r["bill_depth_mm"]),
                     na(r["flipper_length_mm"]), na(r["body_mass_g"]), sex.get(r["sex"], ""), r["year"]])
    write("pinguinos.csv", ["especie", "isla", "pico_largo_mm", "pico_alto_mm", "aleta_mm", "peso_g", "sexo", "año"], rows)


def bikes() -> None:
    z = zipfile.ZipFile(io.BytesIO(download(BIKES)))
    text = z.read("day.csv").decode("utf-8")
    season = {"1": "invierno", "2": "primavera", "3": "verano", "4": "otoño"}
    weather = {"1": "despejado", "2": "nublado", "3": "lluvia ligera", "4": "lluvia fuerte"}
    yes = {"0": "no", "1": "sí"}
    rows = []
    for r in csv.DictReader(io.StringIO(text)):
        # el fichero original da la temperatura y lo demás divididos por su máximo (ver su Readme.txt)
        rows.append([r["dteday"], season[r["season"]], yes[r["holiday"]], yes[r["workingday"]], weather[r["weathersit"]],
                     f"{float(r['temp']) * 41:.1f}", f"{float(r['atemp']) * 50:.1f}", f"{float(r['hum']) * 100:.0f}",
                     f"{float(r['windspeed']) * 67:.1f}", r["cnt"]])
    write("bicis.csv", ["fecha", "estacion", "festivo", "laborable", "tiempo", "temperatura_c", "sensacion_c",
                        "humedad_pct", "viento_kmh", "alquileres"], rows)


if __name__ == "__main__":
    which = set(sys.argv[1:]) or {"pinguinos", "bicis"}
    if "pinguinos" in which:
        penguins()
    if "bicis" in which:
        bikes()

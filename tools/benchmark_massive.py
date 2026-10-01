"""Mide el acierto del clasificador con el dataset público MASSIVE (Amazon, español).

Uso:
    python tools/benchmark_massive.py            # 10 y 20 frases por intención
    python tools/benchmark_massive.py --k 5 20 50 --seeds 0 1 2

Descarga los ficheros la primera vez (unos 260 KB) en data/bench/. Crea un agente con
k frases por intención (60 intenciones de asistente doméstico) y comprueba qué
intención elige para cada una de las 2.974 frases de test. Úsalo para comparar
cambios en app/nlu/ (más alto = mejor).
"""

import argparse
import gzip
import json
import random
import sys
import time
import urllib.request
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from app.nlu.engine import NLUEngine  # noqa: E402

URL = "https://huggingface.co/datasets/mteb/amazon_massive_intent/resolve/main/{split}/es.json.gz"
CACHE = ROOT / "data" / "bench"


def load(split: str) -> list[dict]:
    CACHE.mkdir(parents=True, exist_ok=True)
    path = CACHE / f"massive-{split}-es.json.gz"
    if not path.exists():
        print(f"Descargando MASSIVE ({split})…")
        urllib.request.urlretrieve(URL.format(split=split), path)
    with gzip.open(path, "rt", encoding="utf-8") as f:
        return [json.loads(line) for line in f]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--k", type=int, nargs="+", default=[10, 20], help="frases por intención")
    parser.add_argument("--seeds", type=int, nargs="+", default=[0], help="semillas del muestreo")
    args = parser.parse_args()
    train, test = load("train"), load("test")
    by_intent = defaultdict(list)
    for row in train:
        by_intent[row["label"]].append(row["text"])
    for k in args.k:
        scores = []
        for seed in args.seeds:
            rng = random.Random(seed)
            agent = {"language": "es", "entities": [], "intents": [
                {"id": label, "name": label,
                 "trainingPhrases": [{"text": t, "annotations": None} for t in rng.sample(texts, min(k, len(texts)))]}
                for label, texts in sorted(by_intent.items())]}
            t0 = time.time()
            engine = NLUEngine(agent)
            t_train = time.time() - t0
            t0 = time.time()
            ok = sum(1 for row in test if (engine.analyze(row["text"]).best or {}).get("id") == row["label"])
            ms = (time.time() - t0) * 1000 / len(test)
            scores.append(ok / len(test))
            print(f"k={k:>3} semilla={seed}: acierto {ok / len(test):.3f}  (entrena {t_train:.1f} s, {ms:.1f} ms/frase)")
        if len(scores) > 1:
            print(f"k={k:>3} media: {sum(scores) / len(scores):.3f}")


if __name__ == "__main__":
    main()

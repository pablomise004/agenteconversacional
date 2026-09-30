"""Prueba rápida del motor de NLU con el agente de ejemplo.

Uso: python tools/probar_nlu.py "quiero una pizza barbacoa familiar"
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from app.nlu.engine import NLUEngine  # noqa: E402

agent = json.loads((Path(__file__).resolve().parent.parent / "examples" / "pizzeria.json")
                   .read_text(encoding="utf-8"))
engine = NLUEngine(agent)
texto = " ".join(sys.argv[1:]) or "quiero reservar mesa para 4 mañana a las 9 de la noche"
a = engine.analyze(texto, neighbors=3)
print("Texto:", texto)
print("Tokens:", " | ".join(t.norm + (f"->{t.corrected}" if t.corrected else "") for t in a.tokens))
for e in a.entities:
    print(f"Entidad: {e.entity:20} {e.text!r} = {e.value}")
for r in a.ranking[:3]:
    print(f"Intención: {r['name']:20} confianza={r['confidence']:.2f} ({r['match']})")
if a.best:
    vals, _ = engine.extract_parameters(engine.intents[a.best["id"]], a)
    print("Parámetros:", vals)
for n in a.neighbors:
    print(f"Parecida a: {n['text']!r} ({n['intentName']}, {n['similarity']})")

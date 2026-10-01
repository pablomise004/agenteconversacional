"""Revisión de la calidad de un agente (avisos como la "Validación" de Dialogflow)."""

from collections import defaultdict

from .nlu.sys_entities import SYS_ALIASES, SYSTEM_ENTITIES
from .nlu.text import normalize_text


def _norm(text: str) -> str:
    return " ".join("".join(c if c.isalnum() else " " for c in normalize_text(text)).split())


def validate(agent: dict) -> list[dict]:
    out: list[dict] = []

    def add(level, msg, intent=None, entity=None):
        item = {"level": level, "message": msg}
        if intent:
            item["intentId"], item["intentName"] = intent["id"], intent["name"]
        if entity:
            item["entityId"], item["entityName"] = entity["id"], entity["name"]
        out.append(item)

    entities = {"@" + e["name"] for e in agent.get("entities") or []}
    known = entities | set(SYSTEM_ENTITIES) | set(SYS_ALIASES)
    produced = {c["name"] for i in agent.get("intents") or [] for c in i.get("outputContexts") or []
                if c.get("lifespan", 0) > 0}
    seen_phrases = defaultdict(list)
    names = defaultdict(int)
    fallbacks = 0

    for i in agent.get("intents") or []:
        names[i["name"].lower()] += 1
        phrases = i.get("trainingPhrases") or []
        if i.get("isFallback"):
            fallbacks += 1
        elif not phrases and not i.get("events"):
            add("error", "No tiene frases de entrenamiento ni eventos: nunca se activará.", i)
        elif 0 < len(phrases) < 5:
            add("warning", f"Solo tiene {len(phrases)} frases de entrenamiento; con 10 o más "
                           "se reconoce mucho mejor.", i)
        if not i.get("responses") and not i.get("webhook"):
            add("warning", "No tiene respuestas ni webhook: el bot no dirá nada.", i)
        params = {p["name"]: p for p in i.get("parameters") or []}
        for p in params.values():
            if p["entity"] and p["entity"] not in known:
                add("error", f"El parámetro «{p['name']}» usa la entidad {p['entity']}, que no existe.", i)
            if p.get("required") and not p.get("prompts"):
                add("warning", f"El parámetro obligatorio «{p['name']}» no tiene preguntas; "
                               "se usará una genérica.", i)
        for c in i.get("inputContexts") or []:
            if c not in produced:
                add("warning", f"Espera el contexto «{c}», pero ninguna intención lo crea.", i)
        for ph in phrases:
            key = _norm(ph["text"])
            if key:
                seen_phrases[key].append(i)
            for a in ph.get("annotations") or []:
                if a["entity"] not in known:
                    add("error", f"La frase «{ph['text']}» anota la entidad {a['entity']}, que no existe.", i)

    for key, intents in seen_phrases.items():
        ids = {x["id"] for x in intents}
        if len(ids) > 1:
            ctx = {tuple(sorted(x.get("inputContexts") or [])) for x in intents}
            if len(ctx) < len(ids):  # con contextos distintos no hay conflicto real
                listing = ", ".join(sorted({x["name"] for x in intents}))
                add("error", f"La frase «{key}» está en varias intenciones ({listing}): "
                             "el bot no sabrá cuál elegir.")
    for name, n in names.items():
        if n > 1:
            add("warning", f"Hay {n} intenciones llamadas «{name}».")
    if not fallbacks:
        add("info", "No hay intención de fallback: se usará un texto genérico cuando no entienda.")
    for e in agent.get("entities") or []:
        if not e.get("entries"):
            add("warning", "La entidad no tiene valores.", entity=e)
    order = {"error": 0, "warning": 1, "info": 2}
    out.sort(key=lambda x: order[x["level"]])
    return out

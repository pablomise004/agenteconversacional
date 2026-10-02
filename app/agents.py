"""Definición de agentes: valores por defecto, normalización y plantillas.

Todo lo que llega de la consola o de un fichero importado pasa por
normalize_agent(), que rellena los campos que falten y limpia los nombres,
para que el resto del código pueda confiar en la estructura.
"""

import copy
import re
import secrets
import time

from .nlu.languages import SUPPORTED_LANGUAGES

_NAME_RE = re.compile(r"[^A-Za-z0-9_.\-]+")


def new_id(prefix: str = "") -> str:
    return prefix + secrets.token_hex(5)


def slugify(text: str) -> str:
    from .nlu.text import normalize_text

    s = re.sub(r"[^a-z0-9]+", "-", normalize_text(text or "")).strip("-")
    return s[:40] or "agente"


def clean_name(name: str) -> str:
    """Nombres de entidades, parámetros y contextos: sin espacios ni símbolos raros."""
    from .nlu.text import strip_accents

    name = strip_accents(str(name or "").strip()).replace(" ", "_")
    return _NAME_RE.sub("", name)[:60]


def clean_context(name: str) -> str:
    return clean_name(name).lower().replace("_", "-")


def _str_list(values) -> list[str]:
    out = []
    for v in values or []:
        s = str(v).strip()
        if s and s not in out:
            out.append(s)
    return out


def normalize_entity_ref(entity: str) -> str:
    entity = str(entity or "").strip()
    if not entity:
        return ""
    if not entity.startswith("@"):
        entity = "@" + entity
    return "@" + clean_name(entity[1:])


def normalize_phrase(p) -> dict:
    if isinstance(p, str):
        p = {"text": p, "annotations": None}
    text = str(p.get("text", ""))
    anns = p.get("annotations")
    if anns is not None:
        clean = []
        for a in anns:
            try:
                s, e = int(a["start"]), int(a["end"])
            except (KeyError, TypeError, ValueError):
                continue
            if 0 <= s < e <= len(text):
                clean.append({"start": s, "end": e,
                              "entity": normalize_entity_ref(a.get("entity", "")),
                              "param": clean_name(a.get("param", "")) or "param"})
        clean.sort(key=lambda a: a["start"])
        anns = []
        for a in clean:  # sin solapamientos
            if not anns or a["start"] >= anns[-1]["end"]:
                anns.append(a)
    return {"id": p.get("id") or new_id("p"), "text": text, "annotations": anns}


def normalize_intent(i: dict) -> dict:
    params = []
    for p in i.get("parameters") or []:
        name = clean_name(p.get("name", ""))
        if not name or any(x["name"] == name for x in params):
            continue
        params.append({
            "id": p.get("id") or new_id("a"),
            "name": name,
            "entity": normalize_entity_ref(p.get("entity", "")),
            "required": bool(p.get("required")),
            "isList": bool(p.get("isList")),
            "prompts": _str_list(p.get("prompts")),
            "defaultValue": str(p.get("defaultValue") or ""),
        })
    responses = []
    for r in i.get("responses") or []:
        t = r.get("type", "text")
        if t == "text":
            variants = _str_list(r.get("variants"))
            if variants:
                responses.append({"type": "text", "variants": variants})
        elif t == "quickReplies":
            items = _str_list(r.get("items"))
            if items:
                responses.append({"type": "quickReplies", "items": items})
        elif t == "payload" and isinstance(r.get("payload"), (dict, list)):
            responses.append({"type": "payload", "payload": r["payload"]})
    phrases = [normalize_phrase(p) for p in i.get("trainingPhrases") or []
               if (p if isinstance(p, str) else p.get("text", "")).strip()]
    # como en Dialogflow: anotar una entidad en una frase crea el parámetro
    for ph in phrases:
        for a in ph["annotations"] or []:
            if a["entity"] and not any(x["name"] == a["param"] for x in params):
                params.append({"id": new_id("a"), "name": a["param"], "entity": a["entity"],
                               "required": False, "isList": False, "prompts": [],
                               "defaultValue": ""})
    out_ctx = []
    for c in i.get("outputContexts") or []:
        if isinstance(c, str):
            c = {"name": c, "lifespan": 5}
        name = clean_context(c.get("name", ""))
        if name and not any(x["name"] == name for x in out_ctx):
            try:
                lifespan = max(0, min(100, int(c.get("lifespan", 5))))
            except (TypeError, ValueError):
                lifespan = 5
            out_ctx.append({"name": name, "lifespan": lifespan})
    return {
        "id": i.get("id") or new_id("i"),
        "name": str(i.get("name") or "Nueva intención").strip()[:100],
        "isFallback": bool(i.get("isFallback")),
        "events": [clean_name(e).upper() for e in _str_list(i.get("events")) if clean_name(e)],
        "inputContexts": [c for c in (clean_context(x) for x in _str_list(i.get("inputContexts"))) if c],
        "outputContexts": out_ctx,
        "resetContexts": bool(i.get("resetContexts")),
        "action": str(i.get("action") or "").strip()[:100],
        "parameters": params,
        "trainingPhrases": phrases,
        "responses": responses,
        "webhook": bool(i.get("webhook")),
        "endConversation": bool(i.get("endConversation")),
    }


def normalize_entity(e: dict) -> dict:
    kind = e.get("kind", "map")
    if kind not in ("map", "list", "regex"):
        kind = "map"
    entries = []
    seen = set()
    for en in e.get("entries") or []:
        value = str(en.get("value", "")).strip()
        if not value or value in seen:
            continue
        seen.add(value)
        syns = _str_list(en.get("synonyms")) if kind == "map" else []
        if kind == "map" and value not in syns:
            syns.insert(0, value)
        entries.append({"value": value, "synonyms": syns})
    return {
        "id": e.get("id") or new_id("e"),
        "name": clean_name(e.get("name", "")) or "entidad",
        "kind": kind,
        "fuzzy": bool(e.get("fuzzy", True)),
        "autoExpand": bool(e.get("autoExpand", False)),
        "entries": entries,
    }


DEFAULT_SETTINGS = {
    "threshold": 0.3,
    "defaultLifespan": 5,
    "spellCorrection": True,
    "normalization": {},
    "webhook": {"url": "", "headers": {}, "timeout": 5},
    "apiKey": "",
}


def normalize_settings(s: dict | None) -> dict:
    s = s or {}
    out = copy.deepcopy(DEFAULT_SETTINGS)
    try:
        out["threshold"] = max(0.0, min(1.0, float(s.get("threshold", 0.3))))
    except (TypeError, ValueError):
        pass
    try:
        out["defaultLifespan"] = max(1, min(100, int(s.get("defaultLifespan", 5))))
    except (TypeError, ValueError):
        pass
    out["spellCorrection"] = bool(s.get("spellCorrection", True))
    norm = s.get("normalization") or {}
    if isinstance(norm, dict):
        out["normalization"] = {str(k).strip(): str(v).strip() for k, v in norm.items()
                                if str(k).strip()}
    wh = s.get("webhook") or {}
    headers = wh.get("headers") or {}
    try:
        timeout = max(1.0, min(30.0, float(wh.get("timeout") or 5)))
    except (TypeError, ValueError):
        timeout = 5.0
    out["webhook"] = {
        "url": str(wh.get("url") or "").strip(),
        "headers": {str(k): str(v) for k, v in headers.items()} if isinstance(headers, dict) else {},
        "timeout": timeout,
    }
    out["apiKey"] = str(s.get("apiKey") or "").strip()
    return out


def normalize_agent(agent: dict) -> dict:
    lang = str(agent.get("language") or "es").lower()[:2]
    if lang not in SUPPORTED_LANGUAGES:
        lang = "es"
    intents = [normalize_intent(i) for i in agent.get("intents") or []]
    ids = set()
    for i in intents:  # ids únicos
        while i["id"] in ids:
            i["id"] = new_id("i")
        ids.add(i["id"])
    entities = []
    for e in agent.get("entities") or []:
        e = normalize_entity(e)
        if not any(x["name"] == e["name"] for x in entities):
            entities.append(e)
    out = {
        "id": agent.get("id") or "",
        "name": str(agent.get("name") or "Mi agente").strip()[:100],
        "description": str(agent.get("description") or "").strip()[:500],
        "language": lang,
        "timezone": str(agent.get("timezone") or "Europe/Madrid"),
        "settings": normalize_settings(agent.get("settings")),
        "entities": entities,
        "intents": intents,
        "version": int(agent.get("version") or 0),
        "updatedAt": agent.get("updatedAt") or time.time(),
    }
    # agente de ejemplo copiado al arrancar (server.py:seed_examples): la consola lo enseña aparte
    if agent.get("example"):
        out["example"] = True
    return out


_DEFAULT_TEXTS = {
    "es": {
        "welcome": "Bienvenida",
        "welcome_phrases": ["hola", "buenas", "buenos días", "buenas tardes", "hey", "qué tal"],
        "welcome_resp": ["¡Hola! ¿En qué puedo ayudarte?", "¡Buenas! Cuéntame, ¿qué necesitas?"],
        "fallback": "Fallback",
        "fallback_resp": ["Perdona, no te he entendido. ¿Puedes decirlo de otra forma?",
                          "Vaya, no lo he pillado. ¿Me lo explicas de otra manera?"],
    },
    "en": {
        "welcome": "Welcome",
        "welcome_phrases": ["hi", "hello", "hey", "good morning", "good afternoon", "howdy"],
        "welcome_resp": ["Hi! How can I help you?", "Hello! What can I do for you?"],
        "fallback": "Fallback",
        "fallback_resp": ["Sorry, I didn't get that. Can you say it another way?",
                          "I missed that. Could you rephrase it?"],
    },
}


def blank_agent(name: str, language: str = "es", description: str = "",
                timezone: str = "Europe/Madrid") -> dict:
    t = _DEFAULT_TEXTS.get(language, _DEFAULT_TEXTS["es"])
    return normalize_agent({
        "name": name,
        "description": description,
        "language": language,
        "timezone": timezone,
        "intents": [
            {"name": t["welcome"], "events": ["WELCOME"], "action": "input.welcome",
             "trainingPhrases": [{"text": p, "annotations": []} for p in t["welcome_phrases"]],
             "responses": [{"type": "text", "variants": t["welcome_resp"]}]},
            {"name": t["fallback"], "isFallback": True, "action": "input.unknown",
             "responses": [{"type": "text", "variants": t["fallback_resp"]}]},
        ],
        "entities": [],
    })


def summary(agent: dict) -> dict:
    return {
        "id": agent["id"],
        "name": agent["name"],
        "description": agent.get("description", ""),
        "language": agent.get("language", "es"),
        "intents": len(agent.get("intents") or []),
        "entities": len(agent.get("entities") or []),
        "phrases": sum(len(i.get("trainingPhrases") or []) for i in agent.get("intents") or []),
        "updatedAt": agent.get("updatedAt"),
        "example": bool(agent.get("example")),
    }

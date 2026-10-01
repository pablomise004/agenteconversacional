"""Importación de agentes.

Acepta:
  - JSON exportado por esta aplicación.
  - ZIP exportado desde la consola de Dialogflow ES (Configuración del agente >
    Exportar e importar > Exportar como ZIP).
"""

import io
import json
import zipfile

from .agents import blank_agent, clean_context, clean_name, normalize_agent

MAX_ZIP_FILES = 5000
MAX_UNCOMPRESSED = 50 * 1024 * 1024


class ImportError_(ValueError):
    pass


def import_bytes(data: bytes, filename: str = "") -> dict:
    """Devuelve un agente normalizado (sin id asignado)."""
    if data[:2] == b"PK" or filename.lower().endswith(".zip"):
        return import_dialogflow_zip(data)
    try:
        obj = json.loads(data.decode("utf-8-sig"))
    except (UnicodeDecodeError, ValueError) as e:
        raise ImportError_("El fichero no es un JSON válido ni un ZIP de Dialogflow") from e
    if not isinstance(obj, dict) or "intents" not in obj:
        raise ImportError_("El JSON no parece un agente (falta 'intents')")
    obj.pop("id", None)
    return normalize_agent(obj)


def _read_json(z: zipfile.ZipFile, name: str):
    try:
        return json.loads(z.read(name).decode("utf-8-sig"))
    except (KeyError, UnicodeDecodeError, ValueError):
        return None


def _speech(value) -> list[str]:
    if isinstance(value, list):
        return [str(v) for v in value if str(v).strip()]
    if isinstance(value, str) and value.strip():
        return [value]
    return []


def _df_messages(messages: list, lang: str) -> list[dict]:
    texts: list[str] = []
    replies: list[str] = []
    out: list[dict] = []
    for m in messages or []:
        if m.get("lang") and m.get("lang") != lang:
            continue
        mtype = str(m.get("type"))
        platform = m.get("platform")
        if mtype in ("0", "message") and not platform:
            texts.extend(_speech(m.get("speech")))
        elif mtype == "2" and not platform:
            replies.extend(str(r) for r in m.get("replies") or [])
        elif mtype == "suggestion_chips":
            replies.extend(str(s.get("title")) for s in m.get("suggestions") or [] if s.get("title"))
        elif mtype == "4" and not platform and isinstance(m.get("payload"), (dict, list)):
            out.append({"type": "payload", "payload": m["payload"]})
    result = []
    if texts:
        result.append({"type": "text", "variants": texts})
    if replies:
        result.append({"type": "quickReplies", "items": list(dict.fromkeys(replies))})
    return result + out


def _df_phrase(item: dict) -> dict | None:
    text = ""
    annotations = []
    for part in item.get("data") or []:
        chunk = str(part.get("text", ""))
        meta = part.get("meta")
        if meta and part.get("alias") is not None and chunk.strip():
            annotations.append({"start": len(text), "end": len(text) + len(chunk),
                                "entity": meta, "param": part.get("alias") or meta.lstrip("@")})
        text += chunk
    if not text.strip():
        return None
    # Dialogflow a veces incluye espacios al borde de la anotación
    clean = []
    for a in annotations:
        s, e = a["start"], a["end"]
        while s < e and text[s].isspace():
            s += 1
        while e > s and text[e - 1].isspace():
            e -= 1
        if e > s:
            clean.append(dict(a, start=s, end=e))
    return {"text": text, "annotations": clean}


def import_dialogflow_zip(data: bytes) -> dict:
    try:
        z = zipfile.ZipFile(io.BytesIO(data))
    except zipfile.BadZipFile as e:
        raise ImportError_("El ZIP está dañado") from e
    infos = z.infolist()
    if len(infos) > MAX_ZIP_FILES or sum(i.file_size for i in infos) > MAX_UNCOMPRESSED:
        raise ImportError_("El ZIP es demasiado grande")
    names = {i.filename.replace("\\", "/"): i.filename for i in infos}
    # el ZIP puede tener una carpeta raíz
    prefix = ""
    agent_file = next((n for n in names if n.endswith("agent.json")), None)
    if not agent_file:
        raise ImportError_("No es un ZIP de Dialogflow ES (falta agent.json)")
    prefix = agent_file[: -len("agent.json")]
    meta = _read_json(z, names[agent_file]) or {}
    lang = str(meta.get("language") or "es")[:2]
    agent = blank_agent(meta.get("displayName") or "Agente importado", lang if lang in ("es", "en") else "es")
    agent["description"] = meta.get("description") or meta.get("shortDescription") or ""
    agent["timezone"] = meta.get("defaultTimezone") or "Europe/Madrid"
    settings = agent["settings"]
    if isinstance(meta.get("mlMinConfidence"), (int, float)):
        settings["threshold"] = float(meta["mlMinConfidence"])
    wh = meta.get("webhook") or {}
    if wh.get("url"):
        settings["webhook"] = {"url": wh["url"], "headers": wh.get("headers") or {}, "timeout": 5}
    agent["intents"] = []
    agent["entities"] = []

    # ---- entidades
    for n in sorted(names):
        if not n.startswith(prefix + "entities/") or not n.endswith(".json") or "_entries_" in n:
            continue
        e = _read_json(z, names[n])
        if not isinstance(e, dict) or not e.get("name"):
            continue
        base = n[: -len(".json")]
        entries = _read_json(z, names.get(f"{base}_entries_{lang}.json", "")) if \
            f"{base}_entries_{lang}.json" in names else None
        if entries is None:
            alt = next((m for m in names if m.startswith(base + "_entries_")), None)
            entries = _read_json(z, names[alt]) if alt else []
        agent["entities"].append({
            "name": clean_name(e["name"]),
            "kind": "regex" if e.get("isRegexp") else "map",
            "fuzzy": bool(e.get("allowFuzzyExtraction", True)),
            "autoExpand": bool(e.get("automatedExpansion")),
            "entries": [{"value": x.get("value", ""), "synonyms": x.get("synonyms") or []}
                        for x in entries or [] if isinstance(x, dict)],
        })

    # ---- intenciones
    for n in sorted(names):
        if not n.startswith(prefix + "intents/") or not n.endswith(".json") or "_usersays_" in n:
            continue
        it = _read_json(z, names[n])
        if not isinstance(it, dict) or not it.get("name"):
            continue
        base = n[: -len(".json")]
        says_name = f"{base}_usersays_{lang}.json"
        says = _read_json(z, names[says_name]) if says_name in names else []
        resp = (it.get("responses") or [{}])[0]
        params = []
        for p in resp.get("parameters") or []:
            prompts = [x.get("value") for x in p.get("prompts") or []
                       if isinstance(x, dict) and x.get("lang", lang) == lang and x.get("value")]
            params.append({
                "name": p.get("name", ""), "entity": p.get("dataType", ""),
                "required": bool(p.get("required")), "isList": bool(p.get("isList")),
                "prompts": prompts, "defaultValue": p.get("defaultValue") or "",
            })
        phrases = [ph for ph in (_df_phrase(s) for s in says or [] if isinstance(s, dict)) if ph]
        agent["intents"].append({
            "name": it["name"],
            "isFallback": bool(it.get("fallbackIntent")),
            "events": [e.get("name") for e in it.get("events") or [] if isinstance(e, dict)],
            "inputContexts": [clean_context(c) for c in it.get("contexts") or []],
            "outputContexts": [{"name": clean_context(c.get("name", "")), "lifespan": c.get("lifespan", 5)}
                               for c in resp.get("affectedContexts") or [] if isinstance(c, dict)],
            "resetContexts": bool(resp.get("resetContexts")),
            "action": resp.get("action") or "",
            "parameters": params,
            "trainingPhrases": phrases,
            "responses": _df_messages(resp.get("messages") or [], lang),
            "webhook": bool(it.get("webhookUsed")),
            "endConversation": bool(resp.get("endInteraction") or resp.get("endConversation")),
        })
    if not agent["intents"]:
        raise ImportError_("El ZIP no contiene intenciones")
    agent.pop("id", None)
    return normalize_agent(agent)

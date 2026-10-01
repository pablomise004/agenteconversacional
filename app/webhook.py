"""Llamadas al webhook (fulfillment) con el formato de Dialogflow ES v2.

Un webhook escrito para Dialogflow funciona sin cambios: recibe `queryResult`
con la intención, parámetros y contextos, y puede devolver
`fulfillmentText`, `fulfillmentMessages`, `outputContexts` o
`followupEventInput`.
"""

import json
import time
import urllib.error
import urllib.request


def context_path(agent_id: str, session_id: str, name: str) -> str:
    return f"projects/{agent_id}/agent/sessions/{session_id}/contexts/{name}"


def build_request(agent_id: str, session_id: str, response_id: str, query: dict, payload=None,
                  source: str = "api") -> dict:
    """query: queryText, action, parameters, allRequiredParamsPresent, messages, contexts,
    intent, confidence, language."""
    messages = []
    for m in query.get("messages") or []:
        if m["type"] == "text":
            messages.append({"text": {"text": [m["text"]]}})
        elif m["type"] == "quickReplies":
            messages.append({"quickReplies": {"quickReplies": m["items"]}})
        elif m["type"] == "payload":
            messages.append({"payload": m["payload"]})
    intent = query.get("intent") or {}
    return {
        "responseId": response_id,
        "session": f"projects/{agent_id}/agent/sessions/{session_id}",
        "queryResult": {
            "queryText": query.get("queryText", ""),
            "action": query.get("action", ""),
            "parameters": query.get("parameters") or {},
            "allRequiredParamsPresent": query.get("allRequiredParamsPresent", True),
            "fulfillmentText": "\n".join(m["text"] for m in query.get("messages") or []
                                         if m["type"] == "text"),
            "fulfillmentMessages": messages,
            "outputContexts": [
                {"name": context_path(agent_id, session_id, c["name"]),
                 "lifespanCount": c["lifespan"], "parameters": c.get("parameters") or {}}
                for c in query.get("contexts") or []
            ],
            "intent": {"name": f"projects/{agent_id}/agent/intents/{intent.get('id', '')}",
                       "displayName": intent.get("name", ""),
                       "isFallback": intent.get("isFallback", False)},
            "intentDetectionConfidence": query.get("confidence", 0),
            "languageCode": query.get("language", "es"),
        },
        "originalDetectIntentRequest": {"source": source, "payload": payload or {}},
    }


def parse_messages(raw) -> list[dict]:
    """Convierte fulfillmentMessages de Dialogflow a nuestro formato."""
    out = []
    for m in raw or []:
        if not isinstance(m, dict):
            continue
        if "text" in m:
            for t in (m["text"] or {}).get("text") or []:
                if str(t).strip():
                    out.append({"type": "text", "text": str(t)})
        elif "quickReplies" in m:
            items = (m["quickReplies"] or {}).get("quickReplies") or []
            title = (m["quickReplies"] or {}).get("title")
            if title:
                out.append({"type": "text", "text": str(title)})
            if items:
                out.append({"type": "quickReplies", "items": [str(x) for x in items]})
        elif "payload" in m:
            out.append({"type": "payload", "payload": m["payload"]})
        elif "card" in m:
            card = m["card"] or {}
            text = "\n".join(x for x in (card.get("title"), card.get("subtitle")) if x)
            if text:
                out.append({"type": "text", "text": text})
            buttons = [b.get("text") for b in card.get("buttons") or [] if b.get("text")]
            if buttons:
                out.append({"type": "quickReplies", "items": buttons})
    return out


def call(url: str, body: dict, headers: dict | None = None, timeout: float = 5.0) -> dict:
    """Llama al webhook. Devuelve {ok, status, ms, data, error}."""
    data = json.dumps(body, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(url, data=data, method="POST")
    req.add_header("Content-Type", "application/json; charset=utf-8")
    for k, v in (headers or {}).items():
        req.add_header(k, v)
    t0 = time.time()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read().decode("utf-8") or "{}"
            status = resp.status
        result = json.loads(raw)
        if not isinstance(result, dict):
            raise ValueError("la respuesta no es un objeto JSON")
        return {"ok": True, "status": status, "ms": int((time.time() - t0) * 1000), "data": result,
                "error": None}
    except urllib.error.HTTPError as e:
        return {"ok": False, "status": e.code, "ms": int((time.time() - t0) * 1000), "data": None,
                "error": f"HTTP {e.code}: {e.reason}"}
    except Exception as e:  # noqa: BLE001 - cualquier fallo de red o de formato
        return {"ok": False, "status": None, "ms": int((time.time() - t0) * 1000), "data": None,
                "error": f"{type(e).__name__}: {e}"}

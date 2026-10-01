"""Gestor de diálogo: lleva la conversación turno a turno.

Por cada mensaje del usuario:
  1. Recupera la sesión (contextos activos y, si lo hay, el parámetro que el bot
     estaba preguntando).
  2. Detecta la intención teniendo en cuenta los contextos (o el evento).
  3. Extrae parámetros; si falta alguno obligatorio, lo pregunta (slot filling).
  4. Aplica los contextos de salida, genera la respuesta y llama al webhook.
  5. Guarda la sesión y registra el mensaje (para revisarlo en "Entrenamiento").
"""

from __future__ import annotations

import random
import re
import threading
import time
import uuid
from collections import defaultdict

from . import webhook
from .nlu.engine import Analysis, NLUEngine, entity_kind
from .responses import build_messages, fulfillment_text, render
from .storage import Storage

MAX_TEXT = 1000
SLOT_ESCAPE_CONFIDENCE = 0.8  # otra intención así de segura interrumpe la pregunta


class EngineCache:
    """Un modelo entrenado por agente; se reentrena solo cuando el agente cambia."""

    def __init__(self, storage: Storage):
        self.storage = storage
        self._engines: dict[str, tuple[int, NLUEngine]] = {}
        self._locks: dict[str, threading.Lock] = defaultdict(threading.Lock)
        self.meta: dict[str, dict] = {}

    def get(self, agent_id: str) -> NLUEngine:
        agent = self.storage.agent_ref(agent_id)
        version = agent.get("version", 0)
        cached = self._engines.get(agent_id)
        if cached and cached[0] == version:
            return cached[1]
        with self._locks[agent_id]:
            agent = self.storage.agent_ref(agent_id)
            version = agent.get("version", 0)
            cached = self._engines.get(agent_id)
            if cached and cached[0] == version:
                return cached[1]
            t0 = time.time()
            engine = NLUEngine(agent)
            self._engines[agent_id] = (version, engine)
            self.meta[agent_id] = {
                "version": version,
                "trainedAt": time.time(),
                "ms": int((time.time() - t0) * 1000),
                "examples": len(engine.examples),
                "intents": len(engine.intents),
            }
            return engine

    def drop(self, agent_id: str) -> None:
        self._engines.pop(agent_id, None)
        self.meta.pop(agent_id, None)


def new_state() -> dict:
    return {"contexts": {}, "slot": None, "turn": 0}


def _empty(v) -> bool:
    return v is None or v == "" or v == []


def analysis_dict(engine: NLUEngine, a: Analysis, full: bool = True) -> dict:
    """Resultado del análisis listo para enviar a la consola (o guardar en el registro)."""
    out = {
        "tokens": [t.to_dict() for t in a.tokens],
        "entities": [e.to_dict() for e in a.entities],
        "ranking": [{k: (round(v, 4) if isinstance(v, float) else v) for k, v in r.items()}
                    for r in a.ranking[:5]],
    }
    if full:
        chosen = {id(e) for e in a.entities}
        out["candidates"] = [e.to_dict() for e in a.candidates if id(e) not in chosen]
        out["neighbors"] = a.neighbors
        out["template"] = ({"intent": a.template["intent"], "phrase": a.template["phrase"]}
                           if a.template else None)
    return out


class DialogManager:
    def __init__(self, storage: Storage, engines: EngineCache, rng: random.Random | None = None):
        self.storage = storage
        self.engines = engines
        self.rng = rng or random.Random()

    # ================================================================== API
    def detect(self, agent_id: str, session_id: str, text: str | None = None,
               event: str | None = None, parameters: dict | None = None,
               contexts: list | None = None, payload=None, source: str = "api",
               debug: bool = False, _depth: int = 0) -> dict:
        agent = self.storage.agent_ref(agent_id)
        engine = self.engines.get(agent_id)
        lang = agent.get("language", "es")
        settings = agent.get("settings") or {}
        threshold = float(settings.get("threshold", 0.3))
        res = engine.language.res
        session_id = (str(session_id or "") or uuid.uuid4().hex)[:100]
        text = (text or "").strip()[:MAX_TEXT]
        event = (event or "").strip().upper() or None
        if not text and not event:
            raise ValueError("Hace falta 'text' o 'event'")

        state = self.storage.load_session(agent_id, session_id) or new_state()
        if state.get("ended"):
            state = new_state()
        before: dict = {k: dict(v) for k, v in (state.get("contexts") or {}).items()}
        for c in contexts or []:  # contextos que manda el cliente
            name = str(c.get("name", "")).split("/")[-1].strip().lower()
            if name:
                before[name] = {"lifespan": int(c.get("lifespan", c.get("lifespanCount", 5)) or 0),
                                "parameters": c.get("parameters") or {}}
        before = {k: v for k, v in before.items() if v.get("lifespan", 0) > 0}
        active = list(before)

        turn = {
            "intent": None, "confidence": 0.0, "match": None, "params": {}, "originals": {},
            "analysis": None, "messages": None, "allRequired": True, "set_contexts": {},
            "reset": False, "end": False, "webhook": None, "action": "",
        }

        # ---------------------------------------------- 1. relleno de parámetros
        slot = state.get("slot")
        if slot and text and not event:
            sf_intent = engine.intents.get(slot.get("intentId"))
            if not sf_intent:
                state["slot"] = None
            elif self._is_cancel(engine, text):
                state["slot"] = None
                turn.update(intent=sf_intent, match="cancel", confidence=1.0,
                            messages=[{"type": "text", "text": res.TEXTS["cancelled"]}],
                            allRequired=False)
            else:
                a = engine.analyze(text, active, neighbors=3 if debug else 0)
                turn["analysis"] = a
                pdefs = {p["name"]: p for p in sf_intent.get("parameters") or []}
                pending = pdefs.get(slot.get("param"))
                got = engine.fill_slot(pending, a) if pending else None
                extra, extra_orig = engine.extract_parameters(sf_intent, a)
                if got:
                    slot["params"][pending["name"]] = got[0]
                    slot["originals"][pending["name"]] = got[1]
                for k, v in extra.items():
                    if k != slot.get("param") and _empty(slot["params"].get(k)):
                        slot["params"][k] = v
                        slot["originals"][k] = extra_orig.get(k, v)
                best = a.best
                escape = (not got and best and best["id"] != sf_intent["id"]
                          and not best["isFallback"] and best["confidence"] >= SLOT_ESCAPE_CONFIDENCE)
                if escape:
                    state["slot"] = None  # el usuario ha cambiado de tema
                elif not got:
                    slot["attempts"] = slot.get("attempts", 0) + 1
                    turn.update(intent=sf_intent, match="slot", confidence=slot.get("confidence", 1.0),
                                params=dict(slot["params"]), originals=dict(slot["originals"]),
                                messages=self._prompt(pending, slot, lang, before), allRequired=False)
                else:
                    state["slot"] = None
                    turn.update(intent=sf_intent, match="slot",
                                confidence=slot.get("confidence", 1.0),
                                params=dict(slot["params"]), originals=dict(slot["originals"]))

        # ------------------------------------------------ 2. detectar intención
        if turn["intent"] is None:
            if event:
                intent = self._intent_for_event(engine, event, active)
                turn.update(intent=intent, match="event", confidence=1.0 if intent else 0.0,
                            params=dict(parameters or {}), originals=dict(parameters or {}))
                if intent is None:
                    turn["intent"] = self._fallback_intent(engine, active)
                    turn["match"] = "fallback"
            else:
                a = turn["analysis"] or engine.analyze(text, active, neighbors=3 if debug else 0)
                turn["analysis"] = a
                best = a.best
                if best and not best["isFallback"] and best["confidence"] >= threshold:
                    intent = engine.intents[best["id"]]
                    params, originals = engine.extract_parameters(intent, a)
                    turn.update(intent=intent, match=best["match"], confidence=best["confidence"],
                                params=params, originals=originals)
                else:
                    turn.update(intent=self._fallback_intent(engine, active), match="fallback",
                                confidence=best["confidence"] if best else 0.0)

        # ------------------------------------------------ 3. completar intención
        intent = turn["intent"]
        render_ctx = dict(before)
        if turn["messages"] is None:
            if intent is None:  # sin intención de fallback definida
                turn["messages"] = [{"type": "text", "text": res.TEXTS["fallback"]}]
            else:
                self._apply_defaults(intent, turn, render_ctx)
                missing = [p for p in intent.get("parameters") or []
                           if p.get("required") and _empty(turn["params"].get(p["name"]))]
                if missing and turn["match"] != "fallback":
                    p = missing[0]
                    state["slot"] = {"intentId": intent["id"], "param": p["name"],
                                     "params": turn["params"], "originals": turn["originals"],
                                     "attempts": 0, "confidence": turn["confidence"]}
                    turn["messages"] = self._prompt(p, state["slot"], lang, render_ctx)
                    turn["allRequired"] = False
                else:
                    self._complete(agent, engine, intent, turn, render_ctx, settings)
        turn["action"] = (intent or {}).get("action", "")

        # ------------------------------------------------ 4. webhook
        followup = None
        if intent and turn["allRequired"] and intent.get("webhook") \
                and (settings.get("webhook") or {}).get("url") and turn["match"] != "cancel":
            followup = self._call_webhook(agent, session_id, text or event or "", turn,
                                          before, payload, source)

        # ------------------------------------------------ 5. contextos y sesión
        final = {}
        if not turn["reset"]:
            for name, c in before.items():
                if name in turn["set_contexts"]:
                    continue
                left = c["lifespan"] - 1
                if left > 0:
                    final[name] = {"lifespan": left, "parameters": c.get("parameters") or {}}
        for name, c in turn["set_contexts"].items():
            if c["lifespan"] > 0:
                final[name] = c
        state["contexts"] = final
        state["turn"] = state.get("turn", 0) + 1
        if turn["end"]:
            final = {}
            state = new_state()
            state["ended"] = True
        self.storage.save_session(agent_id, session_id, state)

        messages = turn["messages"] or []
        result = {
            "responseId": uuid.uuid4().hex,
            "sessionId": session_id,
            "queryText": text,
            "event": event,
            "intent": ({"id": intent["id"], "name": intent["name"],
                        "isFallback": bool(intent.get("isFallback"))} if intent else None),
            "confidence": round(turn["confidence"], 4),
            "match": turn["match"],
            "action": turn["action"],
            "parameters": turn["params"],
            "parametersOriginal": turn["originals"],
            "allRequiredParamsPresent": turn["allRequired"],
            "fulfillmentText": fulfillment_text(messages),
            "messages": messages,
            "outputContexts": [{"name": k, "lifespan": v["lifespan"], "parameters": v["parameters"]}
                               for k, v in final.items()],
            "endConversation": turn["end"],
            "webhook": turn["webhook"],
        }
        a = turn["analysis"]
        log_entry = {
            "sessionId": session_id, "source": source, "query": text, "event": event,
            "intentId": intent["id"] if intent else None,
            "intentName": intent["name"] if intent else None,
            "confidence": turn["confidence"], "match": turn["match"],
            "isFallback": bool(intent and intent.get("isFallback")) or turn["match"] == "fallback",
            "parameters": turn["params"], "response": result["fulfillmentText"],
            "analysis": dict(analysis_dict(engine, a, full=False), contexts=active) if a else
            {"contexts": active},
        }
        result["logId"] = self.storage.add_log(agent_id, log_entry)
        if debug and a:
            result["analysis"] = analysis_dict(engine, a, full=True)
            result["activeContexts"] = active
        if followup and _depth < 3:
            follow = self.detect(agent_id, session_id, event=followup.get("name"),
                                 parameters=followup.get("parameters") or {}, payload=payload,
                                 source=source, debug=debug, _depth=_depth + 1)
            follow["previous"] = result
            return follow
        return result

    def reset(self, agent_id: str, session_id: str) -> None:
        self.storage.delete_session(agent_id, session_id)

    # ============================================================ auxiliares
    @staticmethod
    def _is_cancel(engine: NLUEngine, text: str) -> bool:
        res = engine.language.res
        words = [t.key for t in engine.tokenizer.tokenize(text) if t.kind != "symbol"]
        return bool(words) and any(w in res.CANCEL_WORDS for w in words) and all(
            w in res.CANCEL_WORDS or w in res.CANCEL_FILLER for w in words)

    @staticmethod
    def _intent_for_event(engine: NLUEngine, event: str, active: list[str]):
        active_set = {c.lower() for c in active}
        best = None
        for intent in engine.intents.values():
            if event not in (e.upper() for e in intent.get("events") or []):
                continue
            needed = {c.lower() for c in intent.get("inputContexts") or []}
            if needed <= active_set and (best is None or len(needed) > best[0]):
                best = (len(needed), intent)
        return best[1] if best else None

    @staticmethod
    def _fallback_intent(engine: NLUEngine, active: list[str]):
        """La intención de fallback más específica para los contextos activos."""
        active_set = {c.lower() for c in active}
        best = None
        for intent in engine.intents.values():
            if not intent.get("isFallback"):
                continue
            needed = {c.lower() for c in intent.get("inputContexts") or []}
            if needed <= active_set and (best is None or len(needed) > best[0]):
                best = (len(needed), intent)
        return best[1] if best else None

    def _prompt(self, param: dict | None, slot: dict, lang: str, contexts: dict) -> list[dict]:
        if param and param.get("prompts"):
            text = self.rng.choice(param["prompts"])
        else:
            name = (param or {}).get("name", "").replace("_", " ")
            text = f"¿Me indicas {name}?" if lang == "es" else f"What is the {name}?"
        return [{"type": "text", "text": render(text, slot["params"], slot["originals"], contexts,
                                                 lang)}]

    @staticmethod
    def _apply_defaults(intent: dict, turn: dict, contexts: dict) -> None:
        for p in intent.get("parameters") or []:
            name = p["name"]
            if not _empty(turn["params"].get(name)) or not p.get("defaultValue"):
                continue
            dv = p["defaultValue"].strip()
            value = None
            m = re.fullmatch(r"#([\w\-]+)\.([\w\-]+)", dv)
            if m:
                value = ((contexts.get(m.group(1).lower()) or {}).get("parameters") or {}).get(m.group(2))
            elif re.fullmatch(r"\$([\w\-]+)", dv):
                value = turn["params"].get(dv[1:])
            else:
                value = dv
                if entity_kind(p.get("entity", "")) in ("@sys.number", "@sys.number-integer"):
                    try:
                        num = float(dv.replace(",", "."))
                        value = int(num) if num.is_integer() else num
                    except ValueError:
                        pass
            if not _empty(value):
                turn["params"][name] = value
                turn["originals"].setdefault(name, value if isinstance(value, str) else dv)

    def _complete(self, agent, engine, intent, turn, render_ctx, settings) -> None:
        """La intención tiene todo lo necesario: contextos de salida y respuesta."""
        lang = agent.get("language", "es")
        if intent.get("resetContexts"):
            turn["reset"] = True
        ctx_params = dict(turn["params"])
        for k, v in turn["originals"].items():
            ctx_params[k + ".original"] = v
        for oc in intent.get("outputContexts") or []:
            name = oc["name"].lower()
            old = {} if turn["reset"] else (render_ctx.get(name) or {}).get("parameters") or {}
            merged = dict(old)
            merged.update(ctx_params)
            turn["set_contexts"][name] = {"lifespan": int(oc.get("lifespan", 5)), "parameters": merged}
            if oc.get("lifespan", 5) > 0:
                render_ctx[name] = turn["set_contexts"][name]
        turn["messages"] = build_messages(intent, turn["params"], turn["originals"], render_ctx, lang,
                                          self.rng)
        if not turn["messages"] and intent.get("isFallback"):
            turn["messages"] = [{"type": "text", "text": engine.language.res.TEXTS["fallback"]}]
        turn["end"] = bool(intent.get("endConversation"))

    def _call_webhook(self, agent, session_id, query_text, turn, before, payload, source):
        settings = agent.get("settings") or {}
        wh = settings.get("webhook") or {}
        intent = turn["intent"]
        contexts = dict(before)
        contexts.update(turn["set_contexts"])
        body = webhook.build_request(agent["id"], session_id, uuid.uuid4().hex, {
            "queryText": query_text, "action": intent.get("action", ""),
            "parameters": turn["params"], "allRequiredParamsPresent": True,
            "messages": turn["messages"] or [],
            "contexts": [{"name": k, "lifespan": v["lifespan"], "parameters": v.get("parameters")}
                         for k, v in contexts.items() if v.get("lifespan", 0) > 0],
            "intent": intent, "confidence": turn["confidence"],
            "language": agent.get("language", "es"),
        }, payload=payload, source=source)
        r = webhook.call(wh["url"], body, wh.get("headers"), float(wh.get("timeout") or 5))
        turn["webhook"] = {"called": True, "ok": r["ok"], "status": r["status"], "ms": r["ms"],
                           "error": r["error"]}
        if not r["ok"]:
            return None
        data = r["data"] or {}
        msgs = webhook.parse_messages(data.get("fulfillmentMessages"))
        if msgs:
            turn["messages"] = msgs
        elif str(data.get("fulfillmentText") or "").strip():
            turn["messages"] = [{"type": "text", "text": str(data["fulfillmentText"])}]
        if data.get("payload") is not None:
            turn["messages"] = (turn["messages"] or []) + [{"type": "payload", "payload": data["payload"]}]
        for oc in data.get("outputContexts") or []:
            name = str(oc.get("name", "")).split("/")[-1].strip().lower()
            if not name:
                continue
            lifespan = int(oc.get("lifespanCount", oc.get("lifespan", 5)) or 0)
            turn["set_contexts"][name] = {"lifespan": lifespan, "parameters": oc.get("parameters") or {}}
        follow = data.get("followupEventInput")
        if isinstance(follow, dict) and follow.get("name"):
            return follow
        return None

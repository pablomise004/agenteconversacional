"""Servidor web: API REST + consola + widget de chat.

La documentación interactiva de la API está en /docs.
"""

from __future__ import annotations

import json
import os
import secrets
import time
from pathlib import Path
from typing import Any

from fastapi import Body, Depends, FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from . import __version__
from .agents import blank_agent, new_id, normalize_entity, normalize_intent, normalize_phrase
from .dialog import DialogManager, EngineCache, analysis_dict
from .importer import ImportError_, import_bytes
from .nlu import insights
from .nlu.languages import SUPPORTED_LANGUAGES
from .nlu.sys_entities import SYSTEM_ENTITIES
from .nlu.text import normalize_text
from .storage import NotFound, Storage
from .validation import validate

ROOT = Path(__file__).resolve().parent.parent
WEB_DIR = ROOT / "web"
DOCS_DIR = ROOT / "docs"
EXAMPLES_DIR = ROOT / "examples"


# ---------------------------------------------------------------- modelos
class CreateAgent(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    language: str = "es"
    description: str = ""
    timezone: str = "Europe/Madrid"
    template: str = "blank"  # blank | pizzeria


class DetectRequest(BaseModel):
    sessionId: str | None = None
    text: str | None = None
    event: str | None = None
    parameters: dict[str, Any] | None = None
    contexts: list[dict[str, Any]] | None = None
    payload: Any = None
    source: str = "api"
    debug: bool = False


class AnalyzeRequest(BaseModel):
    text: str
    contexts: list[str] | None = None


class AnnotateRequest(BaseModel):
    text: str
    intentId: str | None = None


class PhraseRequest(BaseModel):
    text: str
    annotations: list[dict[str, Any]] | None = None


class SynonymRequest(BaseModel):
    value: str
    synonym: str


class ExplainRequest(BaseModel):
    text: str
    contexts: list[str] | None = None


class EvaluateRequest(BaseModel):
    folds: int = Field(5, ge=2, le=10)


class ReviewRequest(BaseModel):
    action: str  # approve | assign | ignore | reopen
    intentId: str | None = None
    text: str | None = None
    annotations: list[dict[str, Any]] | None = None


def create_app(data_dir: Path | None = None) -> FastAPI:
    data_dir = Path(data_dir or os.environ.get("AGENTE_DATA_DIR") or ROOT / "data")
    storage = Storage(data_dir)
    if not storage.list_agents():
        example = EXAMPLES_DIR / "pizzeria.json"
        if example.exists():
            storage.save_agent(json.loads(example.read_text(encoding="utf-8")))
    engines = EngineCache(storage)
    dialog = DialogManager(storage, engines)
    admin_token = os.environ.get("AGENTE_ADMIN_TOKEN", "").strip()
    evaluations: dict[str, dict] = {}  # último examen por agente

    app = FastAPI(
        title="Agente conversacional",
        version=__version__,
        description="Alternativa libre a Dialogflow: API de agentes, intenciones, entidades y "
                    "conversación.",
    )
    app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"],
                       allow_headers=["*"])
    app.state.storage = storage
    app.state.dialog = dialog
    app.state.engines = engines

    # ------------------------------------------------------------ helpers
    def is_admin(request: Request) -> bool:
        if not admin_token:
            return True
        auth = request.headers.get("authorization", "")
        token = auth[7:] if auth.lower().startswith("bearer ") else request.query_params.get("token", "")
        return secrets.compare_digest(token, admin_token)

    def admin(request: Request) -> None:
        if not is_admin(request):
            raise HTTPException(401, "Hace falta el token de administración")

    def get_agent(agent_id: str) -> dict:
        try:
            return storage.get_agent(agent_id)
        except NotFound:
            raise HTTPException(404, "No existe ese agente") from None

    def check_key(agent_id: str, request: Request) -> None:
        agent = get_agent(agent_id)
        key = (agent.get("settings") or {}).get("apiKey")
        if not key or is_admin(request) and admin_token:
            return
        given = request.headers.get("x-api-key") or request.query_params.get("key", "")
        if not secrets.compare_digest(given, key):
            raise HTTPException(401, "Clave de API incorrecta")

    def find(items: list[dict], item_id: str, what: str) -> dict:
        for it in items:
            if it["id"] == item_id:
                return it
        raise HTTPException(404, f"No existe {what}")

    def add_phrase(agent: dict, intent_id: str, text: str, annotations) -> dict:
        intent = find(agent["intents"], intent_id, "esa intención")
        key = normalize_text(text).strip(" ?¿!¡.")
        # la frase se mueve: si estaba en otra intención (sin contextos distintos), se quita
        for other in agent["intents"]:
            if other["id"] != intent_id and other.get("inputContexts") == intent.get("inputContexts"):
                other["trainingPhrases"] = [p for p in other["trainingPhrases"]
                                            if normalize_text(p["text"]).strip(" ?¿!¡.") != key]
        if annotations is None:
            engine = engines.get(agent["id"])
            annotations = engine.auto_annotate(text, intent)["annotations"]
        phrase = normalize_phrase({"text": text, "annotations": annotations})
        intent["trainingPhrases"] = [p for p in intent["trainingPhrases"]
                                     if normalize_text(p["text"]).strip(" ?¿!¡.") != key]
        intent["trainingPhrases"].insert(0, phrase)
        return phrase

    def engine_status(agent_id: str) -> dict:
        agent = storage.agent_ref(agent_id)
        meta = engines.meta.get(agent_id) or {}
        return {"version": agent.get("version"), "trainedVersion": meta.get("version"),
                "upToDate": meta.get("version") == agent.get("version"), **meta}

    # ---------------------------------------------------------------- info
    @app.get("/api/info", tags=["general"])
    def info():
        return {
            "version": __version__,
            "languages": SUPPORTED_LANGUAGES,
            "systemEntities": [{"name": k, "description": v} for k, v in SYSTEM_ENTITIES.items()],
            "adminTokenRequired": bool(admin_token),
        }

    @app.get("/api/auth-check", tags=["general"], dependencies=[Depends(admin)])
    def auth_check():
        return {"ok": True}

    # -------------------------------------------------------------- agentes
    @app.get("/api/agents", tags=["agentes"], dependencies=[Depends(admin)])
    def list_agents():
        return storage.list_agents()

    @app.post("/api/agents", tags=["agentes"], dependencies=[Depends(admin)], status_code=201)
    def create_agent(req: CreateAgent):
        if req.template == "pizzeria" and (EXAMPLES_DIR / "pizzeria.json").exists():
            agent = json.loads((EXAMPLES_DIR / "pizzeria.json").read_text(encoding="utf-8"))
            agent["name"] = req.name
        else:
            agent = blank_agent(req.name, req.language if req.language in SUPPORTED_LANGUAGES else "es",
                                req.description, req.timezone)
        agent["id"] = storage.unique_id(req.name)
        agent["version"] = 0
        return storage.save_agent(agent)

    @app.post("/api/agents/import", tags=["agentes"], dependencies=[Depends(admin)], status_code=201)
    async def import_agent(request: Request, name: str = "", filename: str = ""):
        data = await request.body()
        if not data:
            raise HTTPException(400, "El fichero está vacío")
        if len(data) > 30 * 1024 * 1024:
            raise HTTPException(413, "El fichero es demasiado grande (máx. 30 MB)")
        try:
            agent = import_bytes(data, filename)
        except ImportError_ as e:
            raise HTTPException(400, str(e)) from None
        if name.strip():
            agent["name"] = name.strip()
        agent["id"] = storage.unique_id(agent["name"])
        agent["version"] = 0
        return storage.save_agent(agent)

    @app.get("/api/agents/{agent_id}", tags=["agentes"], dependencies=[Depends(admin)])
    def read_agent(agent_id: str):
        return get_agent(agent_id)

    @app.patch("/api/agents/{agent_id}", tags=["agentes"], dependencies=[Depends(admin)])
    def update_agent(agent_id: str, changes: dict = Body(...)):
        agent = get_agent(agent_id)
        for k in ("name", "description", "language", "timezone"):
            if k in changes:
                agent[k] = changes[k]
        if isinstance(changes.get("settings"), dict):
            settings = dict(agent["settings"])
            settings.update(changes["settings"])
            agent["settings"] = settings
        return storage.save_agent(agent)

    @app.delete("/api/agents/{agent_id}", tags=["agentes"], dependencies=[Depends(admin)])
    def delete_agent(agent_id: str):
        try:
            storage.delete_agent(agent_id)
        except NotFound:
            raise HTTPException(404, "No existe ese agente") from None
        engines.drop(agent_id)
        return {"ok": True}

    @app.get("/api/agents/{agent_id}/export", tags=["agentes"], dependencies=[Depends(admin)])
    def export_agent(agent_id: str):
        agent = get_agent(agent_id)
        for k in ("version", "updatedAt"):
            agent.pop(k, None)
        body = json.dumps(agent, ensure_ascii=False, indent=2)
        return Response(body, media_type="application/json", headers={
            "Content-Disposition": f'attachment; filename="{agent_id}.json"'})

    @app.post("/api/agents/{agent_id}/duplicate", tags=["agentes"], dependencies=[Depends(admin)],
              status_code=201)
    def duplicate_agent(agent_id: str):
        agent = get_agent(agent_id)
        agent["name"] = agent["name"] + " (copia)"
        agent["id"] = storage.unique_id(agent["name"])
        agent["version"] = 0
        return storage.save_agent(agent)

    @app.post("/api/agents/{agent_id}/train", tags=["entrenamiento"], dependencies=[Depends(admin)])
    def train(agent_id: str):
        get_agent(agent_id)
        engines.drop(agent_id)
        engine = engines.get(agent_id)
        return dict(engine_status(agent_id), report=engine.report)

    @app.get("/api/agents/{agent_id}/model", tags=["entrenamiento"], dependencies=[Depends(admin)])
    def model_info(agent_id: str, k: int = Query(8, ge=1, le=30), chars: bool = False):
        """Lo que ha aprendido el modelo: informe, rasgos por intención y mapa de frases."""
        agent = get_agent(agent_id)
        engine = engines.get(agent_id)
        last = evaluations.get(agent_id)
        return {
            "status": engine_status(agent_id),
            "report": engine.report,
            "threshold": agent["settings"]["threshold"],
            "topFeatures": insights.top_features(engine, k=k, include_chars=chars),
            "projection": insights.public_projection(engine),
            "evaluation": last["result"] if last and last["version"] == agent["version"] else None,
        }

    @app.post("/api/agents/{agent_id}/explain", tags=["entrenamiento"], dependencies=[Depends(admin)])
    def explain(agent_id: str, req: ExplainRequest):
        """Recorrido completo de una frase por dentro del modelo."""
        agent = get_agent(agent_id)
        engine = engines.get(agent_id)
        return insights.explain(engine, req.text[:1000], req.contexts or [], agent["settings"]["threshold"])

    @app.post("/api/agents/{agent_id}/evaluate", tags=["entrenamiento"], dependencies=[Depends(admin)])
    def evaluate(agent_id: str, req: EvaluateRequest | None = None):
        """Examen con validación cruzada: acierto con frases que el modelo no ha visto."""
        agent = get_agent(agent_id)
        result = insights.evaluate(agent, folds=(req.folds if req else 5))
        evaluations[agent_id] = {"version": agent["version"], "result": result}
        return result

    @app.get("/api/agents/{agent_id}/status", tags=["entrenamiento"], dependencies=[Depends(admin)])
    def status(agent_id: str):
        get_agent(agent_id)
        return engine_status(agent_id)

    @app.get("/api/agents/{agent_id}/validate", tags=["entrenamiento"], dependencies=[Depends(admin)])
    def validate_agent(agent_id: str):
        return validate(get_agent(agent_id))

    # ---------------------------------------------------------- intenciones
    @app.post("/api/agents/{agent_id}/intents", tags=["intenciones"], dependencies=[Depends(admin)],
              status_code=201)
    def create_intent(agent_id: str, intent: dict = Body(...)):
        agent = get_agent(agent_id)
        intent = dict(intent)
        intent["id"] = new_id("i")
        data = normalize_intent(intent)
        agent["intents"].append(data)
        saved = storage.save_agent(agent)
        return find(saved["intents"], data["id"], "esa intención")

    @app.put("/api/agents/{agent_id}/intents/{intent_id}", tags=["intenciones"],
             dependencies=[Depends(admin)])
    def update_intent(agent_id: str, intent_id: str, intent: dict = Body(...)):
        agent = get_agent(agent_id)
        old = find(agent["intents"], intent_id, "esa intención")
        intent = dict(intent)
        intent["id"] = intent_id
        agent["intents"][agent["intents"].index(old)] = normalize_intent(intent)
        saved = storage.save_agent(agent)
        return find(saved["intents"], intent_id, "esa intención")

    @app.delete("/api/agents/{agent_id}/intents/{intent_id}", tags=["intenciones"],
                dependencies=[Depends(admin)])
    def delete_intent(agent_id: str, intent_id: str):
        agent = get_agent(agent_id)
        find(agent["intents"], intent_id, "esa intención")
        agent["intents"] = [i for i in agent["intents"] if i["id"] != intent_id]
        storage.save_agent(agent)
        return {"ok": True}

    @app.post("/api/agents/{agent_id}/intents/{intent_id}/phrases", tags=["intenciones"],
              dependencies=[Depends(admin)], status_code=201)
    def create_phrase(agent_id: str, intent_id: str, req: PhraseRequest):
        agent = get_agent(agent_id)
        if not req.text.strip():
            raise HTTPException(400, "La frase está vacía")
        phrase = add_phrase(agent, intent_id, req.text.strip(), req.annotations)
        storage.save_agent(agent)
        return phrase

    # ------------------------------------------------------------ entidades
    @app.post("/api/agents/{agent_id}/entities", tags=["entidades"], dependencies=[Depends(admin)],
              status_code=201)
    def create_entity(agent_id: str, entity: dict = Body(...)):
        agent = get_agent(agent_id)
        data = normalize_entity(dict(entity, id=new_id("e")))
        if any(e["name"] == data["name"] for e in agent["entities"]):
            raise HTTPException(409, f"Ya existe una entidad llamada @{data['name']}")
        agent["entities"].append(data)
        storage.save_agent(agent)
        return data

    @app.put("/api/agents/{agent_id}/entities/{entity_id}", tags=["entidades"],
             dependencies=[Depends(admin)])
    def update_entity(agent_id: str, entity_id: str, entity: dict = Body(...)):
        agent = get_agent(agent_id)
        old = find(agent["entities"], entity_id, "esa entidad")
        data = normalize_entity(dict(entity, id=entity_id))
        if any(e["name"] == data["name"] and e["id"] != entity_id for e in agent["entities"]):
            raise HTTPException(409, f"Ya existe una entidad llamada @{data['name']}")
        if data["name"] != old["name"]:  # renombrar también las referencias
            before, after = "@" + old["name"], "@" + data["name"]
            for i in agent["intents"]:
                for p in i["parameters"]:
                    if p["entity"] == before:
                        p["entity"] = after
                for ph in i["trainingPhrases"]:
                    for a in ph.get("annotations") or []:
                        if a["entity"] == before:
                            a["entity"] = after
        agent["entities"][agent["entities"].index(old)] = data
        storage.save_agent(agent)
        return data

    @app.delete("/api/agents/{agent_id}/entities/{entity_id}", tags=["entidades"],
                dependencies=[Depends(admin)])
    def delete_entity(agent_id: str, entity_id: str):
        agent = get_agent(agent_id)
        find(agent["entities"], entity_id, "esa entidad")
        agent["entities"] = [e for e in agent["entities"] if e["id"] != entity_id]
        storage.save_agent(agent)
        return {"ok": True}

    @app.post("/api/agents/{agent_id}/entities/{entity_id}/synonyms", tags=["entidades"],
              dependencies=[Depends(admin)])
    def add_synonym(agent_id: str, entity_id: str, req: SynonymRequest):
        agent = get_agent(agent_id)
        entity = find(agent["entities"], entity_id, "esa entidad")
        value, syn = req.value.strip(), req.synonym.strip()
        if not value:
            raise HTTPException(400, "Falta el valor")
        entry = next((e for e in entity["entries"] if e["value"] == value), None)
        if entry is None:
            entry = {"value": value, "synonyms": [value]}
            entity["entries"].append(entry)
        if syn and syn not in entry["synonyms"]:
            entry["synonyms"].append(syn)
        saved = storage.save_agent(agent)
        return find(saved["entities"], entity_id, "esa entidad")

    # ------------------------------------------------------- NLU y diálogo
    @app.post("/api/agents/{agent_id}/annotate", tags=["nlu"], dependencies=[Depends(admin)])
    def annotate(agent_id: str, req: AnnotateRequest):
        agent = get_agent(agent_id)
        intent = next((i for i in agent["intents"] if i["id"] == req.intentId), None)
        return engines.get(agent_id).auto_annotate(req.text, intent)

    @app.post("/api/agents/{agent_id}/analyze", tags=["nlu"], dependencies=[Depends(admin)])
    def analyze(agent_id: str, req: AnalyzeRequest):
        agent = get_agent(agent_id)
        engine = engines.get(agent_id)
        t0 = time.time()
        a = engine.analyze(req.text[:1000], req.contexts or [], neighbors=5)
        out = analysis_dict(engine, a, full=True)
        best = a.best
        threshold = agent["settings"]["threshold"]
        out["threshold"] = threshold
        out["accepted"] = bool(best and not best["isFallback"] and best["confidence"] >= threshold)
        out["parameters"] = {}
        out["parametersOriginal"] = {}
        if best and not best["isFallback"]:
            intent = engine.intents[best["id"]]
            out["parameters"], out["parametersOriginal"] = engine.extract_parameters(intent, a)
        out["ms"] = int((time.time() - t0) * 1000)
        return out

    @app.post("/api/agents/{agent_id}/detect", tags=["conversación"])
    def detect(agent_id: str, req: DetectRequest, request: Request):
        check_key(agent_id, request)
        try:
            return dialog.detect(agent_id, req.sessionId or "", text=req.text, event=req.event,
                                 parameters=req.parameters, contexts=req.contexts,
                                 payload=req.payload, source=(req.source or "api")[:20],
                                 debug=req.debug)
        except ValueError as e:
            raise HTTPException(400, str(e)) from None

    @app.post("/api/agents/{agent_id}/sessions/{session_id}/reset", tags=["conversación"])
    def reset_session(agent_id: str, session_id: str, request: Request):
        check_key(agent_id, request)
        dialog.reset(agent_id, session_id)
        return {"ok": True}

    @app.get("/api/agents/{agent_id}/public", tags=["conversación"])
    def public_info(agent_id: str):
        """Datos mínimos para el widget de chat."""
        agent = get_agent(agent_id)
        return {"id": agent["id"], "name": agent["name"], "language": agent["language"],
                "needsKey": bool(agent["settings"].get("apiKey"))}

    # ------------------------------------------- entrenamiento e historial
    @app.get("/api/agents/{agent_id}/logs", tags=["entrenamiento"], dependencies=[Depends(admin)])
    def list_logs(agent_id: str, review: str | None = "pending", fallback: bool = False,
                  lowConfidence: float | None = None, q: str = "", limit: int = Query(100, le=500),
                  offset: int = 0):
        get_agent(agent_id)
        items, total = storage.list_logs(agent_id, review=review or None, only_fallback=fallback,
                                         max_confidence=lowConfidence, search=q, limit=limit,
                                         offset=offset)
        return {"items": items, "total": total}

    @app.post("/api/agents/{agent_id}/logs/{log_id}/review", tags=["entrenamiento"],
              dependencies=[Depends(admin)])
    def review_log(agent_id: str, log_id: int, req: ReviewRequest):
        agent = get_agent(agent_id)
        try:
            log = storage.get_log(agent_id, log_id)
        except NotFound:
            raise HTTPException(404, "No existe ese mensaje") from None
        text = (req.text or log.get("query") or "").strip()
        if req.action == "ignore":
            storage.set_review(agent_id, [log_id], "ignored")
            return {"ok": True, "review": "ignored"}
        if req.action == "reopen":
            storage.set_review(agent_id, [log_id], "pending")
            return {"ok": True, "review": "pending"}
        if req.action not in ("approve", "assign"):
            raise HTTPException(400, "Acción desconocida")
        intent_id = req.intentId if req.action == "assign" else log.get("intentId")
        if not intent_id:
            raise HTTPException(400, "Indica a qué intención pertenece la frase")
        if not text:
            raise HTTPException(400, "El mensaje no tiene texto")
        phrase = add_phrase(agent, intent_id, text, req.annotations)
        storage.save_agent(agent)
        review = "approved" if req.action == "approve" else "corrected"
        storage.set_review(agent_id, [log_id], review)
        storage.review_similar(agent_id, text, review)
        return {"ok": True, "review": review, "phrase": phrase, "intentId": intent_id}

    @app.post("/api/agents/{agent_id}/logs/clear", tags=["entrenamiento"], dependencies=[Depends(admin)])
    def clear_logs(agent_id: str):
        get_agent(agent_id)
        storage.clear_logs(agent_id)
        return {"ok": True}

    @app.get("/api/agents/{agent_id}/conversations", tags=["historial"], dependencies=[Depends(admin)])
    def conversations(agent_id: str, limit: int = Query(50, le=500), offset: int = 0):
        get_agent(agent_id)
        items, total = storage.conversations(agent_id, limit, offset)
        return {"items": items, "total": total}

    @app.get("/api/agents/{agent_id}/conversations/{session_id}", tags=["historial"],
             dependencies=[Depends(admin)])
    def conversation(agent_id: str, session_id: str):
        get_agent(agent_id)
        return storage.conversation(agent_id, session_id)

    @app.get("/api/agents/{agent_id}/stats", tags=["historial"], dependencies=[Depends(admin)])
    def stats(agent_id: str, days: int = 30):
        get_agent(agent_id)
        return storage.stats(agent_id, days)

    @app.get("/api/system-entities", tags=["general"])
    def system_entities():
        return [{"name": k, "description": v} for k, v in SYSTEM_ENTITIES.items()]

    # ---------------------------------------- compatibilidad con Dialogflow
    @app.post("/v2/projects/{agent_id}/agent/sessions/{session_id}:detectIntent",
              tags=["compatibilidad Dialogflow"])
    def df_detect(agent_id: str, session_id: str, request: Request, body: dict = Body(...)):
        """Mismo formato que detectIntent de Dialogflow ES v2."""
        check_key(agent_id, request)
        qi = body.get("queryInput") or {}
        qp = body.get("queryParams") or {}
        text = (qi.get("text") or {}).get("text")
        ev = qi.get("event") or {}
        contexts = [{"name": c.get("name", ""), "lifespan": c.get("lifespanCount", 5),
                     "parameters": c.get("parameters") or {}} for c in qp.get("contexts") or []]
        try:
            r = dialog.detect(agent_id, session_id, text=text, event=ev.get("name"),
                              parameters=ev.get("parameters"), contexts=contexts,
                              payload=qp.get("payload"), source="dialogflow-api")
        except ValueError as e:
            raise HTTPException(400, str(e)) from None
        msgs = []
        for m in r["messages"]:
            if m["type"] == "text":
                msgs.append({"text": {"text": [m["text"]]}})
            elif m["type"] == "quickReplies":
                msgs.append({"quickReplies": {"quickReplies": m["items"]}})
            elif m["type"] == "payload":
                msgs.append({"payload": m["payload"]})
        base = f"projects/{agent_id}/agent/sessions/{session_id}"
        intent = r["intent"] or {}
        out = {
            "responseId": r["responseId"],
            "queryResult": {
                "queryText": r["queryText"] or r.get("event") or "",
                "action": r["action"],
                "parameters": r["parameters"],
                "allRequiredParamsPresent": r["allRequiredParamsPresent"],
                "fulfillmentText": r["fulfillmentText"],
                "fulfillmentMessages": msgs,
                "outputContexts": [{"name": f"{base}/contexts/{c['name']}",
                                    "lifespanCount": c["lifespan"], "parameters": c["parameters"]}
                                   for c in r["outputContexts"]],
                "intent": {"name": f"projects/{agent_id}/agent/intents/{intent.get('id', '')}",
                           "displayName": intent.get("name", ""),
                           "isFallback": intent.get("isFallback", False)},
                "intentDetectionConfidence": r["confidence"],
                "languageCode": get_agent(agent_id)["language"],
            },
        }
        if r.get("webhook"):
            wh = r["webhook"]
            out["webhookStatus"] = {"code": 0 if wh["ok"] else 2, "message": wh.get("error") or "OK"}
        return out

    # ------------------------------------------------------- web estática
    @app.get("/chat", include_in_schema=False)
    def chat_page():
        return FileResponse(WEB_DIR / "chat.html")

    @app.get("/widget.js", include_in_schema=False)
    def widget_js():
        return FileResponse(WEB_DIR / "widget.js", media_type="application/javascript")

    @app.exception_handler(NotFound)
    async def not_found(_request, _exc):
        return JSONResponse({"detail": "No encontrado"}, status_code=404)

    if DOCS_DIR.exists():  # guía de uso (Markdown) e imágenes
        app.mount("/guia", StaticFiles(directory=DOCS_DIR), name="guia")
    if WEB_DIR.exists():
        app.mount("/", StaticFiles(directory=WEB_DIR, html=True), name="web")
    return app


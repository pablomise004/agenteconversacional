"""Servidor web: API REST + consola + widget de chat.

La referencia de la API (página propia, con el estilo de la consola) está en /docs;
el esquema OpenAPI, en /openapi.json.
"""

from __future__ import annotations

import json
import mimetypes
import os
import secrets
import time
from pathlib import Path
from typing import Any

from fastapi import Body, Depends, FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.security import APIKeyHeader, HTTPBearer
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

APP_NAME = "Lince"
mimetypes.add_type("application/manifest+json", ".webmanifest")
mimetypes.add_type("image/svg+xml", ".svg")
mimetypes.add_type("font/woff2", ".woff2")


def code_stamp() -> float:
    """Última modificación del código Python del servidor. Si cambia con el servidor en
    marcha (p. ej. tras un git pull), /api/info lo indica y la consola pide reiniciarlo."""
    return max((p.stat().st_mtime for p in Path(__file__).resolve().parent.rglob("*.py")), default=0.0)


# Grupos de la referencia de la API, en el orden en que se muestran
TAGS = [
    {"name": "conversación", "description": "Hablar con un agente: lo que usan el widget, tu web o tu aplicación. "
                                            "Si el agente tiene clave de API, envíala en la cabecera X-Api-Key."},
    {"name": "agentes", "description": "Crear, leer, importar, exportar, duplicar y borrar agentes."},
    {"name": "intenciones", "description": "Lo que quiere el usuario: frases de entrenamiento, parámetros y respuestas."},
    {"name": "entidades", "description": "Tipos de dato que se reconocen dentro de las frases, con sus valores y sinónimos."},
    {"name": "nlu", "description": "Cómo entiende el motor una frase, sin crear conversación ni guardar nada."},
    {"name": "entrenamiento", "description": "El modelo por dentro, el examen y la revisión de los mensajes reales."},
    {"name": "historial", "description": "Conversaciones guardadas y estadísticas de uso."},
    {"name": "compatibilidad Dialogflow", "description": "La misma petición y la misma respuesta que `detectIntent` de la API v2 "
                                                         "de Dialogflow ES: tu aplicación puede apuntar aquí sin cambios."},
    {"name": "general", "description": "Información del servidor."},
]

DESCRIPTION = (
    "API REST de Lince, la alternativa libre y local a Dialogflow para crear chatbots en español.\n\n"
    "- **Conversación** (`/detect`, `:detectIntent`): no necesita el token de administración; si el agente "
    "tiene clave de API hay que enviarla en la cabecera `X-Api-Key`.\n"
    "- **Administración** (todo lo demás): si el servidor se arrancó con `AGENTE_ADMIN_TOKEN`, cada petición "
    "debe llevar `Authorization: Bearer <token>`.\n"
    "- Los errores devuelven `{\"detail\": \"mensaje\"}` con el código HTTP correspondiente."
)

AGENT_EXAMPLE = {"name": "Pizzería Luigi", "description": "Pedidos y reservas", "settings": {"threshold": 0.35}}
INTENT_EXAMPLE = {
    "name": "info.envios",
    "trainingPhrases": ["cuánto tarda el envío", "cuándo llega mi paquete", "hacéis envíos a Canarias"],
    "responses": [{"type": "text", "variants": ["Enviamos en 24-48 horas."]}],
}
ENTITY_EXAMPLE = {"name": "tamano", "kind": "map", "fuzzy": True,
                  "entries": [{"value": "familiar", "synonyms": ["familiar", "grande", "XL"]},
                              {"value": "mediana", "synonyms": ["mediana", "normal"]}]}
DETECT_RESPONSE = {
    "sessionId": "usuario-123", "queryText": "quiero una pizza barbacoa familiar",
    "intent": {"id": "i019", "name": "pedido.pizza", "isFallback": False}, "confidence": 0.97,
    "action": "pedido.crear", "parameters": {"cantidad": 1, "pizza": "barbacoa", "tamano": "familiar"},
    "allRequiredParamsPresent": True, "fulfillmentText": "¡Marchando! 1 × barbacoa (familiar). ¿A domicilio o para recoger?",
    "messages": [{"type": "text", "text": "¡Marchando! 1 × barbacoa (familiar). ¿A domicilio o para recoger?"},
                 {"type": "quickReplies", "items": ["A domicilio", "Para recoger"]}],
    "outputContexts": [{"name": "pedido", "lifespan": 5, "parameters": {"pizza": "barbacoa"}}],
    "match": "ml", "endConversation": False,
}


# ---------------------------------------------------------------- modelos
class CreateAgent(BaseModel):
    name: str = Field(..., min_length=1, max_length=100, description="Nombre visible del agente")
    language: str = Field("es", description="Idioma: es o en")
    description: str = ""
    timezone: str = Field("Europe/Madrid", description="Zona horaria para «mañana», «el lunes»…")
    template: str = Field("blank", description="blank (vacío) o pizzeria (copia del ejemplo)")

    model_config = {"json_schema_extra": {"examples": [
        {"name": "Atención al cliente", "language": "es", "description": "Dudas sobre pedidos y envíos", "template": "blank"}]}}


class DetectRequest(BaseModel):
    sessionId: str | None = Field(None, description="Identificador de la conversación (uno por usuario o pestaña)")
    text: str | None = Field(None, description="Lo que ha escrito el usuario")
    event: str | None = Field(None, description="Nombre de un evento (p. ej. WELCOME) en lugar de texto")
    parameters: dict[str, Any] | None = Field(None, description="Parámetros que acompañan al evento")
    contexts: list[dict[str, Any]] | None = Field(None, description="Contextos que se activan antes de entender el mensaje")
    payload: Any = None
    source: str = Field("api", description="Origen, para el historial (api, widget…)")
    debug: bool = Field(False, description="Incluir el análisis completo en la respuesta")

    model_config = {"json_schema_extra": {"examples": [
        {"sessionId": "usuario-123", "text": "quiero una pizza barbacoa familiar"},
        {"sessionId": "usuario-123", "event": "WELCOME"}]}}


class AnalyzeRequest(BaseModel):
    text: str = Field(..., description="Frase a analizar")
    contexts: list[str] | None = Field(None, description="Contextos que se consideran activos")

    model_config = {"json_schema_extra": {"examples": [{"text": "reserva para 3 el lunes a las 8"}]}}


class AnnotateRequest(BaseModel):
    text: str
    intentId: str | None = Field(None, description="Intención a la que va la frase (reutiliza sus parámetros)")

    model_config = {"json_schema_extra": {"examples": [{"text": "una hawaiana grande"}]}}


class PhraseRequest(BaseModel):
    text: str
    annotations: list[dict[str, Any]] | None = Field(
        None, description="Entidades marcadas [{start, end, entity, param}]; si se omite se anotan solas")

    model_config = {"json_schema_extra": {"examples": [{"text": "me pones una margarita familiar"}]}}


class SynonymRequest(BaseModel):
    value: str = Field(..., description="Valor de referencia (se crea si no existe)")
    synonym: str = Field(..., description="Sinónimo que se añade")

    model_config = {"json_schema_extra": {"examples": [{"value": "barbacoa", "synonym": "barbiquiu"}]}}


class ExplainRequest(BaseModel):
    text: str
    contexts: list[str] | None = None

    model_config = {"json_schema_extra": {"examples": [{"text": "quiero reservar mesa para dos"}]}}


class EvaluateRequest(BaseModel):
    folds: int = Field(5, ge=2, le=10, description="Rondas de la validación cruzada")

    model_config = {"json_schema_extra": {"examples": [{"folds": 5}]}}


class ReviewRequest(BaseModel):
    action: str = Field(..., description="approve (aprobar), assign (asignar a otra intención), ignore o reopen")
    intentId: str | None = Field(None, description="Intención correcta (con assign)")
    text: str | None = Field(None, description="Texto corregido (opcional)")
    annotations: list[dict[str, Any]] | None = None

    model_config = {"json_schema_extra": {"examples": [{"action": "approve"}, {"action": "assign", "intentId": "i019"}]}}


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
    started_stamp = code_stamp()

    app = FastAPI(
        title=APP_NAME,
        version=__version__,
        description=DESCRIPTION,
        openapi_tags=TAGS,
        docs_url=None,  # la referencia de la API es una página propia (/docs), sin depender de un CDN
        redoc_url=None,
    )
    app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"],
                       allow_headers=["*"])
    app.state.storage = storage
    app.state.dialog = dialog
    app.state.engines = engines

    # Solo declaran la seguridad en el esquema OpenAPI; la comprobación real está en admin() y check_key()
    bearer = HTTPBearer(auto_error=False, scheme_name="tokenAdmin",
                        description="Token de administración (variable AGENTE_ADMIN_TOKEN). Solo hace falta "
                                    "si el servidor se arrancó con ella.")
    api_key = APIKeyHeader(name="X-Api-Key", auto_error=False, scheme_name="claveApi",
                           description="Clave de API del agente (Ajustes → Seguridad). Solo si el agente la tiene.")

    # ------------------------------------------------------------ helpers
    def is_admin(request: Request) -> bool:
        if not admin_token:
            return True
        auth = request.headers.get("authorization", "")
        token = auth[7:] if auth.lower().startswith("bearer ") else request.query_params.get("token", "")
        return secrets.compare_digest(token, admin_token)

    def admin(request: Request, _credentials=Depends(bearer)) -> None:
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

    ADMIN = [Depends(admin)]
    KEY = [Depends(api_key)]

    # ---------------------------------------------------------------- info
    @app.get("/api/info", tags=["general"], summary="Información del servidor")
    def info():
        """Versión, idiomas, entidades del sistema y si hace falta token de administración.

        `restartNeeded` es `true` si el código del servidor ha cambiado desde que se arrancó
        (hay que reiniciarlo para usar la versión nueva)."""
        return {
            "version": __version__,
            "languages": SUPPORTED_LANGUAGES,
            "systemEntities": [{"name": k, "description": v} for k, v in SYSTEM_ENTITIES.items()],
            "adminTokenRequired": bool(admin_token),
            "restartNeeded": code_stamp() > started_stamp,
        }

    @app.get("/api/auth-check", tags=["general"], dependencies=ADMIN, summary="Comprobar el token de administración")
    def auth_check():
        """Devuelve `{"ok": true}` si el token es correcto (o si el servidor no pide token)."""
        return {"ok": True}

    # -------------------------------------------------------------- agentes
    @app.get("/api/agents", tags=["agentes"], dependencies=ADMIN, summary="Listar agentes")
    def list_agents():
        """Resumen de cada agente: nombre, idioma y cuántas intenciones, entidades y frases tiene."""
        return storage.list_agents()

    @app.post("/api/agents", tags=["agentes"], dependencies=ADMIN, status_code=201, summary="Crear un agente")
    def create_agent(req: CreateAgent):
        """Crea un agente vacío (bienvenida y fallback) o una copia del ejemplo de la pizzería."""
        if req.template == "pizzeria" and (EXAMPLES_DIR / "pizzeria.json").exists():
            agent = json.loads((EXAMPLES_DIR / "pizzeria.json").read_text(encoding="utf-8"))
            agent["name"] = req.name
        else:
            agent = blank_agent(req.name, req.language if req.language in SUPPORTED_LANGUAGES else "es",
                                req.description, req.timezone)
        agent["id"] = storage.unique_id(req.name)
        agent["version"] = 0
        return storage.save_agent(agent)

    @app.post("/api/agents/import", tags=["agentes"], dependencies=ADMIN, status_code=201, summary="Importar un agente",
              openapi_extra={"requestBody": {"required": True, "description": "El fichero tal cual",
                                             "content": {"application/octet-stream": {"schema": {"type": "string", "format": "binary"}}}}})
    async def import_agent(request: Request, name: str = Query("", description="Nombre nuevo (opcional)"),
                           filename: str = Query("", description="Nombre del fichero, para saber si es .json o .zip")):
        """Envía el fichero en el cuerpo de la petición: el JSON exportado desde aquí o el ZIP que exporta
        Dialogflow ES (Configuración del agente → Exportar e importar)."""
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

    @app.get("/api/agents/{agent_id}", tags=["agentes"], dependencies=ADMIN, summary="Leer un agente")
    def read_agent(agent_id: str):
        """El agente completo: ajustes, intenciones (con frases, parámetros y respuestas) y entidades."""
        return get_agent(agent_id)

    @app.patch("/api/agents/{agent_id}", tags=["agentes"], dependencies=ADMIN, summary="Cambiar nombre, idioma o ajustes")
    def update_agent(agent_id: str, changes: dict = Body(..., examples=[AGENT_EXAMPLE])):
        """Cambia `name`, `description`, `language`, `timezone` y las claves de `settings` que se envíen
        (umbral, corrección ortográfica, reglas de normalización, webhook, clave de API…)."""
        agent = get_agent(agent_id)
        for k in ("name", "description", "language", "timezone"):
            if k in changes:
                agent[k] = changes[k]
        if isinstance(changes.get("settings"), dict):
            settings = dict(agent["settings"])
            settings.update(changes["settings"])
            agent["settings"] = settings
        return storage.save_agent(agent)

    @app.delete("/api/agents/{agent_id}", tags=["agentes"], dependencies=ADMIN, summary="Borrar un agente")
    def delete_agent(agent_id: str):
        """Borra el agente con sus intenciones, entidades y conversaciones. No se puede deshacer."""
        try:
            storage.delete_agent(agent_id)
        except NotFound:
            raise HTTPException(404, "No existe ese agente") from None
        engines.drop(agent_id)
        return {"ok": True}

    @app.get("/api/agents/{agent_id}/export", tags=["agentes"], dependencies=ADMIN, summary="Exportar a JSON")
    def export_agent(agent_id: str):
        """Descarga el agente como fichero JSON (se puede volver a importar)."""
        agent = get_agent(agent_id)
        for k in ("version", "updatedAt"):
            agent.pop(k, None)
        body = json.dumps(agent, ensure_ascii=False, indent=2)
        return Response(body, media_type="application/json", headers={
            "Content-Disposition": f'attachment; filename="{agent_id}.json"'})

    @app.post("/api/agents/{agent_id}/duplicate", tags=["agentes"], dependencies=ADMIN, status_code=201,
              summary="Duplicar un agente")
    def duplicate_agent(agent_id: str):
        """Crea una copia con el nombre «(copia)»."""
        agent = get_agent(agent_id)
        agent["name"] = agent["name"] + " (copia)"
        agent["id"] = storage.unique_id(agent["name"])
        agent["version"] = 0
        return storage.save_agent(agent)

    @app.post("/api/agents/{agent_id}/train", tags=["entrenamiento"], dependencies=ADMIN, summary="Reentrenar el modelo")
    def train(agent_id: str):
        """Entrena de nuevo (normalmente no hace falta: se reentrena solo al cambiar el agente) y devuelve el informe."""
        get_agent(agent_id)
        engines.drop(agent_id)
        engine = engines.get(agent_id)
        return dict(engine_status(agent_id), report=engine.report)

    @app.get("/api/agents/{agent_id}/model", tags=["entrenamiento"], dependencies=ADMIN, summary="Lo que ha aprendido el modelo")
    def model_info(agent_id: str, k: int = Query(8, ge=1, le=30, description="Rasgos por intención"),
                   chars: bool = Query(False, description="Incluir los trozos de letras")):
        """Informe del entrenamiento, rasgos con más peso por intención, mapa de frases y último examen."""
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

    @app.post("/api/agents/{agent_id}/explain", tags=["entrenamiento"], dependencies=ADMIN, summary="Explicar una frase paso a paso")
    def explain(agent_id: str, req: ExplainRequest):
        """Recorrido completo de una frase por dentro del modelo: tokens, entidades, rasgos, probabilidades
        y la aportación de cada rasgo a la decisión."""
        agent = get_agent(agent_id)
        engine = engines.get(agent_id)
        return insights.explain(engine, req.text[:1000], req.contexts or [], agent["settings"]["threshold"])

    @app.post("/api/agents/{agent_id}/evaluate", tags=["entrenamiento"], dependencies=ADMIN, summary="Examen (validación cruzada)")
    def evaluate(agent_id: str, req: EvaluateRequest | None = None):
        """Acierto con frases que el modelo no ha visto, por intención, con la matriz de confusión y los fallos."""
        agent = get_agent(agent_id)
        result = insights.evaluate(agent, folds=(req.folds if req else 5))
        evaluations[agent_id] = {"version": agent["version"], "result": result}
        return result

    @app.get("/api/agents/{agent_id}/status", tags=["entrenamiento"], dependencies=ADMIN, summary="Estado del modelo")
    def status(agent_id: str):
        """Si el modelo está al día con la última versión del agente, cuándo se entrenó y cuánto tardó."""
        get_agent(agent_id)
        return engine_status(agent_id)

    @app.get("/api/agents/{agent_id}/validate", tags=["entrenamiento"], dependencies=ADMIN, summary="Avisos de calidad")
    def validate_agent(agent_id: str):
        """Errores y consejos: frases repetidas, intenciones con pocas frases, contextos que nadie activa…"""
        return validate(get_agent(agent_id))

    # ---------------------------------------------------------- intenciones
    @app.post("/api/agents/{agent_id}/intents", tags=["intenciones"], dependencies=ADMIN, status_code=201,
              summary="Crear una intención")
    def create_intent(agent_id: str, intent: dict = Body(..., examples=[INTENT_EXAMPLE])):
        """Las frases pueden ir como texto o como `{"text", "annotations"}`; lo que falte se completa solo."""
        agent = get_agent(agent_id)
        intent = dict(intent)
        intent["id"] = new_id("i")
        data = normalize_intent(intent)
        agent["intents"].append(data)
        saved = storage.save_agent(agent)
        return find(saved["intents"], data["id"], "esa intención")

    @app.put("/api/agents/{agent_id}/intents/{intent_id}", tags=["intenciones"], dependencies=ADMIN,
             summary="Guardar una intención")
    def update_intent(agent_id: str, intent_id: str, intent: dict = Body(..., examples=[INTENT_EXAMPLE])):
        """Sustituye la intención entera por la que se envía."""
        agent = get_agent(agent_id)
        old = find(agent["intents"], intent_id, "esa intención")
        intent = dict(intent)
        intent["id"] = intent_id
        agent["intents"][agent["intents"].index(old)] = normalize_intent(intent)
        saved = storage.save_agent(agent)
        return find(saved["intents"], intent_id, "esa intención")

    @app.delete("/api/agents/{agent_id}/intents/{intent_id}", tags=["intenciones"], dependencies=ADMIN,
                summary="Borrar una intención")
    def delete_intent(agent_id: str, intent_id: str):
        agent = get_agent(agent_id)
        find(agent["intents"], intent_id, "esa intención")
        agent["intents"] = [i for i in agent["intents"] if i["id"] != intent_id]
        storage.save_agent(agent)
        return {"ok": True}

    @app.post("/api/agents/{agent_id}/intents/{intent_id}/phrases", tags=["intenciones"], dependencies=ADMIN,
              status_code=201, summary="Añadir una frase de entrenamiento")
    def create_phrase(agent_id: str, intent_id: str, req: PhraseRequest):
        """Si la frase estaba en otra intención, se mueve a esta. Sin `annotations`, las entidades se marcan solas."""
        agent = get_agent(agent_id)
        if not req.text.strip():
            raise HTTPException(400, "La frase está vacía")
        phrase = add_phrase(agent, intent_id, req.text.strip(), req.annotations)
        storage.save_agent(agent)
        return phrase

    # ------------------------------------------------------------ entidades
    @app.post("/api/agents/{agent_id}/entities", tags=["entidades"], dependencies=ADMIN, status_code=201,
              summary="Crear una entidad")
    def create_entity(agent_id: str, entity: dict = Body(..., examples=[ENTITY_EXAMPLE])):
        """`kind`: map (valores con sinónimos), list (solo valores) o regex (expresiones regulares)."""
        agent = get_agent(agent_id)
        data = normalize_entity(dict(entity, id=new_id("e")))
        if any(e["name"] == data["name"] for e in agent["entities"]):
            raise HTTPException(409, f"Ya existe una entidad llamada @{data['name']}")
        agent["entities"].append(data)
        storage.save_agent(agent)
        return data

    @app.put("/api/agents/{agent_id}/entities/{entity_id}", tags=["entidades"], dependencies=ADMIN,
             summary="Guardar una entidad")
    def update_entity(agent_id: str, entity_id: str, entity: dict = Body(..., examples=[ENTITY_EXAMPLE])):
        """Sustituye la entidad. Si cambia el nombre, se actualizan también las intenciones que la usan."""
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

    @app.delete("/api/agents/{agent_id}/entities/{entity_id}", tags=["entidades"], dependencies=ADMIN,
                summary="Borrar una entidad")
    def delete_entity(agent_id: str, entity_id: str):
        agent = get_agent(agent_id)
        find(agent["entities"], entity_id, "esa entidad")
        agent["entities"] = [e for e in agent["entities"] if e["id"] != entity_id]
        storage.save_agent(agent)
        return {"ok": True}

    @app.post("/api/agents/{agent_id}/entities/{entity_id}/synonyms", tags=["entidades"], dependencies=ADMIN,
              summary="Añadir un sinónimo")
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
    @app.post("/api/agents/{agent_id}/annotate", tags=["nlu"], dependencies=ADMIN, summary="Anotar entidades automáticamente")
    def annotate(agent_id: str, req: AnnotateRequest):
        """Propone qué partes de la frase son entidades y con qué parámetro (como al escribir una frase en la consola)."""
        agent = get_agent(agent_id)
        intent = next((i for i in agent["intents"] if i["id"] == req.intentId), None)
        return engines.get(agent_id).auto_annotate(req.text, intent)

    @app.post("/api/agents/{agent_id}/analyze", tags=["nlu"], dependencies=ADMIN, summary="Analizar una frase")
    def analyze(agent_id: str, req: AnalyzeRequest):
        """Tokens, entidades, intenciones candidatas con su confianza, parámetros y frases parecidas.
        No crea conversación ni guarda nada."""
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

    @app.post("/api/agents/{agent_id}/detect", tags=["conversación"], dependencies=KEY, summary="Conversar (enviar un mensaje)",
              responses={200: {"description": "Lo que ha entendido y lo que responde",
                               "content": {"application/json": {"example": DETECT_RESPONSE}}}})
    def detect(agent_id: str, req: DetectRequest, request: Request):
        """Un turno de la conversación. Envía `text` (o `event`) con el mismo `sessionId` en todos los
        mensajes de una conversación: así se recuerdan los contextos y las preguntas pendientes."""
        check_key(agent_id, request)
        try:
            return dialog.detect(agent_id, req.sessionId or "", text=req.text, event=req.event,
                                 parameters=req.parameters, contexts=req.contexts,
                                 payload=req.payload, source=(req.source or "api")[:20],
                                 debug=req.debug)
        except ValueError as e:
            raise HTTPException(400, str(e)) from None

    @app.post("/api/agents/{agent_id}/sessions/{session_id}/reset", tags=["conversación"], dependencies=KEY,
              summary="Empezar la conversación de cero")
    def reset_session(agent_id: str, session_id: str, request: Request):
        """Olvida los contextos y las preguntas pendientes de esa sesión."""
        check_key(agent_id, request)
        dialog.reset(agent_id, session_id)
        return {"ok": True}

    @app.get("/api/agents/{agent_id}/public", tags=["conversación"], summary="Datos públicos del agente")
    def public_info(agent_id: str):
        """Datos mínimos para el widget de chat: nombre, idioma y si hace falta clave."""
        agent = get_agent(agent_id)
        return {"id": agent["id"], "name": agent["name"], "language": agent["language"],
                "needsKey": bool(agent["settings"].get("apiKey"))}

    # ------------------------------------------- entrenamiento e historial
    @app.get("/api/agents/{agent_id}/logs", tags=["entrenamiento"], dependencies=ADMIN, summary="Mensajes para revisar")
    def list_logs(agent_id: str,
                  review: str | None = Query("pending", description="pending, approved, corrected, ignored o vacío para todos"),
                  fallback: bool = Query(False, description="Solo los no entendidos"),
                  lowConfidence: float | None = Query(None, description="Solo los que tienen menos confianza que esta"),
                  q: str = Query("", description="Buscar texto"), limit: int = Query(100, le=500), offset: int = 0):
        """Los mensajes reales de los usuarios, para aprobarlos o corregirlos (pantalla Revisión)."""
        get_agent(agent_id)
        items, total = storage.list_logs(agent_id, review=review or None, only_fallback=fallback,
                                         max_confidence=lowConfidence, search=q, limit=limit,
                                         offset=offset)
        return {"items": items, "total": total}

    @app.post("/api/agents/{agent_id}/logs/{log_id}/review", tags=["entrenamiento"], dependencies=ADMIN,
              summary="Revisar un mensaje")
    def review_log(agent_id: str, log_id: int, req: ReviewRequest):
        """Aprobar o asignar un mensaje lo convierte en frase de entrenamiento; también se puede ignorar."""
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

    @app.post("/api/agents/{agent_id}/logs/clear", tags=["entrenamiento"], dependencies=ADMIN,
              summary="Vaciar el registro de mensajes")
    def clear_logs(agent_id: str):
        """Borra todos los mensajes y conversaciones guardados del agente."""
        get_agent(agent_id)
        storage.clear_logs(agent_id)
        return {"ok": True}

    @app.get("/api/agents/{agent_id}/conversations", tags=["historial"], dependencies=ADMIN, summary="Listar conversaciones")
    def conversations(agent_id: str, limit: int = Query(50, le=500), offset: int = 0):
        get_agent(agent_id)
        items, total = storage.conversations(agent_id, limit, offset)
        return {"items": items, "total": total}

    @app.get("/api/agents/{agent_id}/conversations/{session_id}", tags=["historial"], dependencies=ADMIN,
             summary="Leer una conversación")
    def conversation(agent_id: str, session_id: str):
        """Todos los turnos de una conversación, con lo que se entendió en cada uno."""
        get_agent(agent_id)
        return storage.conversation(agent_id, session_id)

    @app.get("/api/agents/{agent_id}/stats", tags=["historial"], dependencies=ADMIN, summary="Estadísticas de uso")
    def stats(agent_id: str, days: int = Query(30, ge=1, le=365, description="Días hacia atrás"),
              tz: int = Query(0, ge=-900, le=900, description="Minutos de diferencia con UTC (getTimezoneOffset del navegador)")):
        """Mensajes, conversaciones, no entendidos, intenciones más usadas y actividad por día."""
        get_agent(agent_id)
        return storage.stats(agent_id, days, tz)

    @app.get("/api/system-entities", tags=["general"], summary="Entidades del sistema")
    def system_entities():
        """Las entidades @sys.* que reconoce cualquier agente sin configurar nada."""
        return [{"name": k, "description": v} for k, v in SYSTEM_ENTITIES.items()]

    # ---------------------------------------- compatibilidad con Dialogflow
    @app.post("/v2/projects/{agent_id}/agent/sessions/{session_id}:detectIntent",
              tags=["compatibilidad Dialogflow"], dependencies=KEY, summary="detectIntent (Dialogflow ES v2)")
    def df_detect(agent_id: str, session_id: str, request: Request,
                  body: dict = Body(..., examples=[{"queryInput": {"text": {"text": "hola", "languageCode": "es"}}}])):
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
    @app.get("/docs", include_in_schema=False)
    @app.get("/docs/", include_in_schema=False)
    def api_docs():
        """Referencia de la API con el estilo de la consola (lee /openapi.json)."""
        return FileResponse(WEB_DIR / "api.html")

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

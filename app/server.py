"""Servidor web: API REST + consola + widget de chat.

La referencia de la API (página propia, con el estilo de la consola) está en /docs;
el esquema OpenAPI, en /openapi.json.
"""

from __future__ import annotations

import copy
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
from .agents import blank_agent, new_id, normalize_entity, normalize_intent, normalize_phrase, slugify, summary
from .dialog import analysis_dict
from .importer import ImportError_, import_bytes
from .nlu import insights
from .nlu.languages import SUPPORTED_LANGUAGES
from .nlu.sys_entities import SYSTEM_ENTITIES
from .nlu.text import normalize_text
from .spaces import AccountError, Accounts, ModelPool, Shares, Space, SpaceLimit, Spaces
from .storage import NotFound, Storage
from .validation import validate

ROOT = Path(__file__).resolve().parent.parent
WEB_DIR = ROOT / "web"
DOCS_DIR = ROOT / "docs"
EXAMPLES_DIR = ROOT / "examples"
# agentes de ejemplo (examples/<id>.json): la pizzería para aprender y el hotel para ver hasta dónde llega
EXAMPLES = ("pizzeria", "hotel")

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
# solo en los servidores con cuentas (AGENTE_ACCOUNTS)
ACCOUNT_TAGS = [
    {"name": "cuentas", "description": "Cada persona entra con su usuario y su contraseña y ve solo sus agentes. Al entrar "
                                       "se recibe la llave de su espacio, que va en la cabecera X-Space-Key."},
    {"name": "compartir", "description": "Un agente se comparte con un enlace: quien lo abre puede guardar una copia en su "
                                         "cuenta o descargarla para una instalación local."},
]
MAX_AGENTS_PER_ACCOUNT = 50

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
    language: str = Field("es", description="Idioma: es o en (en una copia, el del agente copiado)")
    description: str = Field("", description="Descripción (en una copia, si va vacía se queda la del agente copiado)")
    timezone: str = Field("Europe/Madrid", description="Zona horaria para «mañana», «el lunes»…")
    copyOf: str | None = Field(None, description="Id de uno de tus agentes (o de uno de ejemplo) del que hacer una "
                                                 "copia con este nombre. Si se da, no se mira `template`")
    template: str = Field("blank", description="blank (vacío), pizzeria u hotel: copia del ejemplo tal como viene, "
                                               "aunque ya no lo tengas en la lista (ver `examples` en /api/info)")

    model_config = {"json_schema_extra": {"examples": [
        {"name": "Atención al cliente", "language": "es", "description": "Dudas sobre pedidos y envíos", "template": "blank"},
        {"name": "Mi pizzería", "copyOf": "pizzeria"}]}}


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


class Credentials(BaseModel):
    user: str = Field(..., description="Usuario: de 3 a 30 caracteres (letras sin tildes ni eñes, números, puntos o guiones)")
    password: str = Field(..., description="Contraseña: al menos 6 caracteres")

    model_config = {"json_schema_extra": {"examples": [{"user": "fulano", "password": "una-contraseña-larga"}]}}


class PasswordChange(BaseModel):
    current: str = Field(..., description="Contraseña actual")
    new: str = Field(..., description="Contraseña nueva (al menos 6 caracteres)")

    model_config = {"json_schema_extra": {"examples": [{"current": "la-de-ahora", "new": "otra-contraseña-larga"}]}}


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


def example_templates() -> list[dict]:
    """Los agentes de ejemplo tal como vienen (resumen): se puede crear una copia aunque se haya
    borrado la de la lista."""
    out = []
    for name in EXAMPLES:
        path = EXAMPLES_DIR / f"{name}.json"
        if path.exists():
            agent = json.loads(path.read_text(encoding="utf-8"))
            out.append({k: v for k, v in summary(dict(agent, id=name)).items() if k in ("id", "name", "language", "intents")})
    return out


def seed_examples(storage: Storage, data_dir: Path) -> None:
    """Copia cada agente de ejemplo la primera vez que arranca el servidor con él.

    Las copias llevan `"example": true`: la consola las enseña aparte, debajo de los agentes
    del usuario. En data/seeded_examples.json se apunta cuáles se han copiado ya, así que un
    ejemplo borrado no vuelve al reiniciar. Las instalaciones de antes de esta marca ya tenían la
    pizzería (se copiaba siempre que no había agentes) y reciben solo los nuevos.
    """
    marker = data_dir / "seeded_examples.json"
    try:
        seeded = set(json.loads(marker.read_text(encoding="utf-8")))
    except (OSError, ValueError):
        seeded = {"pizzeria"} if storage.list_agents() else set()
    changed = False
    for name in EXAMPLES:
        path = EXAMPLES_DIR / f"{name}.json"
        if not path.exists():
            continue
        agent = json.loads(path.read_text(encoding="utf-8"))
        if name in seeded:
            # copias de antes de la marca `example`: el nombre del ejemplo y su id (o el que sale de su
            # nombre, si el suyo estaba ocupado). Un agente propio con ese id tiene otro nombre, porque
            # el id sale del nombre al crearlo.
            for agent_id in (agent["id"], slugify(agent["name"])):
                old = storage.agent_ref(agent_id) if storage.has_agent(agent_id) else None
                if old and not old.get("example") and old["name"] == agent["name"]:
                    storage.save_agent(dict(storage.get_agent(agent_id), example=True))
            continue
        if storage.has_agent(agent["id"]):  # el usuario ya tiene uno con ese id: no se pisa
            agent["id"] = storage.unique_id(agent["name"])
        agent["example"] = True
        storage.save_agent(agent)
        seeded.add(name)
        changed = True
    if changed or not marker.exists():
        try:
            marker.write_text(json.dumps(sorted(seeded)) + "\n", encoding="utf-8")
        except OSError:
            pass


def create_app(data_dir: Path | None = None, accounts: bool | None = None) -> FastAPI:
    """La aplicación. Con `accounts` (o la variable AGENTE_ACCOUNTS=1) cada persona entra con su usuario
    y tiene su espacio privado (spaces.py); si no, hay un único espacio: la carpeta de datos de siempre."""
    data_dir = Path(data_dir or os.environ.get("AGENTE_DATA_DIR") or ROOT / "data")
    if accounts is None:
        accounts = os.environ.get("AGENTE_ACCOUNTS", "").strip().lower() in ("1", "true", "yes", "si", "sí")
    pool = ModelPool()
    single: Space | None = None
    if accounts:
        spaces = Spaces(data_dir, pool, seed_examples)
        # los ejemplos, para hablar con ellos sin cuenta (/chat?agent=hotel); nadie puede cambiarlos
        demo = Space(data_dir / "demo", pool)
        seed_examples(demo.storage, data_dir / "demo")
        users = Accounts(data_dir, spaces)
        shares = Shares(data_dir)
    else:
        single = Space(data_dir, pool)
        seed_examples(single.storage, data_dir)
    admin_token = os.environ.get("AGENTE_ADMIN_TOKEN", "").strip()
    started_stamp = code_stamp()
    templates = example_templates()

    app = FastAPI(
        title=APP_NAME,
        version=__version__,
        description=DESCRIPTION,
        openapi_tags=TAGS + (ACCOUNT_TAGS if accounts else []),
        docs_url=None,  # la referencia de la API es una página propia (/docs), sin depender de un CDN
        redoc_url=None,
    )
    app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"],
                       allow_headers=["*"])
    app.state.accounts = accounts
    app.state.spaces = spaces if accounts else None  # para las pruebas

    # Solo declaran la seguridad en el esquema OpenAPI; la comprobación real está en admin(), space() y check_key()
    bearer = HTTPBearer(auto_error=False, scheme_name="tokenAdmin",
                        description="Token de administración (variable AGENTE_ADMIN_TOKEN). Solo hace falta "
                                    "si el servidor se arrancó con ella.")
    api_key = APIKeyHeader(name="X-Api-Key", auto_error=False, scheme_name="claveApi",
                           description="Clave de API del agente (Ajustes → Seguridad). Solo si el agente la tiene.")
    space_key = APIKeyHeader(name="X-Space-Key", auto_error=False, scheme_name="cuenta",
                             description="Llave de tu espacio: la devuelven «Entrar» y «Crear una cuenta» y la consola "
                                         "la guarda en el navegador. Solo en servidores con cuentas.")

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

    if accounts:
        def space(request: Request, _key=Depends(space_key)) -> Space:
            """El espacio de quien llama: el de su llave (X-Space-Key)."""
            sp = spaces.by_key(request.headers.get("x-space-key", ""))
            if sp is None:
                raise HTTPException(401, "Entra con tu usuario: falta la llave de tu espacio o ya no vale")
            return sp
    else:
        def space() -> Space:
            return single

    def locate(agent_ref: str, request: Request) -> tuple[Space, str]:
        """Espacio e id de un agente en las rutas de conversación. Con cuentas, desde fuera (widget, chat,
        API) se usa la dirección pública «<espacio>.<agente>»; la consola usa el id a secas con su llave."""
        if not accounts:
            return single, agent_ref
        sid, dot, agent_id = agent_ref.partition(".")
        if dot:
            sp = spaces.get(sid)
        else:  # la consola (con su llave) o, sin llave, los ejemplos de demostración
            key = request.headers.get("x-space-key", "")
            sp = spaces.by_key(key) if key else demo
        if sp is None:
            raise HTTPException(404, "No existe ese agente")
        return sp, agent_id if dot else agent_ref

    def get_agent(sp: Space, agent_id: str) -> dict:
        try:
            return sp.storage.get_agent(agent_id)
        except NotFound:
            raise HTTPException(404, "No existe ese agente") from None

    def public(sp: Space, data: dict) -> dict:
        """Un agente (o su resumen) con su dirección pública, la del widget y el chat."""
        return dict(data, publicId=sp.ref(data["id"]))

    def room_for_agent(sp: Space) -> None:
        if accounts and len(sp.storage.list_agents()) >= MAX_AGENTS_PER_ACCOUNT:
            raise HTTPException(409, f"Tu cuenta ya tiene {MAX_AGENTS_PER_ACCOUNT} agentes: borra alguno para crear otro")

    def check_key(sp: Space, agent_id: str, request: Request) -> None:
        agent = get_agent(sp, agent_id)
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

    def add_phrase(sp: Space, agent: dict, intent_id: str, text: str, annotations) -> dict:
        intent = find(agent["intents"], intent_id, "esa intención")
        key = normalize_text(text).strip(" ?¿!¡.")
        # la frase se mueve: si estaba en otra intención (sin contextos distintos), se quita
        for other in agent["intents"]:
            if other["id"] != intent_id and other.get("inputContexts") == intent.get("inputContexts"):
                other["trainingPhrases"] = [p for p in other["trainingPhrases"]
                                            if normalize_text(p["text"]).strip(" ?¿!¡.") != key]
        if annotations is None:
            engine = sp.engines.get(agent["id"])
            annotations = engine.auto_annotate(text, intent)["annotations"]
        phrase = normalize_phrase({"text": text, "annotations": annotations})
        intent["trainingPhrases"] = [p for p in intent["trainingPhrases"]
                                     if normalize_text(p["text"]).strip(" ?¿!¡.") != key]
        intent["trainingPhrases"].insert(0, phrase)
        return phrase

    def engine_status(sp: Space, agent_id: str) -> dict:
        agent = sp.storage.agent_ref(agent_id)
        meta = sp.engines.meta.get(agent_id) or {}
        return {"version": agent.get("version"), "trainedVersion": meta.get("version"),
                "upToDate": meta.get("version") == agent.get("version"), **meta}

    ADMIN = [Depends(admin)]
    KEY = [Depends(api_key)]
    SPACE = Depends(space)

    # ---------------------------------------------------------------- info
    @app.get("/api/info", tags=["general"], summary="Información del servidor")
    def info():
        """Versión, idiomas, entidades del sistema, si hace falta token de administración, si el servidor
        tiene cuentas de usuario (`accounts`: cada uno entra con su usuario y ve solo sus agentes) y los
        agentes de ejemplo tal como vienen (`examples`, para crear una copia con `template`).

        `restartNeeded` es `true` si el código del servidor ha cambiado desde que se arrancó
        (hay que reiniciarlo para usar la versión nueva)."""
        return {
            "version": __version__,
            "languages": SUPPORTED_LANGUAGES,
            "systemEntities": [{"name": k, "description": v} for k, v in SYSTEM_ENTITIES.items()],
            "adminTokenRequired": bool(admin_token),
            "accounts": accounts,
            "restartNeeded": code_stamp() > started_stamp,
            "examples": templates,
        }

    @app.get("/api/auth-check", tags=["general"], dependencies=ADMIN, summary="Comprobar el token de administración")
    def auth_check():
        """Devuelve `{"ok": true}` si el token es correcto (o si el servidor no pide token)."""
        return {"ok": True}

    # --------------------------------------------------------------- cuentas
    if accounts:
        def account_error(e: AccountError) -> HTTPException:
            return HTTPException(e.status, str(e))

        @app.post("/api/accounts", tags=["cuentas"], status_code=201, summary="Crear una cuenta")
        def register(req: Credentials):
            """Crea el usuario y su espacio privado, con los agentes de ejemplo. Devuelve la llave del
            espacio (`spaceKey`): mándala en la cabecera `X-Space-Key` en las demás peticiones."""
            try:
                key, sp = users.register(req.user, req.password)
            except AccountError as e:
                raise account_error(e) from None
            return {"spaceKey": key, "user": req.user.strip(), "spaceId": sp.public_id}

        @app.post("/api/login", tags=["cuentas"], summary="Entrar")
        def login(req: Credentials):
            """Comprueba el usuario y la contraseña y devuelve la llave de su espacio (`spaceKey`). Tras
            varios intentos fallidos seguidos, ese usuario queda bloqueado unos minutos."""
            try:
                key, user = users.login(req.user, req.password)
            except AccountError as e:
                raise account_error(e) from None
            return {"spaceKey": key, "user": user, "spaceId": Spaces.id_of(key)}

        @app.get("/api/account", tags=["cuentas"], dependencies=ADMIN, summary="Mi cuenta")
        def account(sp: Space = SPACE):
            """El usuario dueño de la llave y cuántos agentes tiene (sirve para comprobar que la llave vale)."""
            return {"user": users.user_of(sp), "spaceId": sp.public_id, "agents": len(sp.storage.list_agents())}

        @app.post("/api/account/password", tags=["cuentas"], dependencies=ADMIN, summary="Cambiar la contraseña")
        def change_password(req: PasswordChange, sp: Space = SPACE):
            """Hace falta la contraseña actual. La llave del espacio no cambia."""
            try:
                users.change_password(sp, req.current, req.new)
            except AccountError as e:
                raise account_error(e) from None
            return {"ok": True}

    # -------------------------------------------------------------- agentes
    @app.get("/api/agents", tags=["agentes"], dependencies=ADMIN, summary="Listar agentes")
    def list_agents(sp: Space = SPACE):
        """Resumen de cada agente: nombre, idioma, cuántas intenciones, entidades y frases tiene, si es
        uno de los agentes de ejemplo (`example`), que la consola enseña aparte, y su dirección pública
        (`publicId`), la del widget y el chat."""
        return [public(sp, a) for a in sp.storage.list_agents()]

    @app.post("/api/agents", tags=["agentes"], dependencies=ADMIN, status_code=201, summary="Crear un agente")
    def create_agent(req: CreateAgent, sp: Space = SPACE):
        """Crea un agente vacío (bienvenida y fallback) o una copia: de otro agente tuyo o de uno de
        ejemplo (`copyOf`, con todo lo que tenga) o de un ejemplo tal como viene (`template`: pizzeria
        u hotel). La copia es un agente propio: sale en «Tus agentes»."""
        room_for_agent(sp)
        example = EXAMPLES_DIR / f"{req.template}.json"
        if req.copyOf:
            agent = get_agent(sp, req.copyOf)
            agent["name"] = req.name
            if req.description:
                agent["description"] = req.description
            agent.pop("example", None)
        elif req.template in EXAMPLES and example.exists():
            agent = json.loads(example.read_text(encoding="utf-8"))
            agent["name"] = req.name
            if req.description:
                agent["description"] = req.description
        else:
            agent = blank_agent(req.name, req.language if req.language in SUPPORTED_LANGUAGES else "es",
                                req.description, req.timezone)
        agent["id"] = sp.storage.unique_id(req.name)
        agent["version"] = 0
        return public(sp, sp.storage.save_agent(agent))

    @app.post("/api/agents/import", tags=["agentes"], dependencies=ADMIN, status_code=201, summary="Importar un agente",
              openapi_extra={"requestBody": {"required": True, "description": "El fichero tal cual",
                                             "content": {"application/octet-stream": {"schema": {"type": "string", "format": "binary"}}}}})
    async def import_agent(request: Request, name: str = Query("", description="Nombre nuevo (opcional)"),
                           filename: str = Query("", description="Nombre del fichero, para saber si es .json o .zip"),
                           sp: Space = SPACE):
        """Envía el fichero en el cuerpo de la petición: el JSON exportado desde aquí o el ZIP que exporta
        Dialogflow ES (Configuración del agente → Exportar e importar)."""
        room_for_agent(sp)
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
        agent["id"] = sp.storage.unique_id(agent["name"])
        agent["version"] = 0
        agent.pop("example", None)  # lo importado es del usuario, aunque venga de un ejemplo
        return public(sp, sp.storage.save_agent(agent))

    @app.get("/api/agents/{agent_id}", tags=["agentes"], dependencies=ADMIN, summary="Leer un agente")
    def read_agent(agent_id: str, sp: Space = SPACE):
        """El agente completo: ajustes, intenciones (con frases, parámetros y respuestas) y entidades."""
        return public(sp, get_agent(sp, agent_id))

    @app.patch("/api/agents/{agent_id}", tags=["agentes"], dependencies=ADMIN, summary="Cambiar nombre, idioma o ajustes")
    def update_agent(agent_id: str, changes: dict = Body(..., examples=[AGENT_EXAMPLE]), sp: Space = SPACE):
        """Cambia `name`, `description`, `language`, `timezone` y las claves de `settings` que se envíen
        (umbral, corrección ortográfica, reglas de normalización, webhook, clave de API…)."""
        agent = get_agent(sp, agent_id)
        for k in ("name", "description", "language", "timezone"):
            if k in changes:
                agent[k] = changes[k]
        if isinstance(changes.get("settings"), dict):
            settings = dict(agent["settings"])
            settings.update(changes["settings"])
            agent["settings"] = settings
        return public(sp, sp.storage.save_agent(agent))

    @app.delete("/api/agents/{agent_id}", tags=["agentes"], dependencies=ADMIN, summary="Borrar un agente")
    def delete_agent(agent_id: str, sp: Space = SPACE):
        """Borra el agente con sus intenciones, entidades y conversaciones (y su enlace, si se compartía).
        No se puede deshacer."""
        try:
            sp.storage.delete_agent(agent_id)
        except NotFound:
            raise HTTPException(404, "No existe ese agente") from None
        sp.engines.drop(agent_id)
        if accounts:
            shares.unshare(sp, agent_id)
        return {"ok": True}

    @app.get("/api/agents/{agent_id}/export", tags=["agentes"], dependencies=ADMIN, summary="Exportar a JSON")
    def export_agent(agent_id: str, sp: Space = SPACE):
        """Descarga el agente como fichero JSON (se puede volver a importar)."""
        agent = get_agent(sp, agent_id)
        for k in ("version", "updatedAt", "example"):
            agent.pop(k, None)
        body = json.dumps(agent, ensure_ascii=False, indent=2)
        return Response(body, media_type="application/json", headers={
            "Content-Disposition": f'attachment; filename="{agent_id}.json"'})

    @app.post("/api/agents/{agent_id}/duplicate", tags=["agentes"], dependencies=ADMIN, status_code=201,
              summary="Duplicar un agente")
    def duplicate_agent(agent_id: str, sp: Space = SPACE):
        """Crea una copia con el nombre «(copia)». La copia de un ejemplo ya es un agente propio."""
        room_for_agent(sp)
        agent = get_agent(sp, agent_id)
        agent["name"] = agent["name"] + " (copia)"
        agent["id"] = sp.storage.unique_id(agent["name"])
        agent["version"] = 0
        agent.pop("example", None)
        return public(sp, sp.storage.save_agent(agent))

    @app.post("/api/agents/{agent_id}/train", tags=["entrenamiento"], dependencies=ADMIN, summary="Reentrenar el modelo")
    def train(agent_id: str, sp: Space = SPACE):
        """Entrena de nuevo (normalmente no hace falta: se reentrena solo al cambiar el agente) y devuelve el informe."""
        get_agent(sp, agent_id)
        engine = sp.engines.get(agent_id, fresh=True)
        return dict(engine_status(sp, agent_id), report=engine.report)

    @app.get("/api/agents/{agent_id}/model", tags=["entrenamiento"], dependencies=ADMIN, summary="Lo que ha aprendido el modelo")
    def model_info(agent_id: str, k: int = Query(8, ge=1, le=30, description="Rasgos por intención"),
                   chars: bool = Query(False, description="Incluir los trozos de letras"), sp: Space = SPACE):
        """Informe del entrenamiento, rasgos con más peso por intención, mapa de frases y último examen."""
        agent = get_agent(sp, agent_id)
        engine = sp.engines.get(agent_id)
        last = sp.evaluations.get(agent_id)
        return {
            "status": engine_status(sp, agent_id),
            "report": engine.report,
            "threshold": agent["settings"]["threshold"],
            "topFeatures": insights.top_features(engine, k=k, include_chars=chars),
            "projection": insights.public_projection(engine),
            "evaluation": last["result"] if last and last["version"] == agent["version"] else None,
        }

    @app.post("/api/agents/{agent_id}/explain", tags=["entrenamiento"], dependencies=ADMIN, summary="Explicar una frase paso a paso")
    def explain(agent_id: str, req: ExplainRequest, sp: Space = SPACE):
        """Recorrido completo de una frase por dentro del modelo: tokens, entidades, rasgos, probabilidades
        y la aportación de cada rasgo a la decisión."""
        agent = get_agent(sp, agent_id)
        engine = sp.engines.get(agent_id)
        return insights.explain(engine, req.text[:1000], req.contexts or [], agent["settings"]["threshold"])

    @app.post("/api/agents/{agent_id}/evaluate", tags=["entrenamiento"], dependencies=ADMIN, summary="Examen (validación cruzada)")
    def evaluate(agent_id: str, req: EvaluateRequest | None = None, sp: Space = SPACE):
        """Acierto con frases que el modelo no ha visto, por intención, con la matriz de confusión y los fallos."""
        agent = get_agent(sp, agent_id)
        result = insights.evaluate(agent, folds=(req.folds if req else 5))
        sp.evaluations[agent_id] = {"version": agent["version"], "result": result}
        return result

    @app.get("/api/agents/{agent_id}/status", tags=["entrenamiento"], dependencies=ADMIN, summary="Estado del modelo")
    def status(agent_id: str, sp: Space = SPACE):
        """Si el modelo está al día con la última versión del agente, cuándo se entrenó y cuánto tardó."""
        get_agent(sp, agent_id)
        return engine_status(sp, agent_id)

    @app.get("/api/agents/{agent_id}/validate", tags=["entrenamiento"], dependencies=ADMIN, summary="Avisos de calidad")
    def validate_agent(agent_id: str, sp: Space = SPACE):
        """Errores y consejos: frases repetidas, intenciones con pocas frases, contextos que nadie activa…"""
        return validate(get_agent(sp, agent_id))

    # ---------------------------------------------------------- intenciones
    @app.post("/api/agents/{agent_id}/intents", tags=["intenciones"], dependencies=ADMIN, status_code=201,
              summary="Crear una intención")
    def create_intent(agent_id: str, intent: dict = Body(..., examples=[INTENT_EXAMPLE]), sp: Space = SPACE):
        """Las frases pueden ir como texto o como `{"text", "annotations"}`; lo que falte se completa solo."""
        agent = get_agent(sp, agent_id)
        intent = dict(intent)
        intent["id"] = new_id("i")
        data = normalize_intent(intent)
        agent["intents"].append(data)
        saved = sp.storage.save_agent(agent)
        return find(saved["intents"], data["id"], "esa intención")

    @app.put("/api/agents/{agent_id}/intents/{intent_id}", tags=["intenciones"], dependencies=ADMIN,
             summary="Guardar una intención")
    def update_intent(agent_id: str, intent_id: str, intent: dict = Body(..., examples=[INTENT_EXAMPLE]),
                      sp: Space = SPACE):
        """Sustituye la intención entera por la que se envía."""
        agent = get_agent(sp, agent_id)
        old = find(agent["intents"], intent_id, "esa intención")
        intent = dict(intent)
        intent["id"] = intent_id
        agent["intents"][agent["intents"].index(old)] = normalize_intent(intent)
        saved = sp.storage.save_agent(agent)
        return find(saved["intents"], intent_id, "esa intención")

    @app.delete("/api/agents/{agent_id}/intents/{intent_id}", tags=["intenciones"], dependencies=ADMIN,
                summary="Borrar una intención")
    def delete_intent(agent_id: str, intent_id: str, sp: Space = SPACE):
        agent = get_agent(sp, agent_id)
        find(agent["intents"], intent_id, "esa intención")
        agent["intents"] = [i for i in agent["intents"] if i["id"] != intent_id]
        sp.storage.save_agent(agent)
        return {"ok": True}

    @app.post("/api/agents/{agent_id}/intents/{intent_id}/phrases", tags=["intenciones"], dependencies=ADMIN,
              status_code=201, summary="Añadir una frase de entrenamiento")
    def create_phrase(agent_id: str, intent_id: str, req: PhraseRequest, sp: Space = SPACE):
        """Si la frase estaba en otra intención, se mueve a esta. Sin `annotations`, las entidades se marcan solas."""
        agent = get_agent(sp, agent_id)
        if not req.text.strip():
            raise HTTPException(400, "La frase está vacía")
        phrase = add_phrase(sp, agent, intent_id, req.text.strip(), req.annotations)
        sp.storage.save_agent(agent)
        return phrase

    # ------------------------------------------------------------ entidades
    @app.post("/api/agents/{agent_id}/entities", tags=["entidades"], dependencies=ADMIN, status_code=201,
              summary="Crear una entidad")
    def create_entity(agent_id: str, entity: dict = Body(..., examples=[ENTITY_EXAMPLE]), sp: Space = SPACE):
        """`kind`: map (valores con sinónimos), list (solo valores) o regex (expresiones regulares)."""
        agent = get_agent(sp, agent_id)
        data = normalize_entity(dict(entity, id=new_id("e")))
        if any(e["name"] == data["name"] for e in agent["entities"]):
            raise HTTPException(409, f"Ya existe una entidad llamada @{data['name']}")
        agent["entities"].append(data)
        sp.storage.save_agent(agent)
        return data

    @app.put("/api/agents/{agent_id}/entities/{entity_id}", tags=["entidades"], dependencies=ADMIN,
             summary="Guardar una entidad")
    def update_entity(agent_id: str, entity_id: str, entity: dict = Body(..., examples=[ENTITY_EXAMPLE]),
                      sp: Space = SPACE):
        """Sustituye la entidad. Si cambia el nombre, se actualizan también las intenciones que la usan."""
        agent = get_agent(sp, agent_id)
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
        sp.storage.save_agent(agent)
        return data

    @app.delete("/api/agents/{agent_id}/entities/{entity_id}", tags=["entidades"], dependencies=ADMIN,
                summary="Borrar una entidad")
    def delete_entity(agent_id: str, entity_id: str, sp: Space = SPACE):
        agent = get_agent(sp, agent_id)
        find(agent["entities"], entity_id, "esa entidad")
        agent["entities"] = [e for e in agent["entities"] if e["id"] != entity_id]
        sp.storage.save_agent(agent)
        return {"ok": True}

    @app.post("/api/agents/{agent_id}/entities/{entity_id}/synonyms", tags=["entidades"], dependencies=ADMIN,
              summary="Añadir un sinónimo")
    def add_synonym(agent_id: str, entity_id: str, req: SynonymRequest, sp: Space = SPACE):
        agent = get_agent(sp, agent_id)
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
        saved = sp.storage.save_agent(agent)
        return find(saved["entities"], entity_id, "esa entidad")

    # ------------------------------------------------------- NLU y diálogo
    @app.post("/api/agents/{agent_id}/annotate", tags=["nlu"], dependencies=ADMIN, summary="Anotar entidades automáticamente")
    def annotate(agent_id: str, req: AnnotateRequest, sp: Space = SPACE):
        """Propone qué partes de la frase son entidades y con qué parámetro (como al escribir una frase en la consola)."""
        agent = get_agent(sp, agent_id)
        intent = next((i for i in agent["intents"] if i["id"] == req.intentId), None)
        return sp.engines.get(agent_id).auto_annotate(req.text, intent)

    @app.post("/api/agents/{agent_id}/analyze", tags=["nlu"], dependencies=ADMIN, summary="Analizar una frase")
    def analyze(agent_id: str, req: AnalyzeRequest, sp: Space = SPACE):
        """Tokens, entidades, intenciones candidatas con su confianza, parámetros y frases parecidas.
        No crea conversación ni guarda nada."""
        agent = get_agent(sp, agent_id)
        engine = sp.engines.get(agent_id)
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
        mensajes de una conversación: así se recuerdan los contextos y las preguntas pendientes. En un
        servidor con cuentas, el agente va con su dirección pública (`publicId`, «<espacio>.<agente>»)."""
        sp, aid = locate(agent_id, request)
        check_key(sp, aid, request)
        try:
            return sp.dialog.detect(aid, req.sessionId or "", text=req.text, event=req.event,
                                    parameters=req.parameters, contexts=req.contexts,
                                    payload=req.payload, source=(req.source or "api")[:20],
                                    debug=req.debug)
        except ValueError as e:
            raise HTTPException(400, str(e)) from None

    @app.post("/api/agents/{agent_id}/sessions/{session_id}/reset", tags=["conversación"], dependencies=KEY,
              summary="Empezar la conversación de cero")
    def reset_session(agent_id: str, session_id: str, request: Request):
        """Olvida los contextos y las preguntas pendientes de esa sesión."""
        sp, aid = locate(agent_id, request)
        check_key(sp, aid, request)
        sp.dialog.reset(aid, session_id)
        return {"ok": True}

    @app.get("/api/agents/{agent_id}/public", tags=["conversación"], summary="Datos públicos del agente")
    def public_info(agent_id: str, request: Request):
        """Datos mínimos para el widget de chat: nombre, idioma y si hace falta clave."""
        sp, aid = locate(agent_id, request)
        agent = get_agent(sp, aid)
        return {"id": sp.ref(aid), "name": agent["name"], "language": agent["language"],
                "needsKey": bool(agent["settings"].get("apiKey"))}

    # ------------------------------------------- entrenamiento e historial
    @app.get("/api/agents/{agent_id}/logs", tags=["entrenamiento"], dependencies=ADMIN, summary="Mensajes para revisar")
    def list_logs(agent_id: str,
                  review: str | None = Query("pending", description="pending, approved, corrected, ignored o vacío para todos"),
                  fallback: bool = Query(False, description="Solo los no entendidos"),
                  lowConfidence: float | None = Query(None, description="Solo los que tienen menos confianza que esta"),
                  q: str = Query("", description="Buscar texto"), limit: int = Query(100, le=500), offset: int = 0,
                  sp: Space = SPACE):
        """Los mensajes reales de los usuarios, para aprobarlos o corregirlos (pantalla Revisión)."""
        get_agent(sp, agent_id)
        items, total = sp.storage.list_logs(agent_id, review=review or None, only_fallback=fallback,
                                            max_confidence=lowConfidence, search=q, limit=limit,
                                            offset=offset)
        return {"items": items, "total": total}

    @app.post("/api/agents/{agent_id}/logs/{log_id}/review", tags=["entrenamiento"], dependencies=ADMIN,
              summary="Revisar un mensaje")
    def review_log(agent_id: str, log_id: int, req: ReviewRequest, sp: Space = SPACE):
        """Aprobar o asignar un mensaje lo convierte en frase de entrenamiento; también se puede ignorar."""
        agent = get_agent(sp, agent_id)
        try:
            log = sp.storage.get_log(agent_id, log_id)
        except NotFound:
            raise HTTPException(404, "No existe ese mensaje") from None
        text = (req.text or log.get("query") or "").strip()
        if req.action == "ignore":
            sp.storage.set_review(agent_id, [log_id], "ignored")
            return {"ok": True, "review": "ignored"}
        if req.action == "reopen":
            sp.storage.set_review(agent_id, [log_id], "pending")
            return {"ok": True, "review": "pending"}
        if req.action not in ("approve", "assign"):
            raise HTTPException(400, "Acción desconocida")
        intent_id = req.intentId if req.action == "assign" else log.get("intentId")
        if not intent_id:
            raise HTTPException(400, "Indica a qué intención pertenece la frase")
        if not text:
            raise HTTPException(400, "El mensaje no tiene texto")
        phrase = add_phrase(sp, agent, intent_id, text, req.annotations)
        sp.storage.save_agent(agent)
        review = "approved" if req.action == "approve" else "corrected"
        sp.storage.set_review(agent_id, [log_id], review)
        sp.storage.review_similar(agent_id, text, review)
        return {"ok": True, "review": review, "phrase": phrase, "intentId": intent_id}

    @app.post("/api/agents/{agent_id}/logs/clear", tags=["entrenamiento"], dependencies=ADMIN,
              summary="Vaciar el registro de mensajes")
    def clear_logs(agent_id: str, sp: Space = SPACE):
        """Borra todos los mensajes y conversaciones guardados del agente."""
        get_agent(sp, agent_id)
        sp.storage.clear_logs(agent_id)
        return {"ok": True}

    @app.get("/api/agents/{agent_id}/conversations", tags=["historial"], dependencies=ADMIN, summary="Listar conversaciones")
    def conversations(agent_id: str, limit: int = Query(50, le=500), offset: int = 0, sp: Space = SPACE):
        get_agent(sp, agent_id)
        items, total = sp.storage.conversations(agent_id, limit, offset)
        return {"items": items, "total": total}

    @app.get("/api/agents/{agent_id}/conversations/{session_id}", tags=["historial"], dependencies=ADMIN,
             summary="Leer una conversación")
    def conversation(agent_id: str, session_id: str, sp: Space = SPACE):
        """Todos los turnos de una conversación, con lo que se entendió en cada uno."""
        get_agent(sp, agent_id)
        return sp.storage.conversation(agent_id, session_id)

    @app.get("/api/agents/{agent_id}/stats", tags=["historial"], dependencies=ADMIN, summary="Estadísticas de uso")
    def stats(agent_id: str, days: int = Query(30, ge=1, le=365, description="Días hacia atrás"),
              tz: int = Query(0, ge=-900, le=900, description="Minutos de diferencia con UTC (getTimezoneOffset del navegador)"),
              sp: Space = SPACE):
        """Mensajes, conversaciones, no entendidos, intenciones más usadas y actividad por día."""
        get_agent(sp, agent_id)
        return sp.storage.stats(agent_id, days, tz)

    @app.get("/api/system-entities", tags=["general"], summary="Entidades del sistema")
    def system_entities():
        """Las entidades @sys.* que reconoce cualquier agente sin configurar nada."""
        return [{"name": k, "description": v} for k, v in SYSTEM_ENTITIES.items()]

    # ------------------------------------------------------------ compartir
    if accounts:
        def shared_or_404(code: str) -> dict:
            record = shares.get(code)
            if record is None:
                raise HTTPException(404, "Ese enlace ya no existe: quien lo compartió puede haberlo quitado")
            return record

        @app.get("/api/agents/{agent_id}/share", tags=["compartir"], dependencies=ADMIN, summary="Ver si se comparte")
        def share_status(agent_id: str, sp: Space = SPACE):
            """El código del enlace con el que se comparte el agente (`code`), o `null` si no se comparte."""
            get_agent(sp, agent_id)
            return shares.of(sp, agent_id) or {"code": None}

        @app.post("/api/agents/{agent_id}/share", tags=["compartir"], dependencies=ADMIN, summary="Compartir un agente")
        def share(agent_id: str, sp: Space = SPACE):
            """Guarda una copia del agente (sin clave de API ni webhook) y devuelve su código: quien abra
            `/#/shared/<código>` puede guardarla en su cuenta o descargarla. Volver a compartir actualiza la
            copia sin cambiar el enlace."""
            agent = get_agent(sp, agent_id)
            try:
                return shares.share(sp, agent)
            except SpaceLimit as e:
                raise HTTPException(409, str(e)) from None

        @app.delete("/api/agents/{agent_id}/share", tags=["compartir"], dependencies=ADMIN, summary="Dejar de compartir")
        def unshare(agent_id: str, sp: Space = SPACE):
            """Borra la copia compartida: el enlace deja de funcionar (las copias que ya guardó la gente se quedan)."""
            get_agent(sp, agent_id)
            shares.unshare(sp, agent_id)
            return {"ok": True}

        @app.get("/api/shared/{code}", tags=["compartir"], summary="Ver un agente compartido")
        def shared_info(code: str):
            """Resumen de la copia compartida: nombre, descripción, cuántas intenciones, entidades y frases
            tiene y el nombre de sus intenciones. No hace falta cuenta."""
            record = shared_or_404(code)
            a = record["agent"]
            intents = a.get("intents") or []
            return {"code": code, "name": a.get("name", ""), "description": a.get("description", ""),
                    "language": a.get("language", "es"), "intents": len(intents),
                    "entities": len(a.get("entities") or []),
                    "phrases": sum(len(i.get("trainingPhrases") or []) for i in intents),
                    "intentNames": [i.get("name", "") for i in intents][:60], "sharedAt": record["sharedAt"]}

        @app.get("/api/shared/{code}/download", tags=["compartir"], summary="Descargar un agente compartido")
        def shared_download(code: str):
            """El agente en JSON, para importarlo en una instalación local (Agentes → Importar)."""
            agent = shared_or_404(code)["agent"]
            body = json.dumps(agent, ensure_ascii=False, indent=2)
            return Response(body, media_type="application/json", headers={
                "Content-Disposition": f'attachment; filename="{slugify(agent.get("name", ""))}.json"'})

        @app.post("/api/shared/{code}/save", tags=["compartir"], dependencies=ADMIN, status_code=201,
                  summary="Guardar un agente compartido en mi cuenta")
        def shared_save(code: str, sp: Space = SPACE):
            """Guarda una copia en tu cuenta. Es tuya: lo que cambies no afecta al original ni al revés."""
            room_for_agent(sp)
            agent = copy.deepcopy(shared_or_404(code)["agent"])
            agent["id"] = sp.storage.unique_id(agent.get("name") or "agente")
            agent["version"] = 0
            return public(sp, sp.storage.save_agent(agent))

    # ---------------------------------------- compatibilidad con Dialogflow
    @app.post("/v2/projects/{agent_id}/agent/sessions/{session_id}:detectIntent",
              tags=["compatibilidad Dialogflow"], dependencies=KEY, summary="detectIntent (Dialogflow ES v2)")
    def df_detect(agent_id: str, session_id: str, request: Request,
                  body: dict = Body(..., examples=[{"queryInput": {"text": {"text": "hola", "languageCode": "es"}}}])):
        """Mismo formato que detectIntent de Dialogflow ES v2."""
        sp, aid = locate(agent_id, request)
        check_key(sp, aid, request)
        qi = body.get("queryInput") or {}
        qp = body.get("queryParams") or {}
        text = (qi.get("text") or {}).get("text")
        ev = qi.get("event") or {}
        contexts = [{"name": c.get("name", ""), "lifespan": c.get("lifespanCount", 5),
                     "parameters": c.get("parameters") or {}} for c in qp.get("contexts") or []]
        try:
            r = sp.dialog.detect(aid, session_id, text=text, event=ev.get("name"),
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
                "languageCode": get_agent(sp, aid)["language"],
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

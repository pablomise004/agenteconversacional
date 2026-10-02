"""Usuarios, espacios privados y agentes compartidos (modo AGENTE_ACCOUNTS, para un servidor público).

Cada usuario tiene su espacio: una carpeta data/spaces/<id>/ con sus agentes y sus conversaciones,
igual que la carpeta data/ de una instalación normal. Al entrar (usuario y contraseña), el navegador
recibe la llave del espacio y la manda en la cabecera X-Space-Key. El nombre de la carpeta es la huella
de la llave (sha256), que es también la parte pública de las direcciones de sus agentes
(«3f9a1c0b7d2e4f6a.pizzeria», la que usan el widget y el chat): con la llave se administra el
espacio; con la dirección pública solo se puede conversar.

Compartir un agente guarda una copia (sin clave de API ni webhook) en data/shared/<código>.json.
Quien abre el enlace puede guardar otra copia en su espacio o descargarla para una instalación local.
En el modo normal (un solo usuario, sin cuentas) hay un único espacio: la carpeta data/ de siempre.
"""

from __future__ import annotations

import copy
import hashlib
import json
import os
import re
import secrets
import threading
import time
from collections import OrderedDict, deque
from collections.abc import Callable
from pathlib import Path

from .dialog import DialogManager, EngineCache
from .nlu.engine import NLUEngine
from .storage import Storage

KEY_RE = re.compile(r"^[A-Za-z0-9_-]{20,100}$")
ID_RE = re.compile(r"^[0-9a-f]{16}$")
CODE_RE = re.compile(r"^[A-Za-z0-9_-]{6,32}$")


class SpaceLimit(Exception):
    """No se puede crear (un espacio, un agente, un enlace): se ha llegado a un límite."""


class ModelPool:
    """Modelos entrenados compartidos: dos agentes con el mismo contenido (los ejemplos sin tocar, en
    espacios distintos) usan el mismo modelo, así el hotel se entrena una vez y no una por visitante.
    Solo cuenta lo que usa el motor (no el nombre ni el umbral)."""

    def __init__(self, size: int = 48):
        self.size = size
        self._models: OrderedDict[str, NLUEngine] = OrderedDict()
        self._locks: dict[str, threading.Lock] = {}
        self._lock = threading.Lock()

    @staticmethod
    def fingerprint(agent: dict) -> str:
        settings = agent.get("settings") or {}
        data = {"language": agent.get("language"), "timezone": agent.get("timezone"),
                "normalization": settings.get("normalization"), "spell": settings.get("spellCorrection", True),
                "entities": agent.get("entities"), "intents": agent.get("intents")}
        return hashlib.sha256(json.dumps(data, sort_keys=True, ensure_ascii=False).encode()).hexdigest()

    def get(self, agent: dict, fresh: bool = False) -> NLUEngine:
        """El modelo de ese contenido (lo entrena si no lo hay; con `fresh`, siempre)."""
        key = self.fingerprint(agent)
        with self._lock:
            lock = self._locks.setdefault(key, threading.Lock())
        with lock:  # dos peticiones a la vez con el mismo agente entrenan una sola vez
            with self._lock:
                engine = None if fresh else self._models.get(key)
                if engine is not None:
                    self._models.move_to_end(key)
                    return engine
            t0 = time.time()
            engine = NLUEngine(agent)
            engine.build_ms = int((time.time() - t0) * 1000)
            with self._lock:
                self._models[key] = engine
                self._models.move_to_end(key)
                while len(self._models) > self.size:
                    old, _ = self._models.popitem(last=False)
                    self._locks.pop(old, None)
            return engine


class Space:
    """Los agentes de alguien con sus modelos, su diálogo y sus exámenes."""

    def __init__(self, data_dir: Path, pool: ModelPool | None = None, public_id: str = ""):
        self.dir = Path(data_dir)
        self.public_id = public_id
        self.storage = Storage(self.dir)
        self.engines = EngineCache(self.storage, pool)
        self.dialog = DialogManager(self.storage, self.engines)
        self.evaluations: dict[str, dict] = {}  # último examen por agente

    def ref(self, agent_id: str) -> str:
        """Dirección pública de un agente (widget, chat y API de conversación)."""
        return f"{self.public_id}.{agent_id}" if self.public_id else agent_id


class Spaces:
    """Los espacios de data/spaces/, cargados según se usan (se quedan en memoria los más recientes)."""

    def __init__(self, data_dir: Path, pool: ModelPool, seed: Callable[[Storage, Path], None],
                 loaded: int = 100, per_hour: int | None = None, max_spaces: int | None = None):
        self.root = Path(data_dir) / "spaces"
        self.root.mkdir(parents=True, exist_ok=True)
        self.pool = pool
        self.seed = seed  # copia los agentes de ejemplo (server.seed_examples)
        self.loaded = loaded
        self.per_hour = per_hour or int(os.environ.get("AGENTE_SPACES_PER_HOUR", "200"))
        self.max_spaces = max_spaces or int(os.environ.get("AGENTE_SPACES_MAX", "5000"))
        self._spaces: OrderedDict[str, Space] = OrderedDict()
        self._created: deque[float] = deque()
        self._lock = threading.RLock()

    @staticmethod
    def id_of(key: str) -> str:
        return hashlib.sha256(key.encode()).hexdigest()[:16]

    def _keep(self, sid: str, space: Space) -> Space:
        self._spaces[sid] = space
        self._spaces.move_to_end(sid)
        while len(self._spaces) > self.loaded:
            self._spaces.popitem(last=False)
        return space

    def create(self) -> tuple[str, Space]:
        """Un espacio nuevo con los ejemplos. Devuelve la llave (solo la tiene el navegador)."""
        with self._lock:
            now = time.time()
            while self._created and now - self._created[0] > 3600:
                self._created.popleft()
            if len(self._created) >= self.per_hour:
                raise SpaceLimit("Se han creado muchas cuentas en la última hora. Prueba dentro de un rato.")
            if sum(1 for _ in self.root.iterdir()) >= self.max_spaces:
                raise SpaceLimit("El servidor ha llegado al máximo de cuentas.")
            key = secrets.token_urlsafe(24)
            sid = self.id_of(key)
            folder = self.root / sid
            folder.mkdir()
            space = Space(folder, self.pool, sid)
            self.seed(space.storage, folder)
            self._created.append(now)
            return key, self._keep(sid, space)

    def get(self, sid: str) -> Space | None:
        """El espacio de esa dirección pública, o None si no existe."""
        if not ID_RE.match(sid or ""):
            return None
        with self._lock:
            space = self._spaces.get(sid)
            if space is not None:
                self._spaces.move_to_end(sid)
                return space
            folder = self.root / sid
            if not folder.is_dir():
                return None
            return self._keep(sid, Space(folder, self.pool, sid))

    def by_key(self, key: str) -> Space | None:
        """El espacio de esa llave, o None si la llave no vale o el espacio ya no existe."""
        return self.get(self.id_of(key)) if KEY_RE.match(key or "") else None


def shareable(agent: dict) -> dict:
    """Copia de un agente para compartir: sin clave de API ni webhook (la URL y las cabeceras pueden
    llevar secretos, y una copia no debe llamar al servidor del original)."""
    a = copy.deepcopy(agent)
    for k in ("id", "version", "updatedAt", "example"):
        a.pop(k, None)
    settings = a.setdefault("settings", {})
    settings["apiKey"] = ""
    settings["webhook"] = {"url": "", "headers": {}, "timeout": (settings.get("webhook") or {}).get("timeout", 5)}
    return a


class Shares:
    """Agentes compartidos: data/shared/<código>.json y, en cada espacio, shares.json con
    qué código tiene cada agente (volver a compartir actualiza la copia sin cambiar el enlace)."""

    MAX_PER_SPACE = 30
    MAX_BYTES = 5 * 1024 * 1024

    def __init__(self, data_dir: Path):
        self.dir = Path(data_dir) / "shared"
        self.dir.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()

    @staticmethod
    def _index_path(space: Space) -> Path:
        return space.dir / "shares.json"

    def _index(self, space: Space) -> dict:
        try:
            return json.loads(self._index_path(space).read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return {}

    def _write(self, path: Path, data: dict) -> None:
        tmp = path.with_suffix(".tmp")
        tmp.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
        os.replace(tmp, path)

    def get(self, code: str) -> dict | None:
        if not CODE_RE.match(code or ""):
            return None
        try:
            return json.loads((self.dir / f"{code}.json").read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return None

    def of(self, space: Space, agent_id: str) -> dict | None:
        """El enlace con el que se comparte ese agente, si se comparte."""
        code = self._index(space).get(agent_id)
        record = self.get(code) if code else None
        return {"code": code, "sharedAt": record["sharedAt"]} if record else None

    def share(self, space: Space, agent: dict) -> dict:
        snapshot = shareable(agent)
        if len(json.dumps(snapshot, ensure_ascii=False).encode()) > self.MAX_BYTES:
            raise SpaceLimit("El agente es demasiado grande para compartirlo (máximo 5 MB).")
        with self._lock:
            index = self._index(space)
            code = index.get(agent["id"])
            if not code or self.get(code) is None:
                if len(index) >= self.MAX_PER_SPACE:
                    raise SpaceLimit(f"Ya compartes {self.MAX_PER_SPACE} agentes: deja de compartir alguno.")
                code = secrets.token_urlsafe(6)
            record = {"code": code, "space": space.public_id, "agentId": agent["id"],
                      "sharedAt": time.time(), "agent": snapshot}
            self._write(self.dir / f"{code}.json", record)
            index[agent["id"]] = code
            self._write(self._index_path(space), index)
        return {"code": code, "sharedAt": record["sharedAt"]}

    def unshare(self, space: Space, agent_id: str) -> bool:
        with self._lock:
            index = self._index(space)
            code = index.pop(agent_id, None)
            if code is None:
                return False
            try:
                (self.dir / f"{code}.json").unlink()
            except FileNotFoundError:
                pass
            self._write(self._index_path(space), index)
            return True


USER_RE = re.compile(r"^[a-z0-9][a-z0-9._-]{2,29}$")


class AccountError(Exception):
    """Error al crear la cuenta o al entrar, con el código HTTP que le corresponde."""

    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.status = status


class Accounts:
    """Cuentas: un usuario y una contraseña abren su espacio desde cualquier navegador.

    data/users/<usuario>.json guarda la contraseña cifrada (scrypt con sal) y la llave del espacio,
    que se le da al navegador al entrar; el espacio guarda el nombre de su usuario en account.json.
    Tras varios intentos fallidos seguidos, el usuario queda bloqueado unos minutos.
    """

    MAX_FAILS = 8
    LOCK_SECONDS = 300
    MIN_PASSWORD = 6

    def __init__(self, data_dir: Path, spaces: Spaces | None = None):
        self.dir = Path(data_dir) / "users"
        self.dir.mkdir(parents=True, exist_ok=True)
        self.spaces = spaces
        self._fails: dict[str, list[float]] = {}
        self._lock = threading.Lock()

    @staticmethod
    def _hash(password: str, salt: bytes) -> str:
        return hashlib.scrypt(password.encode("utf-8"), salt=salt, n=2 ** 14, r=8, p=1, dklen=32).hex()

    def _path(self, user: str) -> Path | None:
        name = (user or "").strip().lower()
        return self.dir / f"{name}.json" if USER_RE.match(name) else None

    def _read(self, path: Path | None) -> dict | None:
        try:
            return json.loads(path.read_text(encoding="utf-8")) if path else None
        except (OSError, ValueError):
            return None

    def _write(self, path: Path, data: dict) -> None:
        tmp = path.with_suffix(".tmp")
        tmp.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
        os.replace(tmp, path)

    def _check_password(self, password: str) -> None:
        if len(password or "") < self.MIN_PASSWORD:
            raise AccountError(f"La contraseña tiene que tener al menos {self.MIN_PASSWORD} caracteres.")

    def register(self, user: str, password: str) -> tuple[str, Space]:
        """Crea la cuenta y su espacio (con los ejemplos). Devuelve la llave del espacio."""
        name = (user or "").strip()
        path = self._path(name)
        if path is None:
            raise AccountError("El usuario tiene que tener de 3 a 30 caracteres: letras sin tildes ni eñes, "
                               "números, puntos o guiones (y empezar por letra o número).")
        self._check_password(password)
        with self._lock:
            if path.exists():
                raise AccountError("Ese usuario ya existe: elige otro, o entra con su contraseña.", 409)
            try:
                key, space = self.spaces.create()
            except SpaceLimit as e:
                raise AccountError(str(e), 429) from None
            salt = secrets.token_bytes(16)
            self._write(path, {"user": name, "salt": salt.hex(), "hash": self._hash(password, salt),
                               "space": key, "created": time.time()})
            self._write(space.dir / "account.json", {"user": name})
        return key, space

    def login(self, user: str, password: str) -> tuple[str, str]:
        """Comprueba la contraseña. Devuelve la llave del espacio y el nombre del usuario."""
        name = (user or "").strip().lower()
        now = time.time()
        with self._lock:
            fails = [t for t in self._fails.get(name, []) if now - t < self.LOCK_SECONDS]
            self._fails[name] = fails
            if len(fails) >= self.MAX_FAILS:
                raise AccountError("Demasiados intentos fallidos con ese usuario: espera cinco minutos.", 429)
        record = self._read(self._path(name))
        # si el usuario no existe también se calcula un hash, para no delatar qué usuarios existen
        salt = bytes.fromhex(record["salt"]) if record else b"0" * 16
        digest = self._hash(password or "", salt)
        if not record or not secrets.compare_digest(digest, record["hash"]):
            with self._lock:
                self._fails.setdefault(name, []).append(now)
            raise AccountError("Usuario o contraseña incorrectos.", 401)
        with self._lock:
            self._fails.pop(name, None)
        return record["space"], record["user"]

    def user_of(self, space: Space) -> str:
        """El usuario dueño de un espacio ("" si no tiene)."""
        record = self._read(space.dir / "account.json")
        return record.get("user", "") if record else ""

    def change_password(self, space: Space, current: str, new: str) -> None:
        user = self.user_of(space)
        key, _ = self.login(user, current)  # comprueba la actual (y cuenta los fallos)
        self._check_password(new)
        path = self._path(user)
        with self._lock:
            record = self._read(path)
            salt = secrets.token_bytes(16)
            record.update(salt=salt.hex(), hash=self._hash(new, salt))
            self._write(path, record)

    def reset_password(self, user: str, new: str) -> None:
        """Para el dueño del servidor (python -m app.users): pone una contraseña nueva."""
        path = self._path(user)
        record = self._read(path)
        if not record:
            raise AccountError("No existe ese usuario.", 404)
        self._check_password(new)
        salt = secrets.token_bytes(16)
        record.update(salt=salt.hex(), hash=self._hash(new, salt))
        self._write(path, record)

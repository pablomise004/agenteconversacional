"""Almacenamiento.

- Agentes: un JSON por agente en data/agents/<id>.json (se puede versionar o
  copiar a mano).
- Sesiones de conversación y registro de mensajes: SQLite en
  data/runtime.sqlite3.
"""

import copy
import json
import os
import re
import sqlite3
import threading
import time
from contextlib import contextmanager
from pathlib import Path

from .agents import normalize_agent, slugify, summary

_ID_RE = re.compile(r"^[a-z0-9][a-z0-9_-]{0,63}$")

SCHEMA = """
CREATE TABLE IF NOT EXISTS logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    agent_id TEXT NOT NULL,
    session_id TEXT NOT NULL,
    ts REAL NOT NULL,
    source TEXT,
    query TEXT,
    event TEXT,
    intent_id TEXT,
    intent_name TEXT,
    confidence REAL,
    is_fallback INTEGER DEFAULT 0,
    match TEXT,
    parameters TEXT,
    response TEXT,
    analysis TEXT,
    review TEXT DEFAULT 'pending'
);
CREATE INDEX IF NOT EXISTS logs_agent_ts ON logs(agent_id, ts);
CREATE INDEX IF NOT EXISTS logs_agent_session ON logs(agent_id, session_id);
CREATE TABLE IF NOT EXISTS sessions (
    agent_id TEXT NOT NULL,
    session_id TEXT NOT NULL,
    state TEXT NOT NULL,
    updated REAL NOT NULL,
    PRIMARY KEY (agent_id, session_id)
);
"""


class NotFound(Exception):
    pass


def valid_id(agent_id: str) -> bool:
    return bool(_ID_RE.match(agent_id or ""))


class Storage:
    SESSION_TTL = 20 * 60  # las conversaciones caducan tras 20 min sin mensajes

    def __init__(self, data_dir: Path):
        self.data_dir = Path(data_dir)
        self.agents_dir = self.data_dir / "agents"
        self.agents_dir.mkdir(parents=True, exist_ok=True)
        self.db_path = self.data_dir / "runtime.sqlite3"
        self._lock = threading.RLock()
        self._agents: dict[str, dict] = {}
        with self._db() as db:
            db.executescript(SCHEMA)
        self._load_all()

    # ------------------------------------------------------------------ SQLite
    @contextmanager
    def _db(self):
        conn = sqlite3.connect(self.db_path, timeout=10)
        conn.row_factory = sqlite3.Row
        try:
            conn.execute("PRAGMA journal_mode=WAL")
            yield conn
            conn.commit()
        finally:
            conn.close()

    # ----------------------------------------------------------------- agentes
    def _load_all(self) -> None:
        for path in sorted(self.agents_dir.glob("*.json")):
            try:
                data = json.loads(path.read_text(encoding="utf-8"))
            except (OSError, ValueError):
                continue
            data["id"] = path.stem
            self._agents[path.stem] = normalize_agent(data)
            self._agents[path.stem]["id"] = path.stem

    def list_agents(self) -> list[dict]:
        with self._lock:
            return sorted((summary(a) for a in self._agents.values()), key=lambda s: s["name"].lower())

    def has_agent(self, agent_id: str) -> bool:
        return agent_id in self._agents

    def get_agent(self, agent_id: str) -> dict:
        """Devuelve una copia del agente (modificarla no afecta al guardado)."""
        with self._lock:
            agent = self._agents.get(agent_id)
            if agent is None:
                raise NotFound(agent_id)
            return copy.deepcopy(agent)

    def agent_ref(self, agent_id: str) -> dict:
        """Referencia de solo lectura (sin copiar), para el motor."""
        agent = self._agents.get(agent_id)
        if agent is None:
            raise NotFound(agent_id)
        return agent

    def unique_id(self, name: str) -> str:
        base = slugify(name)
        candidate, n = base, 2
        while candidate in self._agents:
            candidate = f"{base}-{n}"
            n += 1
        return candidate

    def save_agent(self, agent: dict) -> dict:
        with self._lock:
            agent_id = agent.get("id") or self.unique_id(agent.get("name", "agente"))
            if not valid_id(agent_id):
                agent_id = self.unique_id(agent.get("name", "agente"))
            old = self._agents.get(agent_id)
            data = normalize_agent(agent)
            data["id"] = agent_id
            data["version"] = (old["version"] if old else int(agent.get("version") or 0)) + 1
            data["updatedAt"] = time.time()
            path = self.agents_dir / f"{agent_id}.json"
            tmp = path.with_suffix(".json.tmp")
            tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
            os.replace(tmp, path)
            self._agents[agent_id] = data
            return copy.deepcopy(data)

    def delete_agent(self, agent_id: str) -> None:
        with self._lock:
            if agent_id not in self._agents:
                raise NotFound(agent_id)
            del self._agents[agent_id]
            try:
                (self.agents_dir / f"{agent_id}.json").unlink()
            except FileNotFoundError:
                pass
        with self._db() as db:
            db.execute("DELETE FROM logs WHERE agent_id=?", (agent_id,))
            db.execute("DELETE FROM sessions WHERE agent_id=?", (agent_id,))

    # ---------------------------------------------------------------- sesiones
    def load_session(self, agent_id: str, session_id: str) -> dict | None:
        with self._db() as db:
            row = db.execute("SELECT state, updated FROM sessions WHERE agent_id=? AND session_id=?",
                             (agent_id, session_id)).fetchone()
        if not row or time.time() - row["updated"] > self.SESSION_TTL:
            return None
        try:
            return json.loads(row["state"])
        except ValueError:
            return None

    def save_session(self, agent_id: str, session_id: str, state: dict) -> None:
        with self._db() as db:
            db.execute(
                "INSERT INTO sessions(agent_id, session_id, state, updated) VALUES (?,?,?,?) "
                "ON CONFLICT(agent_id, session_id) DO UPDATE SET state=excluded.state, "
                "updated=excluded.updated",
                (agent_id, session_id, json.dumps(state, ensure_ascii=False), time.time()))
            # limpieza ocasional de sesiones viejas
            db.execute("DELETE FROM sessions WHERE updated < ?", (time.time() - 7 * 86400,))

    def delete_session(self, agent_id: str, session_id: str) -> None:
        with self._db() as db:
            db.execute("DELETE FROM sessions WHERE agent_id=? AND session_id=?", (agent_id, session_id))

    # ------------------------------------------------------------------- logs
    def add_log(self, agent_id: str, entry: dict) -> int:
        # las respuestas a preguntas del bot ("grande") no son frases de entrenamiento útiles
        reviewable = bool(entry.get("query")) and entry.get("match") not in ("slot", "cancel", "event")
        with self._db() as db:
            cur = db.execute(
                "INSERT INTO logs(agent_id, session_id, ts, source, query, event, intent_id, "
                "intent_name, confidence, is_fallback, match, parameters, response, analysis, review) "
                "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (agent_id, entry.get("sessionId", ""), time.time(), entry.get("source", "api"),
                 entry.get("query"), entry.get("event"), entry.get("intentId"),
                 entry.get("intentName"), entry.get("confidence"),
                 1 if entry.get("isFallback") else 0, entry.get("match"),
                 json.dumps(entry.get("parameters") or {}, ensure_ascii=False),
                 entry.get("response", ""),
                 json.dumps(entry.get("analysis") or {}, ensure_ascii=False),
                 "pending" if reviewable else "none"))
            return cur.lastrowid

    @staticmethod
    def _row(row) -> dict:
        d = dict(row)
        for k in ("parameters", "analysis"):
            try:
                d[k] = json.loads(d[k] or "{}")
            except ValueError:
                d[k] = {}
        d["isFallback"] = bool(d.pop("is_fallback"))
        d["sessionId"] = d.pop("session_id")
        d["intentId"] = d.pop("intent_id")
        d["intentName"] = d.pop("intent_name")
        d.pop("agent_id", None)
        return d

    def list_logs(self, agent_id: str, review: str | None = None, only_fallback: bool = False,
                  max_confidence: float | None = None, search: str = "", limit: int = 100,
                  offset: int = 0, with_text: bool = True) -> tuple[list[dict], int]:
        where = ["agent_id=?"]
        args: list = [agent_id]
        if with_text:
            where.append("query IS NOT NULL AND query != '' AND review != 'none'")
        if review:
            where.append("review=?")
            args.append(review)
        if only_fallback:
            where.append("is_fallback=1")
        if max_confidence is not None:
            where.append("(confidence IS NULL OR confidence < ? OR is_fallback=1)")
            args.append(max_confidence)
        if search:
            where.append("query LIKE ?")
            args.append(f"%{search}%")
        sql_where = " AND ".join(where)
        with self._db() as db:
            total = db.execute(f"SELECT COUNT(*) FROM logs WHERE {sql_where}", args).fetchone()[0]
            rows = db.execute(f"SELECT * FROM logs WHERE {sql_where} ORDER BY ts DESC LIMIT ? OFFSET ?",
                              args + [limit, offset]).fetchall()
        return [self._row(r) for r in rows], total

    def get_log(self, agent_id: str, log_id: int) -> dict:
        with self._db() as db:
            row = db.execute("SELECT * FROM logs WHERE agent_id=? AND id=?", (agent_id, log_id)).fetchone()
        if not row:
            raise NotFound(str(log_id))
        return self._row(row)

    def set_review(self, agent_id: str, log_ids: list[int], review: str) -> None:
        with self._db() as db:
            db.executemany("UPDATE logs SET review=? WHERE agent_id=? AND id=?",
                           [(review, agent_id, i) for i in log_ids])

    def review_similar(self, agent_id: str, query: str, review: str) -> None:
        """Marca como revisados los demás mensajes pendientes con el mismo texto."""
        with self._db() as db:
            db.execute("UPDATE logs SET review=? WHERE agent_id=? AND review='pending' AND "
                       "lower(trim(query))=lower(trim(?))", (review, agent_id, query))

    def conversations(self, agent_id: str, limit: int = 100, offset: int = 0) -> tuple[list[dict], int]:
        with self._db() as db:
            total = db.execute("SELECT COUNT(DISTINCT session_id) FROM logs WHERE agent_id=?",
                               (agent_id,)).fetchone()[0]
            rows = db.execute(
                "SELECT session_id, MIN(ts) AS started, MAX(ts) AS last, COUNT(*) AS turns, "
                "SUM(is_fallback) AS fallbacks, MAX(source) AS source FROM logs WHERE agent_id=? "
                "GROUP BY session_id ORDER BY last DESC LIMIT ? OFFSET ?",
                (agent_id, limit, offset)).fetchall()
            out = []
            for r in rows:
                first = db.execute("SELECT query FROM logs WHERE agent_id=? AND session_id=? AND "
                                   "query IS NOT NULL AND query != '' ORDER BY ts LIMIT 1",
                                   (agent_id, r["session_id"])).fetchone()
                out.append({"sessionId": r["session_id"], "started": r["started"], "last": r["last"],
                            "turns": r["turns"], "fallbacks": r["fallbacks"] or 0,
                            "source": r["source"], "firstMessage": first[0] if first else ""})
        return out, total

    def conversation(self, agent_id: str, session_id: str) -> list[dict]:
        with self._db() as db:
            rows = db.execute("SELECT * FROM logs WHERE agent_id=? AND session_id=? ORDER BY ts, id",
                              (agent_id, session_id)).fetchall()
        return [self._row(r) for r in rows]

    def stats(self, agent_id: str, days: int = 30) -> dict:
        since = time.time() - days * 86400
        with self._db() as db:
            row = db.execute(
                "SELECT COUNT(*) AS messages, COUNT(DISTINCT session_id) AS sessions, "
                "SUM(is_fallback) AS fallbacks, AVG(confidence) AS avg_conf, "
                "SUM(CASE WHEN review='pending' AND query IS NOT NULL AND query != '' THEN 1 ELSE 0 END) "
                "AS pending FROM logs WHERE agent_id=? AND ts>=?", (agent_id, since)).fetchone()
            top = db.execute(
                "SELECT intent_name, COUNT(*) AS n FROM logs WHERE agent_id=? AND ts>=? AND "
                "intent_name IS NOT NULL GROUP BY intent_name ORDER BY n DESC LIMIT 10",
                (agent_id, since)).fetchall()
        return {
            "messages": row["messages"] or 0,
            "sessions": row["sessions"] or 0,
            "fallbacks": row["fallbacks"] or 0,
            "avgConfidence": round(row["avg_conf"] or 0, 3),
            "pendingReview": row["pending"] or 0,
            "topIntents": [{"name": r["intent_name"], "count": r["n"]} for r in top],
        }

    def clear_logs(self, agent_id: str) -> None:
        with self._db() as db:
            db.execute("DELETE FROM logs WHERE agent_id=?", (agent_id,))

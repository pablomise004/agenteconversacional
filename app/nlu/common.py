"""Estructuras compartidas por los extractores de entidades."""

from dataclasses import dataclass
from typing import Any

# Prioridad al resolver solapamientos (menor = más prioritaria) a igualdad de longitud
_SOURCE_PRIORITY = {"dict": 0, "regex": 0, "sys": 1, "stem": 1, "fuzzy": 3}
_LOW_PRIORITY_SYS = {"@sys.number", "@sys.number-integer", "@sys.ordinal"}
# Entidades derivadas: no se usan para resaltar ni para sustituir en el texto
DERIVED_ENTITIES = {"@sys.date-time"}


@dataclass(slots=True)
class EntityMatch:
    entity: str  # "@sys.number", "@tamano"...
    value: Any  # valor normalizado (número, fecha ISO, valor de referencia...)
    start: int  # posición en el texto original
    end: int
    tstart: int  # índices de tokens [tstart, tend)
    tend: int
    text: str  # texto tal y como lo escribió el usuario
    source: str = "sys"  # sys | dict | stem | fuzzy | regex
    score: float = 1.0
    weak: bool = False  # candidato débil (p. ej. "una" como número 1)

    def overlaps(self, other: "EntityMatch") -> bool:
        return self.tstart < other.tend and other.tstart < self.tend

    def rank_key(self):
        prio = _SOURCE_PRIORITY.get(self.source, 2)
        if self.source == "sys" and self.entity in _LOW_PRIORITY_SYS:
            prio = 2
        return (-(self.tend - self.tstart), -(self.end - self.start), prio, -self.score,
                self.tstart)

    def to_dict(self) -> dict:
        d = {
            "entity": self.entity,
            "value": self.value,
            "text": self.text,
            "start": self.start,
            "end": self.end,
            "source": self.source,
            "score": round(self.score, 3),
        }
        if self.weak:
            d["weak"] = True
        return d


def resolve_overlaps(candidates: list[EntityMatch]) -> list[EntityMatch]:
    """Elige un conjunto de entidades sin solapamientos (las más largas primero)."""
    chosen: list[EntityMatch] = []
    for c in sorted(candidates, key=EntityMatch.rank_key):
        if c.weak or c.entity in DERIVED_ENTITIES:
            continue
        if any(c.overlaps(o) for o in chosen):
            continue
        chosen.append(c)
    chosen.sort(key=lambda c: c.tstart)
    return chosen

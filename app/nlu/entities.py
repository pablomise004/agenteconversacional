"""Reconocimiento de entidades personalizadas (las que define el usuario).

Tipos de entidad:
  - map:   valor de referencia + sinónimos ("grande" <- "familiar", "XL")
  - list:  lista simple de valores
  - regex: cada entrada es una expresión regular

La búsqueda es por secuencias de tokens: primero coincidencia exacta, luego
por raíz (plurales, género) y por último con la ortografía corregida.
"""

import re
from collections import Counter

from .common import EntityMatch
from .text import Token, Tokenizer


class EntityMatcher:
    def __init__(self, entities: list[dict], tokenizer: Tokenizer):
        self.tokenizer = tokenizer
        self.exact: dict[tuple, list[tuple[str, str]]] = {}
        self.stemmed: dict[tuple, list[tuple[str, str]]] = {}
        self.max_len = 1
        self.regexes: list[tuple[str, re.Pattern]] = []
        self.fuzzy: set[str] = set()
        self.vocab: Counter = Counter()
        self.names: set[str] = set()
        for ent in entities:
            name = "@" + ent["name"]
            self.names.add(name)
            kind = ent.get("kind", "map")
            if ent.get("fuzzy", True):
                self.fuzzy.add(name)
            for entry in ent.get("entries", []):
                value = str(entry.get("value", "")).strip()
                if not value:
                    continue
                if kind == "regex":
                    try:
                        self.regexes.append((name, re.compile(value, re.IGNORECASE)))
                    except re.error:
                        pass
                    continue
                synonyms = [value]
                if kind == "map":
                    synonyms += [str(s) for s in entry.get("synonyms", []) if str(s).strip()]
                for syn in synonyms:
                    self._add(name, value, syn)

    @staticmethod
    def skey(tok: Token, corrected: bool = False) -> str:
        """Clave tolerante a plurales/género: la raíz en palabras de 4+ letras."""
        if corrected and tok.corrected:
            norm, stem = tok.corrected, tok.extra.get("cstem", tok.corrected)
        else:
            norm, stem = tok.norm, tok.stem
        if tok.kind != "word" or len(norm) < 4:
            return norm
        return stem

    def _add(self, name: str, value: str, synonym: str) -> None:
        toks = [t for t in self.tokenizer.tokenize(synonym) if t.kind != "symbol"]
        if not toks:
            return
        key = tuple(t.norm for t in toks)
        skey = tuple(self.skey(t) for t in toks)
        for index, k in ((self.exact, key), (self.stemmed, skey)):
            hits = index.setdefault(k, [])
            if (name, value) not in hits:
                hits.append((name, value))
        self.max_len = max(self.max_len, len(key))
        self.vocab.update(t.norm for t in toks if t.kind == "word")

    def find(self, text: str, tokens: list[Token]) -> list[EntityMatch]:
        out: list[EntityMatch] = []
        seq = [i for i, t in enumerate(tokens) if t.kind != "symbol"]
        for a in range(len(seq)):
            seen: set[str] = set()
            for length in range(min(self.max_len, len(seq) - a), 0, -1):
                idx = seq[a:a + length]
                for hits, source, score in self._lookup(tokens, idx):
                    for entity, value in hits:
                        if entity in seen:
                            continue
                        seen.add(entity)
                        s, e = tokens[idx[0]].start, tokens[idx[-1]].end
                        out.append(EntityMatch(entity, value, s, e, idx[0], idx[-1] + 1,
                                               text[s:e], source, score))
        for entity, rx in self.regexes:
            for m in rx.finditer(text):
                if m.end() <= m.start():
                    continue
                ts = [k for k, t in enumerate(tokens) if t.end > m.start() and t.start < m.end()]
                if ts:
                    out.append(EntityMatch(entity, m.group(), m.start(), m.end(), ts[0],
                                           ts[-1] + 1, m.group(), "regex", 1.0))
        return out

    def _lookup(self, tokens: list[Token], idx: list[int]):
        """Devuelve las coincidencias encontradas para la secuencia de tokens idx."""
        found = []
        key = tuple(tokens[k].norm for k in idx)
        hits = self.exact.get(key)
        if hits:
            found.append((hits, "dict", 1.0))
        skey = tuple(self.skey(tokens[k]) for k in idx)
        hits = self.stemmed.get(skey)
        if hits:
            found.append((hits, "stem", 0.95))
        if any(tokens[k].corrected for k in idx):
            ckey = tuple(tokens[k].key for k in idx)
            hits = [h for h in self.exact.get(ckey, []) if h[0] in self.fuzzy]
            if not hits:
                cskey = tuple(self.skey(tokens[k], corrected=True) for k in idx)
                hits = [h for h in self.stemmed.get(cskey, []) if h[0] in self.fuzzy]
            if hits:
                found.append((hits, "fuzzy", 0.85))
        return found

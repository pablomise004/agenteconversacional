"""Normalización y tokenización del texto.

El tokenizador conserva la posición de cada token en el texto original para
poder resaltar entidades y anotaciones en la interfaz.
"""

import re
import unicodedata
from dataclasses import dataclass, field

from .languages import Language

_TOKEN_RE = re.compile(
    r"""
    (?P<url>(?:https?://|www\.)[^\s<>"']*[^\s<>"'.,;:!?)\]}])
   |(?P<email>[\w.+-]+@[\w-]+(?:\.[\w-]+)+)
   |(?P<time>\d{1,2}:\d{2}(?::\d{2})?(?!\d))
   |(?P<date>\d{4}-\d{1,2}-\d{1,2}(?!\d)|\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}(?!\d)|\d{1,2}/\d{1,2}(?![\d/]))
   |(?P<number>\d{1,3}(?:[.,]\d{3})+(?:[.,]\d+)?(?!\d)|\d+(?:[.,]\d+)?)
   |(?P<word>[^\W\d_]+(?:['’][^\W\d_]+)*)
   |(?P<symbol>[^\w\s])
    """,
    re.VERBOSE,
)

_ELONGATION_RE = re.compile(r"([a-z])\1{2,}")
_LAUGH_J_RE = re.compile(r"(?:j+[aeiou]+){2,}j*")
_LAUGH_H_RE = re.compile(r"(?:h+[aeiou]+){2,}h*")


def strip_accents(s: str) -> str:
    decomposed = unicodedata.normalize("NFD", s)
    return unicodedata.normalize(
        "NFC", "".join(c for c in decomposed if not unicodedata.combining(c))
    )


def normalize_text(s: str) -> str:
    """Minúsculas y sin tildes. Sirve para comparar textos de forma tolerante."""
    return strip_accents(s.casefold())


def normalize_word(s: str) -> str:
    w = normalize_text(s).replace("’", "'")
    w = _ELONGATION_RE.sub(r"\1", w)  # holaaaa -> hola
    if len(w) >= 4:
        if _LAUGH_J_RE.fullmatch(w):
            return "jaja"
        if _LAUGH_H_RE.fullmatch(w):
            return "haha"
    return w


@dataclass(slots=True)
class Token:
    text: str  # texto original
    start: int  # posición en el texto original
    end: int
    kind: str  # word | number | time | date | url | email | symbol
    norm: str  # forma normalizada
    stem: str = ""
    corrected: str | None = None  # corrección ortográfica propuesta
    expanded: bool = False  # procede de expandir una abreviatura ("xfa" -> "por favor")
    stop: bool = False  # palabra vacía
    extra: dict = field(default_factory=dict)

    @property
    def key(self) -> str:
        """Forma usada para comparar (la corregida si la hay)."""
        return self.corrected or self.norm

    @property
    def is_word(self) -> bool:
        return self.kind == "word"

    @property
    def is_symbol(self) -> bool:
        return self.kind == "symbol"

    def to_dict(self) -> dict:
        d = {
            "text": self.text,
            "start": self.start,
            "end": self.end,
            "kind": self.kind,
            "norm": self.norm,
            "stem": self.stem,
        }
        if self.corrected:
            d["corrected"] = self.corrected
        if self.expanded:
            d["expanded"] = True
        if self.stop:
            d["stop"] = True
        return d


class Tokenizer:
    def __init__(self, language: Language, custom_map: dict[str, str] | None = None):
        self.language = language
        self.stopwords = language.res.STOPWORDS
        mapping = dict(language.res.ABBREVIATIONS)
        for k, v in (custom_map or {}).items():
            k2 = normalize_word(str(k).strip())
            if k2:
                mapping[k2] = normalize_text(str(v).strip())
        self.mapping = mapping

    def stem(self, norm: str) -> str:
        return self.language.stem(norm)

    def tokenize(self, text: str) -> list[Token]:
        tokens: list[Token] = []
        for m in _TOKEN_RE.finditer(text):
            kind = m.lastgroup
            raw = m.group()
            start, end = m.span()
            if kind == "word":
                norm = normalize_word(raw)
                expansion = self.mapping.get(norm)
                if expansion is not None and expansion != norm:
                    parts = expansion.split()
                    if not parts:  # mapeado a "" -> se ignora la palabra
                        continue
                    for part in parts:
                        tokens.append(self._word(raw, start, end, part, expanded=True))
                    continue
                tokens.append(self._word(raw, start, end, norm))
            elif kind in ("url", "email"):
                tokens.append(Token(raw, start, end, kind, raw.lower(), raw.lower()))
            else:
                norm = normalize_text(raw)
                tokens.append(Token(raw, start, end, kind, norm, norm))
        return tokens

    def _word(self, raw: str, start: int, end: int, norm: str, expanded: bool = False) -> Token:
        return Token(
            raw, start, end, "word", norm, self.stem(norm),
            expanded=expanded, stop=norm in self.stopwords,
        )

    def apply_correction(self, tok: Token, word: str) -> None:
        """Anota una corrección ortográfica (se conserva la forma original)."""
        tok.corrected = word
        tok.extra["cstem"] = self.stem(word)

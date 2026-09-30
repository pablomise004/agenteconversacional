"""Registro de idiomas soportados.

Cada idioma aporta: palabras vacías, abreviaturas de chat, vocabulario para
números y fechas, y una función de stemming (reducción a la raíz).
"""

from functools import lru_cache
from types import SimpleNamespace

from . import lang_en, lang_es, stemmer_es

SUPPORTED_LANGUAGES = {"es": "Español", "en": "English"}


class Language:
    def __init__(self, code: str, res, stem_fn):
        self.code = code
        self.res = res
        self._stem = lru_cache(maxsize=50000)(stem_fn)

    def stem(self, word: str) -> str:
        return self._stem(word)

    def __repr__(self) -> str:
        return f"Language({self.code!r})"


def _snowball(name: str):
    import snowballstemmer

    stemmer = snowballstemmer.stemmer(name)
    return stemmer.stemWord


def _generic_resources():
    # Idioma sin recursos específicos: solo tokenización y stemming genérico
    empty = SimpleNamespace(**{k: getattr(lang_en, k) for k in dir(lang_en) if k.isupper()})
    for name in ("STOPWORDS", "ORDINALS_WEAK", "NUM_WEAK", "CANCEL_WORDS", "CANCEL_FILLER"):
        setattr(empty, name, frozenset())
    for name in ("ABBREVIATIONS", "NUM_SMALL", "NUM_TENS", "NUM_HUNDREDS", "NUM_THOUSAND",
                 "NUM_MILLION", "ORDINALS", "MONTHS", "WEEKDAYS", "DURATION_UNITS"):
        setattr(empty, name, {})
    empty.NUM_HUNDRED_WORD = None
    return empty


_SNOWBALL_NAMES = {"fr": "french", "it": "italian", "pt": "portuguese", "de": "german",
                   "ca": "catalan", "nl": "dutch"}


@lru_cache(maxsize=None)
def get_language(code: str) -> Language:
    code = (code or "es").lower()[:2]
    if code == "es":
        return Language("es", lang_es, stemmer_es.stem)
    if code == "en":
        return Language("en", lang_en, _snowball("english"))
    if code in _SNOWBALL_NAMES:
        try:
            return Language(code, _generic_resources(), _snowball(_SNOWBALL_NAMES[code]))
        except Exception:  # noqa: BLE001 - idioma no disponible en snowball
            pass
    return Language(code, _generic_resources(), lambda w: w)

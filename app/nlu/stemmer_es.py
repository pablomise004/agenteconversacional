"""Stemmer para español basado en el algoritmo Snowball.

Trabaja sobre texto ya normalizado (sin tildes). Así "cancelación" y
"cancelacion" producen la misma raíz, algo importante porque mucha gente
escribe sin tildes en un chat.
"""

from functools import lru_cache

_VOWELS = frozenset("aeiou")


def _regions(w: str) -> tuple[int, int, int]:
    n = len(w)

    def after_non_vowel(start: int) -> int:
        for i in range(start + 1, n):
            if w[i] not in _VOWELS and w[i - 1] in _VOWELS:
                return i + 1
        return n

    r1 = after_non_vowel(0)
    r2 = after_non_vowel(r1) if r1 < n else n

    rv = n
    if n >= 2:
        if w[1] not in _VOWELS:
            for i in range(2, n):
                if w[i] in _VOWELS:
                    rv = i + 1
                    break
        elif w[0] in _VOWELS:
            for i in range(2, n):
                if w[i] not in _VOWELS:
                    rv = i + 1
                    break
        else:
            rv = 3 if n >= 3 else n
    return r1, r2, rv


def _longest(w: str, suffixes) -> str | None:
    for s in suffixes:  # ordenados de más largo a más corto
        if w.endswith(s):
            return s
    return None


def _sorted(words: str) -> tuple[str, ...]:
    return tuple(sorted(set(words.split()), key=len, reverse=True))


_PRONOUNS = _sorted("me se sela selo selas selos la le lo las les los nos")
_PRONOUN_BEFORE = _sorted("iendo ando ar er ir")

_S1_R2_DELETE = _sorted(
    "anza anzas ico ica icos icas ismo ismos able ables ible ibles ista istas oso osa "
    "osos osas amiento amientos imiento imientos"
)
_S1_ADOR = _sorted("adora ador acion adoras adores aciones ante antes ancia ancias")
_S1_LOGIA = _sorted("logia logias")
_S1_UCION = _sorted("ucion uciones")
_S1_ENCIA = _sorted("encia encias")
_S1_IDAD = _sorted("idad idades")
_S1_IVA = _sorted("iva ivo ivas ivos")
_S1_ALL = _sorted(
    " ".join(_S1_R2_DELETE + _S1_ADOR + _S1_LOGIA + _S1_UCION + _S1_ENCIA + _S1_IDAD
             + _S1_IVA) + " amente mente"
)

_S2A = _sorted("ya ye yan yen yeron yendo yo yas yes yais yamos")
_S2B_GU = _sorted("en es eis emos")
_S2B_DELETE = _sorted(
    "arian arias aran aras ariais aria areis ariamos aremos ara are erian erias eran "
    "eras eriais eria ereis eriamos eremos era ere irian irias iran iras iriais iria "
    "ireis iriamos iremos ira ire aba ada ida ia ara iera ad ed id ase iese aste iste "
    "an aban ian aran ieran asen iesen aron ieron ado ido ando iendo io ios ar er ir as "
    "abas adas idas ias aras ieras ases ieses is ais abais iais arais ierais aseis "
    "ieseis asteis isteis ados idos amos abamos iamos imos aramos ieramos iesemos "
    "asemos"
)
_S2B_ALL = _sorted(" ".join(_S2B_GU + _S2B_DELETE))
_S3 = _sorted("os a o i e")


def _step0(w: str, rv: int) -> str:
    p = _longest(w, _PRONOUNS)
    if not p:
        return w
    base = w[: -len(p)]
    before = _longest(base, _PRONOUN_BEFORE)
    if before and len(base) - len(before) >= rv:
        return base
    if base.endswith("yendo") and len(base) - 5 >= rv and base[-6:-5] == "u":
        return base
    return w


def _step1(w: str, r1: int, r2: int) -> str | None:
    """Devuelve la palabra sin sufijo, o None si no se eliminó nada."""
    s = _longest(w, _S1_ALL)
    if not s:
        return None
    start = len(w) - len(s)

    def in_r2(pos: int) -> bool:
        return pos >= r2

    if s in _S1_R2_DELETE:
        return w[:start] if in_r2(start) else None
    if s in _S1_ADOR:
        if not in_r2(start):
            return None
        w = w[:start]
        if w.endswith("ic") and in_r2(len(w) - 2):
            w = w[:-2]
        return w
    if s in _S1_LOGIA:
        return w[:start] + "log" if in_r2(start) else None
    if s in _S1_UCION:
        return w[:start] + "u" if in_r2(start) else None
    if s in _S1_ENCIA:
        return w[:start] + "ente" if in_r2(start) else None
    if s == "amente":
        if start < r1:
            return None
        w = w[:start]
        if w.endswith("iv") and in_r2(len(w) - 2):
            w = w[:-2]
            if w.endswith("at") and in_r2(len(w) - 2):
                w = w[:-2]
        else:
            for pre in ("os", "ic", "ad"):
                if w.endswith(pre) and in_r2(len(w) - 2):
                    w = w[:-2]
                    break
        return w
    if s == "mente":
        if not in_r2(start):
            return None
        w = w[:start]
        for pre in ("ante", "able", "ible"):
            if w.endswith(pre) and in_r2(len(w) - len(pre)):
                w = w[: -len(pre)]
                break
        return w
    if s in _S1_IDAD:
        if not in_r2(start):
            return None
        w = w[:start]
        for pre in ("abil", "ic", "iv"):
            if w.endswith(pre) and in_r2(len(w) - len(pre)):
                w = w[: -len(pre)]
                break
        return w
    if s in _S1_IVA:
        if not in_r2(start):
            return None
        w = w[:start]
        if w.endswith("at") and in_r2(len(w) - 2):
            w = w[:-2]
        return w
    return None


def _step2a(w: str, rv: int) -> str | None:
    s = _longest(w[rv:], _S2A)
    if s and w[: -len(s)].endswith("u"):
        return w[: -len(s)]
    return None


def _step2b(w: str, rv: int) -> str:
    s = _longest(w[rv:], _S2B_ALL)
    if not s:
        return w
    base = w[: -len(s)]
    if s in _S2B_GU and base.endswith("gu"):
        base = base[:-1]
    return base


def _step3(w: str, rv: int) -> str:
    s = _longest(w[rv:], _S3)
    if not s:
        return w
    w = w[: -len(s)]
    if s == "e" and w.endswith("gu") and len(w) - 1 >= rv:
        w = w[:-1]
    return w


@lru_cache(maxsize=50000)
def stem(word: str) -> str:
    if len(word) < 3 or not word.isalpha():
        return word
    if len(word) > 5 and word.endswith("des"):
        # ciudades -> ciudad, verdes -> verd(e): Snowball los trata distinto al singular
        word = word[:-2]
    r1, r2, rv = _regions(word)
    w = _step0(word, rv)
    w1 = _step1(w, r1, r2)
    if w1 is not None:
        w = w1
    else:
        w2 = _step2a(w, rv)
        w = w2 if w2 is not None else _step2b(w, rv)
    w = _step3(w, rv)
    return w or word

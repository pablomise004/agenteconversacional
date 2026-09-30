"""Extracción de características para clasificar intenciones.

Cada frase se convierte en un conjunto de rasgos con peso:
  w:<raíz>        palabra (raíz)
  b:<a>_<b>       par de palabras consecutivas
  e:@entidad      entidad detectada/anotada (así "pizza de jamón" y
                  "pizza de atún" se parecen si ambos son @ingrediente)
  c:<n-grama>     trozos de 3-4 letras (tolera faltas de ortografía)
"""

from collections import defaultdict

from .text import Token

DEFAULT_FEATURE_CONFIG = {
    "inner_weight": 0.5,  # peso de las palabras dentro de una entidad
    "bigrams": True,
    "char_ngrams": (3, 4),
    "char_block": 0.45,  # peso relativo del bloque de n-gramas de letras
}


def entity_units(tokens: list[Token], spans: list[tuple[int, int, str]]):
    """Recorre los tokens devolviendo unidades ('w', token) o ('e', entidad, tokens)."""
    by_start = {s: (e, name) for s, e, name in spans}
    i = 0
    n = len(tokens)
    while i < n:
        if i in by_start:
            end, name = by_start[i]
            yield ("e", name, tokens[i:end])
            i = max(end, i + 1)
            continue
        tok = tokens[i]
        if tok.kind != "symbol":
            yield ("w", tok)
        i += 1


def word_form(tok: Token) -> tuple[str, str]:
    """(forma, raíz) de un token, usando la corrección ortográfica si existe."""
    if tok.corrected:
        return tok.corrected, tok.extra.get("cstem", tok.corrected)
    if tok.kind == "number":
        return "#num", "#num"
    return tok.norm, tok.stem


def featurize(tokens: list[Token], spans: list[tuple[int, int, str]],
              cfg: dict | None = None) -> tuple[dict, dict]:
    """Devuelve (rasgos de palabras/entidades, rasgos de letras)."""
    cfg = cfg or DEFAULT_FEATURE_CONFIG
    words: dict[str, float] = defaultdict(float)
    chars: dict[str, float] = defaultdict(float)
    seq: list[str] = []
    nmin, nmax = cfg["char_ngrams"] or (0, -1)
    inner_w = cfg["inner_weight"]

    def add_chars(form: str, weight: float) -> None:
        if not form or form.startswith("#"):
            return
        padded = f"<{form}>"
        for n in range(nmin, nmax + 1):
            for k in range(len(padded) - n + 1):
                chars["c:" + padded[k:k + n]] += weight

    for unit in entity_units(tokens, spans):
        if unit[0] == "e":
            name = unit[1]
            words["e:" + name] += 1.0
            seq.append(name)
            if inner_w > 0:
                for tok in unit[2]:
                    if tok.kind == "symbol":
                        continue
                    form, stem = word_form(tok)
                    words["w:" + stem] += inner_w
                    add_chars(form, inner_w)
        else:
            tok = unit[1]
            form, stem = word_form(tok)
            words["w:" + stem] += 1.0
            seq.append(stem)
            add_chars(form, 1.0)
    if cfg.get("bigrams") and len(seq) > 1:
        for a, b in zip(seq, seq[1:]):
            words[f"b:{a}_{b}"] += 1.0
    if any(t.norm in ("?", "¿") for t in tokens):
        words["p:?"] += 1.0
    return dict(words), dict(chars)

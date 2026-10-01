"""Corrección ortográfica contra el vocabulario del agente.

Usa la técnica de SymSpell (índice de borrados) para encontrar rápido las
palabras conocidas a distancia de edición 1 (o 2 en palabras largas).
"""

from collections import Counter


def _deletes(word: str) -> set[str]:
    return {word[:i] + word[i + 1:] for i in range(len(word))}


def edit_distance(a: str, b: str, limit: int = 3) -> int:
    """Distancia de Damerau-Levenshtein (variante OSA) con corte temprano."""
    if a == b:
        return 0
    la, lb = len(a), len(b)
    if abs(la - lb) > limit:
        return limit + 1
    prev2 = None
    prev = list(range(lb + 1))
    for i in range(1, la + 1):
        cur = [i] + [0] * lb
        row_min = cur[0]
        for j in range(1, lb + 1):
            cost = 0 if a[i - 1] == b[j - 1] else 1
            v = min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost)
            if prev2 is not None and i > 1 and j > 1 and a[i - 1] == b[j - 2] \
                    and a[i - 2] == b[j - 1]:
                v = min(v, prev2[j - 2] + 1)
            cur[j] = v
            row_min = min(row_min, v)
        if row_min > limit:
            return limit + 1
        prev2, prev = prev, cur
    return prev[lb]


class SpellCorrector:
    MIN_LEN = 4

    def __init__(self, vocab: Counter):
        self.vocab = vocab
        self.index: dict[str, list[str]] = {}
        for word in vocab:
            if len(word) < self.MIN_LEN - 1 or not word.isalpha():
                continue
            for variant in _deletes(word) | {word}:
                self.index.setdefault(variant, []).append(word)

    def max_distance(self, word: str) -> int:
        return 2 if len(word) >= 9 else 1

    def correct(self, word: str) -> str | None:
        """Devuelve la palabra conocida más parecida, o None si no hay que corregir."""
        if len(word) < self.MIN_LEN or word in self.vocab or not word.isalpha():
            return None
        max_d = self.max_distance(word)
        variants = {word} | _deletes(word)
        if max_d >= 2:
            for v in list(variants):
                variants |= _deletes(v)
        candidates = set()
        for v in variants:
            candidates.update(self.index.get(v, ()))
        best = None
        best_key = None
        for cand in candidates:
            if len(cand) < self.MIN_LEN:
                continue
            # la primera letra casi nunca se escribe mal, salvo la "h" muda (abla -> habla)
            if cand[0] != word[0] and cand != "h" + word and word != "h" + cand:
                continue
            d = edit_distance(word, cand, max_d)
            if d > max_d:
                continue
            key = (d, -self.vocab[cand], cand)
            if best_key is None or key < best_key:
                best, best_key = cand, key
        return best

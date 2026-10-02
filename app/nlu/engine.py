"""Motor de NLU: convierte la definición de un agente en un modelo entrenado y
analiza frases (tokens, entidades, intención y parámetros)."""

from __future__ import annotations

import math
import re
import time
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from datetime import datetime

from .classifier import IntentClassifier, NaiveBayes, Vectorizer
from .common import EntityMatch, resolve_overlaps
from .entities import EntityMatcher
from .features import DEFAULT_FEATURE_CONFIG, entity_units, featurize, word_form
from .languages import get_language
from .spelling import SpellCorrector
from .sys_entities import ANY_LIKE, SysEntityExtractor, canonical_sys
from .text import Token, Tokenizer, normalize_text

FALLBACK_PREFIX = "__fallback__:"


def now_in(tz_name: str | None) -> datetime:
    try:
        from zoneinfo import ZoneInfo

        return datetime.now(ZoneInfo(tz_name or "Europe/Madrid")).replace(tzinfo=None)
    except Exception:  # noqa: BLE001 - sin base de datos de zonas horarias
        return datetime.now()


def annotation_spans(tokens: list[Token], annotations: list[dict]) -> list[tuple[int, int, str, str]]:
    """Convierte anotaciones por caracteres en rangos de tokens (inicio, fin, entidad, param)."""
    spans = []
    for a in annotations or []:
        s, e = a.get("start", 0), a.get("end", 0)
        idx = [k for k, t in enumerate(tokens) if t.start >= s and t.end <= e]
        if not idx:
            idx = [k for k, t in enumerate(tokens) if t.start < e and t.end > s]
        if idx:
            spans.append((idx[0], idx[-1] + 1, a.get("entity", ""), a.get("param", "")))
    spans.sort()
    clean = []
    for sp in spans:  # sin solapamientos
        if not clean or sp[0] >= clean[-1][1]:
            clean.append(sp)
    return clean


def entity_kind(entity: str) -> str:
    return canonical_sys(entity) if entity.startswith("@sys.") else entity


@dataclass
class Template:
    intent_id: str
    phrase_id: str
    units: list  # ("w", raíz) | ("e", entidad, param) | ("any", entidad, param)
    has_any: bool


@dataclass
class Analysis:
    text: str
    tokens: list[Token]
    candidates: list[EntityMatch]
    entities: list[EntityMatch]
    ranking: list[dict]
    template: dict | None = None
    neighbors: list[dict] = field(default_factory=list)
    vector: dict = field(default_factory=dict)

    @property
    def best(self) -> dict | None:
        return self.ranking[0] if self.ranking else None


class NLUEngine:
    CONTEXT_PRIORITY = 0.5

    def __init__(self, agent: dict, feature_config: dict | None = None):
        self.agent = agent
        settings = agent.get("settings") or {}
        self.language = get_language(agent.get("language", "es"))
        self.timezone = agent.get("timezone") or "Europe/Madrid"
        self.tokenizer = Tokenizer(self.language, settings.get("normalization") or {})
        self.sys = SysEntityExtractor(self.language)
        self.entity_matcher = EntityMatcher(agent.get("entities") or [], self.tokenizer)
        self.custom_entities = {"@" + e["name"]: e for e in agent.get("entities") or []}
        self.spell_enabled = settings.get("spellCorrection", True)
        self.feature_config = feature_config or DEFAULT_FEATURE_CONFIG
        self.intents = {i["id"]: i for i in agent.get("intents") or []}
        self._train()

    # ================================================================ training
    def _train(self) -> None:
        vocab = Counter(self.entity_matcher.vocab)
        res = self.language.res
        for group in (res.STOPWORDS, res.NUM_SMALL, res.NUM_TENS, res.NUM_HUNDREDS,
                      res.NUM_THOUSAND, res.MONTHS, res.WEEKDAYS, res.DURATION_UNITS,
                      res.ORDINALS, res.CURRENCY_WORDS):
            vocab.update(list(group))
        vocab.update(normalize_text(w) for v in self.tokenizer.mapping.values() for w in v.split())
        vocab.update(["hoy", "manana", "ayer", "tarde", "noche", "mediodia", "media", "cuarto",
                      "today", "tomorrow", "tonight", "morning", "evening", "night"])

        self.examples: list[dict] = []
        self.templates: list[Template] = []
        # palabras de alrededor de cada parámetro en las anotaciones ("para [2] personas")
        self.left_context: dict[tuple[str, str], Counter] = defaultdict(Counter)
        self.right_context: dict[tuple[str, str], Counter] = defaultdict(Counter)
        self.param_count: Counter = Counter()
        self.any_patterns: dict[tuple[str, str], list] = defaultdict(list)
        self.stem_words: dict[str, Counter] = defaultdict(Counter)  # raíz -> palabras reales
        feats, labels = [], []
        n_tokens = n_annotations = 0
        t_start = time.perf_counter()
        for intent in self.intents.values():
            label = FALLBACK_PREFIX + intent["id"] if intent.get("isFallback") else intent["id"]
            params = {p["name"]: p for p in intent.get("parameters") or []}
            for ph in intent.get("trainingPhrases") or []:
                text = ph.get("text", "")
                if not text.strip():
                    continue
                tokens = self.tokenizer.tokenize(text)
                if not tokens:
                    continue
                for t in tokens:
                    if t.kind == "word":
                        vocab[t.norm] += 1
                        self.stem_words[t.stem][t.norm] += 1
                n_tokens += len(tokens)
                if ph.get("annotations") is None:
                    anns = self.auto_annotate(text, intent)["annotations"]
                else:
                    anns = ph["annotations"]
                spans = annotation_spans(tokens, anns)
                n_annotations += len(spans)
                spans4 = [(s, e, entity_kind(ent), p) for s, e, ent, p in spans]
                # el texto libre (@sys.any y parecidos) cuenta como palabras normales: al preguntar
                # nunca se detecta como entidad, y así «[la persiana] está rota» enseña «persiana»
                feats.append(featurize(tokens, [(s, e, ent) for s, e, ent, _ in spans4 if ent not in ANY_LIKE],
                                       self.feature_config))
                labels.append(label)
                self.examples.append({"intent": intent["id"], "phrase": ph.get("id"),
                                      "text": text, "fallback": bool(intent.get("isFallback")),
                                      "annotations": len(spans),
                                      "custom": sum(1 for s in spans4 if s[2] in self.custom_entities)})
                if not intent.get("isFallback"):
                    self._add_template(intent, ph, tokens, spans4, params)
        t_prepare = time.perf_counter() - t_start
        t0 = time.perf_counter()
        self.corrector = SpellCorrector(vocab) if self.spell_enabled else None
        self.vocab = vocab
        self.vectorizer = Vectorizer().fit(feats, labels)
        X = [self.vectorizer.transform(f) for f in feats]
        t_vectorize = time.perf_counter() - t0
        self.classifier = IntentClassifier().fit(X, labels)
        # Naive Bayes con las mismas frases y rasgos: solo para compararlo en «Por dentro»
        self.naive_bayes = NaiveBayes().fit([{**w, **c} for w, c in feats], labels)
        self.labels = set(labels)

        kinds = Counter(f.split(":", 1)[0] for f in self.vectorizer.idf)
        timing = self.classifier.timing
        self.report = {
            "intents": len({e["intent"] for e in self.examples if not e["fallback"]}),
            "intentsTotal": len(self.intents),
            "phrases": len(self.examples),
            "negativePhrases": sum(1 for e in self.examples if e["fallback"]),
            "tokens": n_tokens,
            "annotations": n_annotations,
            "vocabulary": len({w for c in self.stem_words.values() for w in c}),
            "stems": len(self.stem_words),
            "features": len(self.vectorizer.idf),
            "featureKinds": {"words": kinds.get("w", 0), "pairs": kinds.get("b", 0),
                             "entities": kinds.get("e", 0), "chars": kinds.get("c", 0),
                             "other": kinds.get("p", 0)},
            "templates": len(self.templates),
            "epochs": self.classifier.epochs,
            "learningRate": self.classifier.lr0,
            "history": self.classifier.history,
            "timing": {"prepare": t_prepare, "vectorize": t_vectorize,
                       "sgd": timing.get("sgd", 0.0), "index": timing.get("index", 0.0)},
            "example": self._example_phrase(),
        }

    def _example_phrase(self) -> str:
        """Una frase de entrenamiento representativa para las explicaciones: con entidades
        (mejor dos y alguna propia del agente) y de unas seis palabras."""
        best = None
        for e in self.examples:
            if e["fallback"]:
                continue
            words = len(e["text"].split())
            score = (e["annotations"] > 0, 4 <= words <= 9, min(e["annotations"], 2), e["custom"] > 0,
                     -abs(words - 6))
            if best is None or score > best[0]:
                best = (score, e["text"])
        return best[1] if best else ""

    def _add_template(self, intent, phrase, tokens, spans, params) -> None:
        units = []
        has_any = False
        labels = self._unit_labels(tokens, [(s, e, ent) for s, e, ent, _ in spans])
        for unit in entity_units(tokens, [(s, e, (ent, p)) for s, e, ent, p in spans]):
            if unit[0] == "e":
                ent, pname = unit[1]
                custom = self.custom_entities.get(ent)
                start = tokens.index(unit[2][0])
                end = start + len(unit[2])
                if ent in ANY_LIKE or (custom and custom.get("autoExpand")):
                    units.append(("any", ent, pname))
                    has_any = True
                    # anclas para capturar texto libre cuando no hay coincidencia exacta
                    self.any_patterns[(intent["id"], pname)].append(
                        (self._left_word(tokens, start) or "^", self._right_word(tokens, end) or "$",
                         len([t for t in unit[2] if t.kind != "symbol"])))
                else:
                    units.append(("e", ent, pname))
                # lo que suele ir a los lados («para [2] personas», «[dos] [pepperoni]»): ayuda a
                # repartir parámetros del mismo tipo y a saber si un «una» suelto es un número
                key = (intent["id"], pname)
                self.param_count[key] += 1
                left, right = self._neighbor(labels, start - 1, -1), self._neighbor(labels, end, 1)
                if left:
                    self.left_context[key][left] += 1
                if right:
                    self.right_context[key][right] += 1
            else:
                units.append(("w", word_form(unit[1])[1]))
        if units:
            self.templates.append(Template(intent["id"], phrase.get("id"), units, has_any))

    @staticmethod
    def _unit_labels(tokens: list[Token], spans) -> list:
        """Etiqueta de cada token para el contexto de los parámetros: la entidad que lo
        cubre («@pizza») o la raíz de la palabra (así «noche» y «noches» cuentan igual)."""
        labels = [word_form(t)[1] if t.kind != "symbol" else None for t in tokens]
        for s, e, ent in spans:
            for k in range(s, min(e, len(labels))):
                labels[k] = entity_kind(ent)
        return labels

    @staticmethod
    def _neighbor(labels: list, k: int, step: int):
        while 0 <= k < len(labels):
            if labels[k] is not None:
                return labels[k]
            k += step
        return None

    @staticmethod
    def _left_word(tokens: list[Token], start: int) -> str | None:
        k = start - 1
        while k >= 0 and tokens[k].kind == "symbol":
            k -= 1
        return tokens[k].key if k >= 0 and tokens[k].kind == "word" else None

    @staticmethod
    def _right_word(tokens: list[Token], end: int) -> str | None:
        k = end
        while k < len(tokens) and tokens[k].kind == "symbol":
            k += 1
        return tokens[k].key if k < len(tokens) and tokens[k].kind == "word" else None

    # =============================================================== analysis
    def now(self) -> datetime:
        return now_in(self.timezone)

    def tokenize(self, text: str) -> list[Token]:
        tokens = self.tokenizer.tokenize(text)
        if self.corrector:
            for t in tokens:
                if t.kind == "word" and not t.expanded and t.norm not in self.vocab:
                    c = self.corrector.correct(t.norm)
                    if c:
                        self.tokenizer.apply_correction(t, c)
        return tokens

    def find_entities(self, text: str, tokens: list[Token], now: datetime | None = None):
        cands = self.sys.extract(text, tokens, now or self.now())
        cands += self.entity_matcher.find(text, tokens)
        return cands, resolve_overlaps(cands)

    def eligible(self, active_contexts) -> set[str]:
        """Intenciones que pueden activarse con los contextos activos."""
        active = {c.lower() for c in (active_contexts or [])}
        out = set()
        for iid, intent in self.intents.items():
            needed = {c.lower() for c in intent.get("inputContexts") or []}
            if needed <= active:
                out.add(FALLBACK_PREFIX + iid if intent.get("isFallback") else iid)
        return out

    def analyze(self, text: str, active_contexts=None, now: datetime | None = None,
                neighbors: int = 0) -> Analysis:
        tokens = self.tokenize(text)
        cands, chosen = self.find_entities(text, tokens, now)
        spans = [(c.tstart, c.tend, c.entity) for c in chosen]
        x = self.vectorizer.transform(featurize(tokens, spans, self.feature_config))
        eligible = self.eligible(active_contexts)
        active = {c.lower() for c in (active_contexts or [])}
        ranking = self.classifier.predict(x, eligible & self.labels) if x else []

        templates = self._match_templates(tokens, chosen, text, eligible)
        fb_prob = max((r["prob"] for r in ranking if r["intent"].startswith(FALLBACK_PREFIX)), default=0.0)
        results = []
        seen = set()
        for r in ranking:
            iid = r["intent"]
            is_fb = iid.startswith(FALLBACK_PREFIX)
            real_id = iid[len(FALLBACK_PREFIX):] if is_fb else iid
            intent = self.intents.get(real_id)
            if not intent:
                continue
            seen.add(real_id)
            conf = self.confidence(r["prob"], r["sim"])
            match = "ml"
            # una plantilla con comodín («[X] hace un ruido raro») no se impone a los ejemplos
            # negativos: si el modelo ve más probable el fallback («mi coche hace un ruido raro»),
            # decide el modelo, como en Dialogflow
            if real_id in templates and not (templates[real_id]["wild"] and fb_prob > r["prob"]):
                conf, match = 1.0, "exact"
            contextual = bool(intent.get("inputContexts"))
            if contextual:
                conf = min(1.0, conf * 1.15 + 0.05)  # prioridad a las intenciones de contexto
            results.append({"id": real_id, "name": intent.get("name", ""), "confidence": conf,
                            "prob": r["prob"], "lr": r["lr"], "sim": r["sim"], "match": match,
                            "isFallback": is_fb, "contextual": contextual})
        for real_id in templates:
            if real_id not in seen:
                intent = self.intents[real_id]
                results.append({"id": real_id, "name": intent.get("name", ""), "confidence": 1.0,
                                "prob": 1.0, "sim": 1.0, "match": "exact", "isFallback": False,
                                "contextual": bool(intent.get("inputContexts"))})
        # Como en Dialogflow, una intención que esperaba un contexto activo tiene
        # prioridad si su confianza es razonable ("nada más" tras "¿algo de beber?")
        # La intención se elige por probabilidad (más precisa); la confianza decide
        # después si se acepta o salta el fallback.
        results.sort(key=lambda r: (r["contextual"] and r["confidence"] >= self.CONTEXT_PRIORITY,
                                    r["match"] == "exact", r["prob"]),
                     reverse=True)
        template = None
        if results and results[0]["id"] in templates:
            template = templates[results[0]["id"]]

        nb = []
        if neighbors and x:
            for j, s in self.classifier.neighbors(x, neighbors):
                ex = self.examples[j]
                intent = self.intents.get(ex["intent"], {})
                nb.append({"intentId": ex["intent"], "intentName": intent.get("name", ""),
                           "phraseId": ex["phrase"], "text": ex["text"], "similarity": round(s, 3)})
        return Analysis(text, tokens, cands, chosen, results, template, nb, x)

    @staticmethod
    def confidence(prob: float, sim: float) -> float:
        """Confianza final: probabilidad del modelo moderada por el parecido real.

        Con pocas intenciones la probabilidad sola engaña (una frase fuera de tema
        puede sacar 0.9 si solo hay dos intenciones); el parecido lo corrige.
        Calibrado con tests/casos_pizzeria.py para usarse con umbral 0.3.
        """
        closeness = min(1.0, max(sim, 0.0) / 0.65)
        return math.sqrt(max(prob, 0.0)) * closeness ** 2

    # =============================================================== templates
    def _query_units(self, tokens: list[Token], chosen: list[EntityMatch]):
        units = []
        by_start = {c.tstart: c for c in chosen}
        i = 0
        while i < len(tokens):
            c = by_start.get(i)
            if c:
                units.append(("e", c.entity, c))
                i = c.tend
                continue
            t = tokens[i]
            if t.kind != "symbol":
                units.append(("w", word_form(t)[1], t))
            i += 1
        return units

    def _match_templates(self, tokens, chosen, text, eligible) -> dict[str, dict]:
        """Intenciones con alguna frase que coincide exactamente -> {intent_id: coincidencia}."""
        q = self._query_units(tokens, chosen)
        found: dict[str, dict] = {}
        if not q:
            return found
        for tpl in self.templates:
            if tpl.intent_id not in eligible:
                continue
            prev = found.get(tpl.intent_id)
            if prev and (not prev["wild"] or tpl.has_any):  # mejor una frase igual que un comodín
                continue
            if not tpl.has_any and len(tpl.units) != len(q):
                continue
            binds = self._match(tpl.units, q)
            if binds is not None:
                found[tpl.intent_id] = {"intent": tpl.intent_id, "phrase": tpl.phrase_id, "wild": tpl.has_any,
                                        "bindings": self._bindings_to_values(binds, text)}
        return found

    def _match(self, tpl, q):
        n, m = len(tpl), len(q)

        def rec(i, j, binds):
            if i == n:
                return binds if j == m else None
            t = tpl[i]
            if t[0] == "w":
                if j < m and q[j][0] == "w" and q[j][1] == t[1]:
                    return rec(i + 1, j + 1, binds)
                return None
            if t[0] == "e":
                if j < m and q[j][0] == "e" and entity_kind(q[j][1]) == t[1]:
                    return rec(i + 1, j + 1, binds + [(t[2], t[1], [q[j]])])
                return None
            for length in range(1, min(8, m - j) + 1):  # comodín (@sys.any)
                r = rec(i + 1, j + length, binds + [(t[2], t[1], q[j:j + length])])
                if r is not None:
                    return r
            return None

        return rec(0, 0, [])

    @staticmethod
    def _bindings_to_values(binds, text):
        out = {}
        for pname, entity, units in binds:
            if len(units) == 1 and units[0][0] == "e" and entity not in ANY_LIKE:
                c = units[0][2]
                out.setdefault(pname, []).append((c.value, c.text, c.start, c.end))
            else:
                first, last = units[0][2], units[-1][2]
                s, e = first.start, last.end
                out.setdefault(pname, []).append((text[s:e], text[s:e], s, e))
        return out

    # ============================================================== parameters
    def pool(self, entity: str, analysis: Analysis) -> list[EntityMatch]:
        """Candidatos de un tipo de entidad, sin los que quedan dentro de otra entidad."""
        kind = entity_kind(entity)
        want = "@sys.number" if kind == "@sys.number-integer" else kind
        chosen = analysis.entities
        out = [c for c in chosen if c.entity == want]
        for c in analysis.candidates:
            if c.entity == want and c not in out and not any(c.overlaps(o) for o in chosen):
                out.append(c)
        if kind == "@sys.date-time":
            out += [c for c in analysis.candidates if c.entity == "@sys.date-time"]
            out.sort(key=lambda c: c.tstart - c.tend)
        if kind == "@sys.number-integer":
            out = [c for c in out if isinstance(c.value, int)]
        out.sort(key=lambda c: (c.weak, c.tstart))
        return out

    def extract_parameters(self, intent: dict, analysis: Analysis) -> tuple[dict, dict]:
        """Devuelve (valores, textos originales) de los parámetros de la intención."""
        values: dict = {}
        originals: dict = {}
        params = intent.get("parameters") or []
        tpl = analysis.template if analysis.template and analysis.template["intent"] == intent["id"] else None
        if tpl:
            for p in params:
                bound = tpl["bindings"].get(p["name"])
                if bound and entity_kind(p.get("entity", "")) in ANY_LIKE:
                    bound = [self._trim_bound(intent, p, analysis, b) for b in bound]
                if bound:
                    vals = [b[0] for b in bound]
                    values[p["name"]] = vals if p.get("isList") else vals[0]
                    originals[p["name"]] = [b[1] for b in bound] if p.get("isList") else bound[0][1]

        used: set[int] = set()
        pending = [p for p in params if p["name"] not in values]
        # parámetros del mismo tipo: primero los que tienen pista por lo que llevan a los lados
        by_kind = defaultdict(list)
        for p in pending:
            by_kind[entity_kind(p.get("entity", ""))].append(p)
        labels = self._unit_labels(analysis.tokens, [(c.tstart, c.tend, c.entity) for c in analysis.entities])
        for kind, plist in by_kind.items():
            if kind in ANY_LIKE:
                for p in plist:
                    got = self._any_by_context(intent, p, analysis)
                    if got:
                        values[p["name"]], originals[p["name"]] = got
                continue
            pool = self.pool(kind, analysis)
            if not pool:
                continue
            # «para 3 noches para 2 personas»: lo a menudo que cada parámetro llevaba eso
            # delante y detrás en las frases de entrenamiento
            sides = {id(c): (self._neighbor(labels, c.tstart - 1, -1), self._neighbor(labels, c.tend, 1))
                     for c in pool}
            score = lambda c, p: self._side_score(intent["id"], p["name"], *sides[id(c)])  # noqa: E731
            # un «una» suelto solo es un número si el parámetro solía llevar detrás lo mismo:
            # «una noche» rellena las noches, pero «una habitación» no
            fits = lambda c, p: not c.weak or self._side_score(intent["id"], p["name"], None, sides[id(c)][1]) > 0  # noqa: E731
            assigned: dict[str, list[EntityMatch]] = defaultdict(list)
            if len(plist) > 1:
                for c in pool:
                    scores = [(score(c, p) if fits(c, p) else 0, -k, p) for k, p in enumerate(plist)]
                    best = max(scores, key=lambda s: (s[0], s[1]))
                    if best[0] > 0 and (best[2].get("isList") or not assigned[best[2]["name"]]):
                        assigned[best[2]["name"]].append(c)
                        used.add(id(c))
            for p in plist:
                if assigned[p["name"]]:
                    continue
                free = [c for c in pool if id(c) not in used and fits(c, p)]
                if not free:
                    continue
                take = free if p.get("isList") else free[:1]
                assigned[p["name"]] = take
                used.update(id(c) for c in take)
            for p in plist:
                got = assigned.get(p["name"])
                if got:
                    if p.get("isList"):
                        values[p["name"]] = [c.value for c in got]
                        originals[p["name"]] = [c.text for c in got]
                    else:
                        values[p["name"]] = got[0].value
                        originals[p["name"]] = got[0].text
        return values, originals

    def _side_score(self, intent_id: str, pname: str, left: str | None, right: str | None) -> float:
        """Frecuencia con la que el parámetro aparecía entre esas palabras (0 = nunca)."""
        key = (intent_id, pname)
        total = self.param_count.get(key, 0)
        if not total:
            return 0.0
        hits = (self.left_context[key].get(left, 0) if left else 0) + \
               (self.right_context[key].get(right, 0) if right else 0)
        return hits / total

    def _trim_bound(self, intent, param, analysis, bound):
        """Recorta el texto libre que ha cazado una plantilla: sin muletillas delante ni
        otro dato de la intención detrás (el comodín se lo come todo)."""
        _value, _orig, s, e = bound
        toks = analysis.tokens
        idx = [k for k, t in enumerate(toks) if t.start >= s and t.end <= e]
        if not idx:
            return bound
        first, end = idx[0], idx[-1] + 1
        if entity_kind(param.get("entity", "")) == "@sys.any":
            first = self._skip_fillers(toks, first, end)
        end = self._free_text_end(intent, param, analysis, first, end)
        if (first, end) == (idx[0], idx[-1] + 1):
            return bound
        s, e = toks[first].start, toks[end - 1].end
        text = analysis.text[s:e].strip(" .,;:!?¿¡")
        return (text, text, s, e) if text else bound

    def _skip_fillers(self, toks, start: int, end: int) -> int:
        """Primer token tras las muletillas del principio («oye, la tele» -> «la tele»)."""
        fillers = getattr(self.language.res, "LEADING_FILLERS", ())
        k = start
        while k < end and (toks[k].kind == "symbol" or toks[k].norm in fillers):
            k += 1
        return k if k < end else start

    @staticmethod
    def _other_params_at(intent, param, analysis) -> set[int]:
        """Tokens donde empieza una entidad de otro parámetro de la intención."""
        others = {entity_kind(p.get("entity", "")) for p in intent.get("parameters") or []
                  if p["name"] != param["name"]}
        if "@sys.number-integer" in others:
            others.add("@sys.number")
        return {c.tstart for c in analysis.entities if c.entity in others}

    def _free_text_end(self, intent, param, analysis, start: int, end: int) -> int:
        """Dónde acaba un texto libre que llega hasta el final: antes de otro dato de la
        intención («no va la tele de la 215»: el número es la habitación, el texto «la tele»)
        y sin palabras vacías colgando («de la»)."""
        taken = self._other_params_at(intent, param, analysis)
        cut = next((k for k in range(start + 1, end) if k in taken), None)
        if cut is None:
            return end
        toks = analysis.tokens
        while cut - 1 > start and (toks[cut - 1].kind == "symbol" or toks[cut - 1].stop):
            cut -= 1
        return cut

    def _any_by_context(self, intent, param, analysis):
        """@sys.any sin plantilla exacta: captura el texto entre las palabras que lo
        rodeaban en las frases de entrenamiento ("me llamo [X]", "de [X] a ...")."""
        patterns = self.any_patterns.get((intent["id"], param["name"]))
        if not patterns:
            return None
        toks = analysis.tokens
        words = [k for k, t in enumerate(toks) if t.kind != "symbol"]
        any_text = entity_kind(param.get("entity", "")) == "@sys.any"
        taken = self._other_params_at(intent, param, analysis)
        for left, right, length in sorted(patterns, key=lambda p: (p[0] == "^", p[1] == "$")):
            if left == "^":
                starts = [0]
            else:
                starts = [i + 1 for i, k in enumerate(words) if toks[k].key == left]
            for a in starts:
                if right == "$":
                    if a >= len(words):
                        continue
                    end = self._free_text_end(intent, param, analysis, words[a], len(toks))
                    b = sum(1 for k in words if k < end)
                else:
                    b = next((i for i in range(a + 1, len(words)) if toks[words[i]].key == right), None)
                    if b is None:
                        continue
                if any_text and b > a:
                    a = words.index(self._skip_fillers(toks, words[a], words[b - 1] + 1))
                # el hueco no puede tragarse otro dato: en «estoy en la 304, no va la tele» el
                # ancla «[X] no» daría «estoy en la 304»
                if any(words[i] in taken for i in range(a, b)):
                    continue
                if not 0 < b - a <= max(length + 3, 6):
                    continue
                s, e = toks[words[a]].start, toks[words[b - 1]].end
                value = analysis.text[s:e].strip(" .,;:!?¿¡")
                if value:
                    return value, value
        return None

    def fill_slot(self, param: dict, analysis: Analysis):
        """Extrae el valor de UN parámetro concreto (cuando el bot lo ha preguntado)."""
        kind = entity_kind(param.get("entity", ""))
        if kind in ANY_LIKE:
            value = analysis.text.strip().strip(".!?¡¿ ")
            return (value, value) if value else None
        pool = self.pool(kind, analysis)
        if not pool:
            return None
        if param.get("isList"):
            return [c.value for c in pool], [c.text for c in pool]
        return pool[0].value, pool[0].text

    # ============================================================ annotations
    def auto_annotate(self, text: str, intent: dict | None = None) -> dict:
        """Propone anotaciones de entidades para una frase de entrenamiento."""
        tokens = self.tokenizer.tokenize(text)
        _, chosen = self.find_entities(text, tokens)
        params = (intent or {}).get("parameters") or []
        by_entity = defaultdict(list)
        for p in params:
            by_entity[entity_kind(p.get("entity", ""))].append(p["name"])
        used = Counter()
        anns = []
        for c in chosen:
            names = by_entity.get(c.entity) or []
            if names:
                name = names[min(used[c.entity], len(names) - 1)]
                used[c.entity] += 1
            else:
                name = default_param_name(c.entity)
            anns.append({"start": c.start, "end": c.end, "entity": c.entity, "param": name})
        return {"text": text, "annotations": anns}


def default_param_name(entity: str) -> str:
    name = entity.lstrip("@")
    if name.startswith("sys."):
        name = name[4:]
    return re.sub(r"[^\w]+", "_", name).strip("_") or "param"

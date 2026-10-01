"""Entidades de sistema: números, fechas, horas, duraciones, dinero, etc.

Funcionan sin entrenamiento, como las @sys.* de Dialogflow. Los analizadores
trabajan sobre los tokens normalizados, así que toleran mayúsculas, tildes
omitidas y pequeñas faltas de ortografía (corregidas antes).
"""

import calendar
import re
from datetime import date, datetime, timedelta

from .common import EntityMatch
from .languages import Language
from .text import Token

SYSTEM_ENTITIES = {
    "@sys.number": "Número: 12, doce, 3,5, dos mil",
    "@sys.number-integer": "Número entero",
    "@sys.ordinal": "Ordinal: primero, 2º, tercera",
    "@sys.date": "Fecha: hoy, mañana, el lunes, 15 de marzo, 15/03/2027",
    "@sys.time": "Hora: a las 5, 17:30, las cinco y media de la tarde",
    "@sys.date-time": "Fecha y hora juntas: mañana a las 9",
    "@sys.duration": "Duración: 2 horas, media hora, 3 días",
    "@sys.percentage": "Porcentaje: 20%, 15 por ciento",
    "@sys.unit-currency": "Dinero: 20 €, 15 euros, $30",
    "@sys.email": "Correo electrónico",
    "@sys.phone-number": "Número de teléfono",
    "@sys.url": "Dirección web",
    "@sys.any": "Cualquier texto (se aprende de la posición en las frases de entrenamiento)",
    "@sys.given-name": "Nombre de pila (se aprende de la posición, como @sys.any)",
    "@sys.last-name": "Apellido (se aprende de la posición, como @sys.any)",
    "@sys.person": "Nombre de persona (se aprende de la posición, como @sys.any)",
    "@sys.geo-city": "Ciudad (se aprende de la posición, como @sys.any)",
    "@sys.address": "Dirección postal (se aprende de la posición, como @sys.any)",
}

# Nombres alternativos (por ejemplo, al importar agentes de Dialogflow)
SYS_ALIASES = {
    "@sys.cardinal": "@sys.number",
    "@sys.number-sequence": "@sys.number",
    "@sys.flight-number": "@sys.any",
    "@sys.zip-code": "@sys.any",
    "@sys.geo-country": "@sys.any",
    "@sys.geo-state": "@sys.any",
    "@sys.street-address": "@sys.address",
    "@sys.location": "@sys.any",
    "@sys.color": "@sys.any",
    "@sys.language": "@sys.any",
    "@sys.music-artist": "@sys.any",
    "@sys.music-genre": "@sys.any",
    "@sys.date-period": "@sys.date",
    "@sys.time-period": "@sys.time",
    "@sys.age": "@sys.number",
    "@sys.temperature": "@sys.number",
    "@sys.unit-length": "@sys.number",
    "@sys.unit-weight": "@sys.number",
}

# Entidades que no se detectan solas sino por su posición en las plantillas
ANY_LIKE = {"@sys.any", "@sys.given-name", "@sys.last-name", "@sys.person",
            "@sys.geo-city", "@sys.address"}


def canonical_sys(entity: str) -> str:
    entity = SYS_ALIASES.get(entity, entity)
    if entity.startswith("@sys.") and entity not in SYSTEM_ENTITIES:
        return "@sys.any"
    return entity


_PHONE_RE = re.compile(r"(?<![\w+/.,:])(?:\+|00)?\(?\d[\d\s().-]{5,}\d(?![\w/:])")
_THOUSANDS_RE = re.compile(r"\d{1,3}(?:[.,]\d{3})+")


def parse_digits(s: str) -> float | int | None:
    """Convierte '1.000', '3,5', '1,500.25' o '2.5' en número."""
    s = s.strip()
    if not s or not s[0].isdigit():
        return None
    if "." in s and "," in s:
        dec = "." if s.rfind(".") > s.rfind(",") else ","
        thousands = "," if dec == "." else "."
        s = s.replace(thousands, "").replace(dec, ".")
    elif "." in s or "," in s:
        sep = "." if "." in s else ","
        parts = s.split(sep)
        if len(parts) > 2 or (len(parts[1]) == 3 and len(parts[0]) <= 3 and parts[0] != "0"):
            s = s.replace(sep, "")  # separador de miles
        else:
            s = s.replace(sep, ".")
    try:
        v = float(s)
    except ValueError:
        return None
    return int(v) if v.is_integer() and "." not in s else v


def _num(v):
    if isinstance(v, float) and v.is_integer():
        return int(v)
    return v


def _add_months(d: date, months: int) -> date:
    m = d.month - 1 + months
    y = d.year + m // 12
    m = m % 12 + 1
    return date(y, m, min(d.day, calendar.monthrange(y, m)[1]))


def _safe_date(y: int, m: int, d: int) -> date | None:
    try:
        return date(y, m, d)
    except ValueError:
        return None


def _upcoming(today: date, month: int, day: int) -> date | None:
    d = _safe_date(today.year, month, day)
    if d is None:
        d = _safe_date(today.year + 1, month, day)  # 29 de febrero
        return d
    if d < today:
        d = _safe_date(today.year + 1, month, day) or d
    return d


class _Ctx:
    """Acceso cómodo a los tokens durante el análisis."""

    def __init__(self, tokens: list[Token], res, today: date, num_at: dict):
        self.t = tokens
        self.n = len(tokens)
        self.res = res
        self.today = today
        self.num_at = num_at  # índice -> (fin, valor, débil)

    def w(self, i: int) -> str | None:
        if 0 <= i < self.n:
            tok = self.t[i]
            return tok.key if tok.kind == "word" else tok.norm
        return None

    def seq(self, i: int, *words: str) -> int | None:
        for k, word in enumerate(words):
            if self.w(i + k) != word:
                return None
        return i + len(words)

    def any_seq(self, i: int, options) -> int | None:
        best = None
        for words in options:
            j = self.seq(i, *words)
            if j is not None and (best is None or j > best):
                best = j
        return best

    def int_at(self, i: int, lo: int, hi: int, allow_weak: bool = False):
        r = self.num_at.get(i)
        if not r:
            return None
        j, v, weak = r
        if weak and not allow_weak:
            return None
        if isinstance(v, float) or not lo <= v <= hi:
            return None
        return j, v

    def adjacent(self, i: int) -> bool:
        """True si el token i va pegado al anterior (sin espacio)."""
        return 0 < i < self.n and self.t[i].start == self.t[i - 1].end


class SysEntityExtractor:
    def __init__(self, language: Language):
        self.lang = language
        self.res = language.res
        self.code = language.code
        R = self.res
        self._time_follow = (set(R.STOPWORDS) | set(R.WEEKDAYS) | set(R.MONTHS) | {
            "en", "punto", "hoy", "manana", "pasado", "ayer", "gracias", "vale", "ok",
            "aprox", "aproximadamente", "mas", "menos", "o", "u", "exactas", "clavadas",
            "today", "tomorrow", "please", "thanks", "ok",
        })

    # ------------------------------------------------------------------ API
    def extract(self, text: str, tokens: list[Token], now: datetime) -> list[EntityMatch]:
        num_at = {}
        for i in range(len(tokens)):
            r = self._number_at(tokens, i)
            if r:
                num_at[i] = r
        c = _Ctx(tokens, self.res, now.date(), num_at)
        out: list[EntityMatch] = []

        def add(entity, i, j, value, weak=False):
            out.append(EntityMatch(
                entity, value, tokens[i].start, tokens[j - 1].end, i, j,
                text[tokens[i].start:tokens[j - 1].end], "sys", 1.0, weak,
            ))

        # Números (solo los maximales)
        i = 0
        while i < c.n:
            if i in num_at:
                j, v, weak = num_at[i]
                add("@sys.number", i, j, _num(v), weak)
                i = j
            else:
                i += 1

        for i in range(c.n):
            r = self._ordinal_at(c, i)
            if r:
                add("@sys.ordinal", i, r[0], r[1], r[2])
            r = self._percentage_at(c, i)
            if r:
                add("@sys.percentage", i, r[0], r[1])
            r = self._currency_at(c, i)
            if r:
                add("@sys.unit-currency", r[0], r[1], r[2])
            r = self._duration_at(c, i)
            if r:
                add("@sys.duration", i, r[0], r[1])

        dates = []
        times = []
        for i in range(c.n):
            r = self._date_at(c, i)
            if r:
                dates.append((i, r[0], r[1]))
            r = self._time_at(c, i)
            if r:
                times.append((i, r[0], r[1]))
        for i, j, d in dates:
            add("@sys.date", i, j, d.isoformat())
        for i, j, (h, m) in times:
            add("@sys.time", i, j, f"{h:02d}:{m:02d}:00")
        for i, j, value in self._combine_date_time(c, dates, times):
            add("@sys.date-time", i, j, value)

        for i, tok in enumerate(tokens):
            if tok.kind == "email":
                add("@sys.email", i, i + 1, tok.text)
            elif tok.kind == "url":
                add("@sys.url", i, i + 1, tok.text)

        for m in _PHONE_RE.finditer(text):
            raw = m.group().strip()
            digits = re.sub(r"\D", "", raw)
            if not 7 <= len(digits) <= 15 or _THOUSANDS_RE.fullmatch(raw):
                continue
            ts = [k for k, t in enumerate(tokens) if t.start >= m.start() and t.end <= m.end()]
            if ts and not any(tokens[k].kind in ("date", "time") for k in ts):
                value = ("+" if raw.startswith("+") else "") + digits
                add("@sys.phone-number", ts[0], ts[-1] + 1, value)
        return out

    # -------------------------------------------------------------- números
    def _number_at(self, tokens: list[Token], i: int):
        tok = tokens[i]
        R = self.res
        if tok.kind == "number":
            v = parse_digits(tok.norm)
            if v is None:
                return None
            j = i + 1
            if j < len(tokens):
                w = tokens[j].key
                if w in R.NUM_THOUSAND:
                    return j + 1, _num(v * R.NUM_THOUSAND[w]), False
                if w in R.NUM_MILLION:
                    return j + 1, _num(v * R.NUM_MILLION[w]), False
            return j, v, False
        if tok.kind != "word":
            return None
        return self._number_words(tokens, i)

    def _number_words(self, tokens: list[Token], i: int):
        R = self.res
        n = len(tokens)
        total = current = 0
        last = None
        weak_only = True
        consumed = 0
        j = i

        def unit_value(k):
            if k < n and tokens[k].kind == "word":
                v = R.NUM_SMALL.get(tokens[k].key)
                if v is not None and 1 <= v <= 9:
                    return v
            return None

        while j < n:
            tok = tokens[j]
            w = tok.key
            if tok.kind == "symbol" and tok.text == "-" and last == "T" and unit_value(j + 1):
                last = "J"
                j += 1
                continue
            if tok.kind != "word":
                break
            if w in R.NUM_SMALL:
                v = R.NUM_SMALL[w]
                if last == "J":
                    if not 1 <= v <= 9:
                        break
                elif last not in (None, "H", "M", "MM"):
                    break
                if v == 0 and last is not None:
                    break
                if w in R.NUM_WEAK and last is not None and self.code != "es":
                    break
                current += v
                last = "U"
                if w not in R.NUM_WEAK:
                    weak_only = False
            elif w in R.NUM_TENS:
                if last not in (None, "H", "M", "MM"):
                    break
                current += R.NUM_TENS[w]
                last = "T"
                weak_only = False
            elif w in R.NUM_HUNDREDS:
                if last not in (None, "M", "MM"):
                    break
                current += R.NUM_HUNDREDS[w]
                last = "H"
                weak_only = False
            elif R.NUM_HUNDRED_WORD and w == R.NUM_HUNDRED_WORD:
                if last not in (None, "U") or current >= 20:
                    break
                current = (current or 1) * 100
                last = "H"
                weak_only = False
            elif w in R.NUM_THOUSAND:
                if last not in (None, "U", "T", "H", "MM"):
                    break
                current = (current or 1) * R.NUM_THOUSAND[w]
                total += current
                current = 0
                last = "M"
                weak_only = False
            elif w in R.NUM_MILLION:
                if last not in (None, "U", "T", "H", "M"):
                    break
                total = ((total + current) or 1) * R.NUM_MILLION[w]
                current = 0
                last = "MM"
                weak_only = False
            elif w == R.NUM_JOIN and consumed:
                nxt = tokens[j + 1].key if j + 1 < n and tokens[j + 1].kind == "word" else None
                if self.code == "es":
                    if last == "T" and unit_value(j + 1):
                        last = "J"
                        j += 1
                        continue
                elif last in ("H", "M") and nxt and (nxt in R.NUM_SMALL or nxt in R.NUM_TENS) \
                        and nxt not in R.NUM_WEAK:
                    last = "H" if last == "H" else "MM"
                    j += 1
                    continue
                break
            else:
                break
            j += 1
            consumed += 1
        if not consumed:
            return None
        return j, total + current, weak_only

    def _ordinal_at(self, c: _Ctx, i: int):
        R = self.res
        tok = c.t[i]
        if tok.kind == "word" and tok.key in R.ORDINALS:
            return i + 1, R.ORDINALS[tok.key], tok.key in R.ORDINALS_WEAK
        if tok.kind == "number" and tok.norm.isdigit() and i + 1 < c.n and c.adjacent(i + 1):
            suf = c.t[i + 1].norm
            if suf in R.ORDINAL_SUFFIXES:
                return i + 2, int(tok.norm), False
        return None

    def _percentage_at(self, c: _Ctx, i: int):
        r = c.num_at.get(i)
        if not r or r[2]:
            return None
        j, v, _ = r
        for words in self.res.PERCENT_WORDS:
            end = c.seq(j, *words.split())
            if end:
                return end, _num(v)
        return None

    def _currency_at(self, c: _Ctx, i: int):
        R = self.res
        r = c.num_at.get(i)
        if r and not r[2]:
            j, v, _ = r
            w = c.w(j)
            if w in R.CURRENCY_WORDS:
                return i, j + 1, {"amount": _num(v), "currency": R.CURRENCY_WORDS[w]}
        w = c.w(i)
        if w in ("€", "$", "£") and i + 1 < c.n:
            r = c.num_at.get(i + 1)
            if r and not r[2]:
                return i, r[0], {"amount": _num(r[1]), "currency": R.CURRENCY_WORDS.get(w, "USD")}
        return None

    # ------------------------------------------------------------ duración
    def _duration_at(self, c: _Ctx, i: int):
        R = self.res
        units = R.DURATION_UNITS
        if self.code == "es":
            if c.seq(i, "media", "hora"):
                return i + 2, {"amount": 30, "unit": "min"}
            if c.seq(i, "medio", "minuto"):
                return i + 2, {"amount": 30, "unit": "s"}
            j = c.any_seq(i, [("un", "cuarto", "de", "hora"), ("cuarto", "de", "hora")])
            if j:
                return j, {"amount": 15, "unit": "min"}
            j = c.seq(i, "tres", "cuartos", "de", "hora")
            if j:
                return j, {"amount": 45, "unit": "min"}
            if c.seq(i, "hora", "y", "media") and c.w(i - 1) not in ("una", "la"):
                return i + 3, {"amount": 90, "unit": "min"}
        elif self.code == "en":
            j = c.any_seq(i, [("half", "an", "hour"), ("half", "hour")])
            if j:
                return j, {"amount": 30, "unit": "min"}
            j = c.any_seq(i, [("a", "quarter", "of", "an", "hour"), ("quarter", "hour")])
            if j:
                return j, {"amount": 15, "unit": "min"}
        r = c.num_at.get(i)
        if not r:
            return None
        j, v, _weak = r
        unit = units.get(c.w(j))
        if not unit or (c.t[j].kind != "word"):
            return None
        if unit == "h" and c.w(j) in ("h", "hs") and c.w(i - 1) in ("las", "la"):
            return None  # "a las 21h" es una hora, no una duración
        amount = v
        j += 1
        if self.code == "es":
            if c.seq(j, "y", "media"):
                amount += 0.5
                j += 2
            elif c.seq(j, "y", "cuarto"):
                amount += 0.25
                j += 2
        elif self.code == "en" and c.seq(j, "and", "a", "half"):
            amount += 0.5
            j += 3
        return j, {"amount": _num(amount), "unit": unit}

    # --------------------------------------------------------------- fechas
    def _date_at(self, c: _Ctx, i: int):
        if c.t[i].kind == "date":
            d = self._numeric_date(c, c.t[i].norm)
            return (i + 1, d) if d else None
        if self.code == "es":
            cands = [self._rel_day_es(c, i), self._weekday_es(c, i), self._abs_date_es(c, i),
                     self._rel_offset(c, i), self._period_es(c, i), self._holiday_es(c, i)]
        elif self.code == "en":
            cands = [self._rel_day_en(c, i), self._weekday_en(c, i), self._abs_date_en(c, i),
                     self._rel_offset(c, i), self._period_en(c, i)]
        else:
            return None
        cands = [x for x in cands if x]
        return max(cands, key=lambda x: x[0]) if cands else None

    def _numeric_date(self, c: _Ctx, s: str) -> date | None:
        parts = [int(p) for p in re.split(r"[/.-]", s) if p.isdigit()]
        if len(parts) == 3 and parts[0] > 31:  # formato ISO año-mes-día
            return _safe_date(parts[0], parts[1], parts[2])
        if self.code == "en":
            month, day = parts[0], parts[1]
        else:
            day, month = parts[0], parts[1]
        if len(parts) == 3:
            year = parts[2] + 2000 if parts[2] < 100 else parts[2]
            return _safe_date(year, month, day)
        if not (1 <= month <= 12 and 1 <= day <= 31):
            return None
        return _upcoming(c.today, month, day)

    def _rel_day_es(self, c: _Ctx, i: int):
        w = c.w(i)
        today = c.today
        if w == "hoy":
            return i + 1, today
        if w == "esta" and c.w(i + 1) in ("manana", "tarde", "noche"):  # «esta noche» es hoy
            return i + 2, today
        if w == "pasado" and c.w(i + 1) == "manana":
            return i + 2, today + timedelta(days=2)
        if w == "manana" and c.w(i - 1) not in ("la", "esta", "cada", "las", "una"):
            return i + 1, today + timedelta(days=1)
        if w == "ayer":
            return i + 1, today - timedelta(days=1)
        if w in ("anteayer", "antier"):
            return i + 1, today - timedelta(days=2)
        j = c.seq(i, "antes", "de", "ayer")
        if j:
            return j, today - timedelta(days=2)
        return None

    def _weekday_from(self, today: date, wd: int, mode: str) -> date:
        if mode == "prev":
            delta = -((today.weekday() - wd) % 7 or 7)
        elif mode == "nextweek":
            monday = today + timedelta(days=7 - today.weekday())
            return monday + timedelta(days=wd)
        elif mode == "thisweek":
            return today - timedelta(days=today.weekday()) + timedelta(days=wd)
        elif mode == "this":
            delta = (wd - today.weekday()) % 7
        else:
            delta = (wd - today.weekday()) % 7 or 7
        return today + timedelta(days=delta)

    def _weekday_es(self, c: _Ctx, i: int):
        j = i
        mode = "next"
        if c.w(j) in ("el", "este", "esta", "la", "los"):
            if c.w(j) in ("este", "esta"):
                mode = "this"
            j += 1
        if c.w(j) in ("proximo", "proxima", "siguiente"):
            mode = "next"
            j += 1
        elif c.w(j) == "pasado":
            mode = "prev"
            j += 1
        wd = self.res.WEEKDAYS.get(c.w(j))
        if wd is None:
            return None
        j += 1
        k = c.any_seq(j, [("que", "viene"), ("proximo",), ("siguiente",)])
        if k:
            mode, j = "next", k
        elif c.w(j) == "pasado":
            mode, j = "prev", j + 1
        else:
            k = c.any_seq(j, [("de", "la", "semana", "que", "viene"),
                              ("de", "la", "proxima", "semana"), ("de", "la", "semana", "proxima"),
                              ("de", "la", "siguiente", "semana")])
            if k:
                mode, j = "nextweek", k
            else:
                k = c.seq(j, "de", "esta", "semana")
                if k:
                    mode, j = "thisweek", k
        # "el lunes 5 de octubre": manda la fecha absoluta
        k = j + 1 if c.w(j) == "," else j
        absolute = self._abs_date_es(c, k)
        if absolute:
            return absolute[0], absolute[1]
        return j, self._weekday_from(c.today, wd, mode)

    def _abs_date_es(self, c: _Ctx, i: int):
        j = i
        if c.w(j) == "el":
            j += 1
        has_dia = False
        if c.w(j) == "dia":
            has_dia = True
            j += 1
        if c.w(j) == "primero":
            day, j = 1, j + 1
        else:
            r = c.int_at(j, 1, 31)
            if not r:
                return None
            j, day = r
            if c.w(j) in self.res.ORDINAL_SUFFIXES and c.adjacent(j):
                j += 1  # "1º de mayo"
        k = j + 1 if c.w(j) == "de" else j
        month = self.res.MONTHS.get(c.w(k))
        if month is None:
            if has_dia:
                d = _safe_date(c.today.year, c.today.month, day)
                if d is None or d < c.today:
                    nm = _add_months(c.today.replace(day=1), 1)
                    d = _safe_date(nm.year, nm.month, day)
                return (j, d) if d else None
            d = self._range_day_es(c, i, j, day)
            return (j, d) if d else None
        j = k + 1
        year = None
        k = j + 1 if c.w(j) in ("de", "del") else j
        r = c.int_at(k, 0, 2200)
        if r and (r[1] >= 1900 or (c.w(j) in ("de", "del") and r[1] < 100)):
            year = r[1] + 2000 if r[1] < 100 else r[1]
            j = r[0]
        if year:
            d = _safe_date(year, month, day)
        else:
            d = _upcoming(c.today, month, day)
        return (j, d) if d else None

    # palabras que, delante de «el N», indican que N es un día del mes
    _DAY_CUES = frozenset({"para", "desde", "hasta", "llegamos", "llego", "llegaremos", "llegare",
                           "llegaria", "llegariamos", "entramos", "entro", "salimos", "salgo",
                           "volvemos", "vuelvo", "venimos", "vengo", "vamos", "voy", "marcho",
                           "marchamos"})
    _RANGE_OPEN = ("del", "desde", "entre")
    _RANGE_JOIN = [("al",), ("y", "el"), ("y",), ("hasta", "el"), ("hasta",)]

    def _range_day_es(self, c: _Ctx, i: int, j: int, day: int) -> date | None:
        """¿Es una fecha un día sin mes? Solo con pistas claras:

        - rango con el mes en un extremo: «del 12 al 15 de octubre», «entre el 12 y el 15
          de octubre», «del 12 de octubre al 15», «llegamos el 12 de octubre y nos vamos el 15»;
        - rango sin mes: «del 12 al 15», «desde el 12 hasta el 15» (próximos días 12 y 15);
        - «para el 12», «a partir del 12», «llegamos el 12» (el próximo día 12).
        «del 12» suelto o «12 años» no son fechas."""
        if getattr(c, "in_range", False):  # al mirar el otro extremo, ese tiene que llevar mes
            return None
        c.in_range = True
        try:
            return self._bare_day(c, i, j, day)
        finally:
            c.in_range = False

    @staticmethod
    def _next_day(today: date, day: int) -> date | None:
        """El próximo día `day` del mes: este mes si aún no ha pasado, si no el siguiente."""
        d = _safe_date(today.year, today.month, day)
        if d is None or d < today:
            nm = _add_months(today.replace(day=1), 1)
            d = _safe_date(nm.year, nm.month, day)
        return d

    def _bare_day(self, c: _Ctx, i: int, j: int, day: int) -> date | None:
        start = i + 1 if c.w(i) == "el" else i  # posición del número
        p = start - 1  # palabra de delante (saltando «el»)
        article = c.w(p) == "el"
        if article:
            p -= 1
        # 1. el mes viene detrás: «12 al 15 de octubre»
        k = c.any_seq(j, self._RANGE_JOIN)
        later_day = c.int_at(k, 1, 31) if k is not None else None
        if later_day:
            later = self._abs_date_es(c, k)
            if later:
                end = later[1]
                d = _safe_date(end.year, end.month, day)
                if d and d > end:  # «del 30 al 2 de noviembre»: el 30 es de octubre
                    prev = _add_months(end.replace(day=1), -1)
                    d = _safe_date(prev.year, prev.month, day)
                return d
        # 2. el mes iba delante: «12 de octubre al 15», «el 12 de octubre y nos vamos el 15»
        connector = c.w(p) in ("al", "y", "hasta")
        if connector or article:
            window = 6 if connector else 9
            for back in range(p - 1, max(p - window, -1), -1):
                if self.res.MONTHS.get(c.w(back)) is None:
                    continue
                first = None
                for s in range(back - 1, max(back - 4, -1), -1):  # el día de ese mes
                    r = self._abs_date_es(c, s)
                    if r and r[0] > back:
                        first = r[1]
                        break
                if first is None:
                    break
                d = _safe_date(first.year, first.month, day)
                if d and d < first:  # «del 30 de octubre al 2»: el 2 es de noviembre
                    nxt = _add_months(first.replace(day=1), 1)
                    d = _safe_date(nxt.year, nxt.month, day)
                return d
        # 3. rango sin mes: primer extremo («del 12 al 15») ...
        if c.w(p) in self._RANGE_OPEN and later_day and later_day[1] > day:
            return self._next_day(c.today, day)
        # ... y segundo extremo (el mes del primero)
        if connector:
            q = p - 1
            while q >= 0 and c.t[q].kind == "symbol":
                q -= 1
            first_day = c.int_at(q, 1, 31)
            o = q - 1
            if c.w(o) == "el":
                o -= 1
            if first_day and first_day[0] == p and c.w(o) in self._RANGE_OPEN and day > first_day[1]:
                first = self._next_day(c.today, first_day[1])
                return _safe_date(first.year, first.month, day) if first else None
        # 4. un día suelto con pista: «para el 12», «a partir del 12», «llegamos el 12»
        if article and c.w(p) in self._DAY_CUES:
            return self._next_day(c.today, day)
        if c.w(p) == "del" and c.w(p - 1) == "partir":
            return self._next_day(c.today, day)
        return None

    def _rel_offset(self, c: _Ctx, i: int):
        sign = 1
        if self.code == "es":
            j = c.any_seq(i, [("dentro", "de"), ("en",), ("de", "aqui", "a"), ("hace",)])
            if j and c.w(i) == "hace":
                sign = -1
        else:
            j = c.any_seq(i, [("in",), ("within",)])
        if not j:
            return None
        r = c.num_at.get(j)
        if not r or isinstance(r[1], float):
            return None
        k, n, _ = r
        unit = self.res.DURATION_UNITS.get(c.w(k))
        k += 1
        if self.code == "en" and c.w(k) == "ago":
            sign, k = -1, k + 1
        n *= sign
        if unit == "day":
            return k, c.today + timedelta(days=n)
        if unit == "wk":
            return k, c.today + timedelta(weeks=n)
        if unit == "mo":
            return k, _add_months(c.today, n)
        if unit == "yr":
            return k, _add_months(c.today, 12 * n)
        return None

    def _period_es(self, c: _Ctx, i: int):
        today = c.today
        j = c.any_seq(i, [("la", "semana", "que", "viene"), ("la", "proxima", "semana"),
                          ("la", "semana", "proxima"), ("la", "siguiente", "semana"),
                          ("semana", "que", "viene"), ("proxima", "semana")])
        if j:
            return j, today + timedelta(days=7 - today.weekday())
        j = c.any_seq(i, [("el", "mes", "que", "viene"), ("el", "proximo", "mes"),
                          ("el", "mes", "proximo"), ("el", "siguiente", "mes"),
                          ("mes", "que", "viene"), ("proximo", "mes")])
        if j:
            return j, _add_months(today.replace(day=1), 1)
        j = c.any_seq(i, [("el", "ano", "que", "viene"), ("el", "proximo", "ano"),
                          ("el", "ano", "proximo"), ("ano", "que", "viene"), ("proximo", "ano")])
        if j:
            return j, date(today.year + 1, 1, 1)
        j = c.any_seq(i, [("el", "fin", "de", "semana"), ("este", "fin", "de", "semana"),
                          ("fin", "de", "semana")])
        if j:
            return j, self._weekend(today)
        return None

    @staticmethod
    def _weekend(today: date) -> date:
        if today.weekday() >= 5:
            return today
        return today + timedelta(days=5 - today.weekday())

    def _holiday_es(self, c: _Ctx, i: int):
        table = [
            (("nochebuena",), 12, 24), (("navidad",), 12, 25), (("navidades",), 12, 25),
            (("nochevieja",), 12, 31), (("ano", "nuevo"), 1, 1), (("dia", "de", "reyes"), 1, 6),
            (("reyes",), 1, 6), (("san", "valentin"), 2, 14),
        ]
        for words, m, d in table:
            j = c.seq(i, *words)
            if j:
                return j, _upcoming(c.today, m, d)
        return None

    # ---- inglés
    def _rel_day_en(self, c: _Ctx, i: int):
        w = c.w(i)
        today = c.today
        j = c.seq(i, "the", "day", "after", "tomorrow") or c.seq(i, "day", "after", "tomorrow")
        if j:
            return j, today + timedelta(days=2)
        j = c.seq(i, "the", "day", "before", "yesterday") or c.seq(i, "day", "before", "yesterday")
        if j:
            return j, today - timedelta(days=2)
        if w == "today" or c.seq(i, "to", "day"):
            return i + 1, today
        if w in ("tomorrow", "tmrw"):
            return i + 1, today + timedelta(days=1)
        if w == "yesterday":
            return i + 1, today - timedelta(days=1)
        return None

    def _weekday_en(self, c: _Ctx, i: int):
        j = i
        mode = "next"
        if c.w(j) == "on":
            j += 1
        if c.w(j) in ("next", "coming"):
            j += 1
        elif c.w(j) == "this":
            mode = "this"
            j += 1
        elif c.w(j) == "last":
            mode = "prev"
            j += 1
        wd = self.res.WEEKDAYS.get(c.w(j))
        if wd is None:
            return None
        return j + 1, self._weekday_from(c.today, wd, mode)

    def _abs_date_en(self, c: _Ctx, i: int):
        R = self.res
        j = i
        if c.w(j) in ("on", "the"):
            j += 1
            if c.w(j) == "the":
                j += 1
        month = R.MONTHS.get(c.w(j))
        day = None
        if month is not None:  # March 15th
            j += 1
            r = c.int_at(j, 1, 31)
            if r:
                j, day = r
            elif c.w(j) in R.ORDINALS:
                day, j = R.ORDINALS[c.w(j)], j + 1
            else:
                return None
            if c.w(j) in R.ORDINAL_SUFFIXES and c.adjacent(j):
                j += 1
        else:  # 15th of March
            r = c.int_at(j, 1, 31)
            if r:
                j, day = r
                if c.w(j) in R.ORDINAL_SUFFIXES and c.adjacent(j):
                    j += 1
            elif c.w(j) in R.ORDINALS:
                day, j = R.ORDINALS[c.w(j)], j + 1
            else:
                return None
            if c.w(j) == "of":
                j += 1
            month = R.MONTHS.get(c.w(j))
            if month is None:
                return None
            j += 1
        k = j + 1 if c.w(j) == "," else j
        r = c.int_at(k, 1900, 2200)
        if r:
            d = _safe_date(r[1], month, day)
            j = r[0]
        else:
            d = _upcoming(c.today, month, day)
        return (j, d) if d else None

    def _period_en(self, c: _Ctx, i: int):
        today = c.today
        j = c.any_seq(i, [("next", "week")])
        if j:
            return j, today + timedelta(days=7 - today.weekday())
        j = c.any_seq(i, [("next", "month")])
        if j:
            return j, _add_months(today.replace(day=1), 1)
        j = c.any_seq(i, [("next", "year")])
        if j:
            return j, date(today.year + 1, 1, 1)
        j = c.any_seq(i, [("this", "weekend"), ("the", "weekend"), ("weekend",)])
        if j:
            return j, self._weekend(today)
        j = c.any_seq(i, [("christmas",), ("christmas", "day")])
        if j:
            return j, _upcoming(today, 12, 25)
        j = c.any_seq(i, [("new", "year's", "day"), ("new", "year")])
        if j:
            return j, _upcoming(today, 1, 1)
        return None

    # ---------------------------------------------------------------- horas
    def _time_at(self, c: _Ctx, i: int):
        if self.code == "es":
            return self._time_es(c, i)
        if self.code == "en":
            return self._time_en(c, i)
        tok = c.t[i]
        if tok.kind == "time":
            hm = self._parse_hhmm(tok.norm)
            return (i + 1, hm) if hm else None
        return None

    @staticmethod
    def _parse_hhmm(s: str):
        parts = s.split(":")
        h, m = int(parts[0]), int(parts[1])
        if 0 <= h <= 24 and 0 <= m < 60:
            return h % 24, m
        return None

    def _qualifier_es(self, c: _Ctx, j: int):
        opts = [
            (("de", "la", "manana"), "manana"), (("por", "la", "manana"), "manana"),
            (("en", "la", "manana"), "manana"), (("de", "la", "madrugada"), "madrugada"),
            (("de", "la", "tarde"), "pm"), (("por", "la", "tarde"), "pm"),
            (("en", "la", "tarde"), "pm"), (("de", "la", "noche"), "noche"),
            (("por", "la", "noche"), "noche"), (("en", "la", "noche"), "noche"),
            (("del", "mediodia"), "mediodia"), (("de", "mediodia"), "mediodia"),
            (("am",), "am"), (("pm",), "pm"),
        ]
        best = (j, None)
        for words, q in opts:
            k = c.seq(j, *words)
            if k and k > best[0]:
                best = (k, q)
        if best[1] is None:
            w = c.w(j)
            if w in ("a", "p") and c.w(j + 1) == "." and c.w(j + 2) == "m":
                k = j + 3
                if c.w(k) == ".":
                    k += 1
                return k, "am" if w == "a" else "pm"
            if w in ("h", "hs", "hrs", "horas") and (c.adjacent(j) or w == "horas"):
                return j + 1, "h24"
        return best

    @staticmethod
    def _apply_qualifier(h: int, q: str | None, heuristic: bool, part: str | None = None) -> int:
        if q == "am":
            return 0 if h == 12 else h
        if q == "pm":
            return h + 12 if h < 12 else h
        if q == "noche":
            if h == 12:
                return 0
            return h + 12 if 6 <= h < 12 else h
        if q == "mediodia":
            return h + 12 if 1 <= h <= 4 else h
        if q in ("madrugada", "manana"):
            return 0 if (q == "madrugada" and h == 12) else h
        if q is None and heuristic and part != "morning":
            if 1 <= h <= 7:
                return h + 12  # "a las 5" -> 17:00 (lo más habitual en conversación)
            if part == "evening" and 8 <= h <= 11:
                return h + 12  # "cenar a las 9" -> 21:00
        return h

    def _day_part(self, c: _Ctx) -> str | None:
        """¿Habla la frase de la mañana o de la noche? «despiértame a las 7» son las 7:00
        y «cenar a las 9», las 21:00. Si habla de las dos cosas, no se decide."""
        words = [t.norm for t in c.t if t.kind == "word"]
        morning_cues = getattr(self.res, "MORNING_CUES", ())
        morning = bool(morning_cues) and any(w.startswith(morning_cues) for w in words)
        evening = any(w in getattr(self.res, "EVENING_CUES", ()) for w in words)
        if morning != evening:
            return "morning" if morning else "evening"
        return None

    def _time_es(self, c: _Ctx, i: int):
        w = c.w(i)
        if w == "mediodia":
            return i + 1, (12, 0)
        if w == "medianoche":
            return i + 1, (0, 0)
        j = i
        has_las = False
        if w in ("las", "la"):
            has_las = True
            j += 1
        tok = c.t[j] if j < c.n else None
        if tok is None:
            return None
        minutes = None
        explicit = False  # formato 17:30 -> sin heurística de tarde
        if tok.kind == "time":
            hm = self._parse_hhmm(tok.norm)
            if not hm:
                return None
            h, minutes = hm
            explicit = True
            j += 1
        elif tok.kind == "number" and has_las and re.fullmatch(r"\d{1,2}[.,]\d{2}", tok.norm):
            h, minutes = int(tok.norm[:-3]), int(tok.norm[-2:])
            if not (0 <= h <= 24 and 0 <= minutes < 60):
                return None
            j += 1
        else:
            r = c.int_at(j, 0, 24, allow_weak=has_las)
            if not r:
                return None
            j, h = r
        if minutes is None:
            minutes = 0
            if c.w(j) == "y":
                if c.w(j + 1) == "media":
                    minutes, j = 30, j + 2
                elif c.w(j + 1) == "cuarto":
                    minutes, j = 15, j + 2
                else:
                    r = c.int_at(j + 1, 1, 59)
                    if r:
                        j, minutes = r
                        if c.w(j) in ("minutos", "min", "minuto"):
                            j += 1
            elif c.w(j) == "menos":
                if c.w(j + 1) == "cuarto":
                    minutes, j = -15, j + 2
                else:
                    r = c.int_at(j + 1, 1, 59)
                    if r:
                        j, minutes = r[0], -r[1]
                        if c.w(j) in ("minutos", "min", "minuto"):
                            j += 1
            elif has_las:
                r = c.int_at(j, 10, 59)
                if r and c.t[j].kind == "word":
                    j, minutes = r
        k = c.seq(j, "en", "punto")
        if k:
            j = k
        j, q = self._qualifier_es(c, j)
        if not has_las and q is None and not explicit:
            return None
        if q is None and not explicit and j < c.n and c.t[j].kind == "word"                 and c.w(j) not in self._time_follow:
            return None  # "quiero las dos pizzas" no es una hora
        heuristic = has_las and not explicit
        h = self._apply_qualifier(h, q, heuristic, self._day_part(c) if heuristic else None)
        if minutes < 0:
            h, minutes = (h - 1) % 24, 60 + minutes
        if not (0 <= h <= 24 and 0 <= minutes < 60):
            return None
        return j, (h % 24, minutes)

    def _time_en(self, c: _Ctx, i: int):
        w = c.w(i)
        if w == "noon" or c.seq(i, "midday"):
            return i + 1, (12, 0)
        if w == "midnight":
            return i + 1, (0, 0)
        j = i
        has_at = False
        if w in ("at", "around", "by"):
            has_at = True
            j += 1
        minutes = None
        # half past five / quarter to six / ten past five
        pre = None
        if c.w(j) == "half" and c.w(j + 1) == "past":
            pre, j = 30, j + 2
        elif c.w(j) == "quarter" and c.w(j + 1) in ("past", "to"):
            pre, j = (15 if c.w(j + 1) == "past" else -15), j + 2
        elif c.seq(j, "a", "quarter") and c.w(j + 2) in ("past", "to"):
            pre, j = (15 if c.w(j + 2) == "past" else -15), j + 3
        else:
            r = c.int_at(j, 1, 59)
            if r and c.w(r[0]) in ("past", "to"):
                pre = r[1] if c.w(r[0]) == "past" else -r[1]
                j = r[0] + 1
        tok = c.t[j] if j < c.n else None
        if tok is None:
            return None
        explicit = False
        if tok.kind == "time":
            hm = self._parse_hhmm(tok.norm)
            if not hm:
                return None
            h, minutes = hm
            explicit = True
            j += 1
        else:
            r = c.int_at(j, 0, 24, allow_weak=False)
            if not r:
                return None
            j, h = r
            if pre is not None:
                minutes = pre
            else:
                r = c.int_at(j, 10, 59)
                if r and c.t[j].kind == "word" and has_at:
                    j, minutes = r
        if minutes is None:
            minutes = 0
        k = c.any_seq(j, [("o'clock",), ("o", "'", "clock"), ("oclock",)])
        if k:
            j = k
        q = None
        k = c.any_seq(j, [("in", "the", "morning")])
        if k:
            j, q = k, "manana"
        else:
            k = c.any_seq(j, [("in", "the", "afternoon"), ("in", "the", "evening"), ("at", "night"),
                              ("tonight",)])
            if k:
                j, q = k, "pm"
            elif c.w(j) in ("am", "pm"):
                q = c.w(j)
                j += 1
            elif c.w(j) in ("a", "p") and c.w(j + 1) == "." and c.w(j + 2) == "m":
                q = "am" if c.w(j) == "a" else "pm"
                j += 3
                if c.w(j) == ".":
                    j += 1
        if not has_at and q is None and not explicit and pre is None:
            return None
        h = self._apply_qualifier(h, q, heuristic=(has_at or pre is not None) and not explicit)
        if minutes < 0:
            h, minutes = (h - 1) % 24, 60 + minutes
        if not (0 <= h <= 24 and 0 <= minutes < 60):
            return None
        return j, (h % 24, minutes)

    # ------------------------------------------------------ fecha y hora
    def _combine_date_time(self, c: _Ctx, dates, times):
        connectors = {",", "a", "sobre", "por", "de", "hacia", "para", "y", "at", "on", "del",
                      "el", "around"}
        out = []
        for di, dj, d in dates:
            for ti, tj, (h, m) in times:
                if tj <= di or ti >= dj:
                    gap = range(dj, ti) if ti >= dj else range(tj, di)
                    if len(gap) <= 2 and all(c.w(k) in connectors for k in gap):
                        out.append((min(di, ti), max(dj, tj),
                                    f"{d.isoformat()}T{h:02d}:{m:02d}:00"))
        return out

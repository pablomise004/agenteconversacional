"""Generación del texto de las respuestas.

Referencias disponibles en los textos:
  $param             valor del parámetro, en formato legible (fechas, horas, listas...)
  $param.original    lo que escribió el usuario ("mañana")
  $param.value       valor en bruto ("2026-10-01")
  #contexto.param    parámetro guardado en un contexto activo (también .original/.value)
"""

import json
import random
import re
from datetime import date, datetime

from .nlu.languages import get_language

_PARAM_RE = re.compile(r"\$([A-Za-z_][\w\-]*)(?:\.(original|value))?")
_CTX_RE = re.compile(r"#([A-Za-z0-9_][\w\-]*)\.([A-Za-z_][\w\-]*)(?:\.(original|value))?")
_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_TIME_RE = re.compile(r"^\d{2}:\d{2}(:\d{2})?$")
_DT_RE = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$")

_UNITS = {
    "es": {"s": ("segundo", "segundos"), "min": ("minuto", "minutos"), "h": ("hora", "horas"),
           "day": ("día", "días"), "wk": ("semana", "semanas"), "mo": ("mes", "meses"),
           "yr": ("año", "años")},
    "en": {"s": ("second", "seconds"), "min": ("minute", "minutes"), "h": ("hour", "hours"),
           "day": ("day", "days"), "wk": ("week", "weeks"), "mo": ("month", "months"),
           "yr": ("year", "years")},
}
_CURRENCY = {"EUR": "€", "USD": "$", "GBP": "£"}


def format_number(v, lang: str) -> str:
    if isinstance(v, float) and v.is_integer():
        v = int(v)
    if isinstance(v, int):
        return str(v)
    s = f"{v:.2f}".rstrip("0").rstrip(".")
    return s.replace(".", ",") if lang == "es" else s


def format_date(d: date, lang: str) -> str:
    res = get_language(lang).res
    wd = res.WEEKDAY_NAMES[d.weekday()]
    month = res.MONTH_NAMES[d.month - 1]
    if lang == "en":
        return f"{wd}, {month} {d.day}"
    return f"{wd} {d.day} de {month}"


def format_value(v, lang: str = "es") -> str:
    """Convierte un valor de parámetro en texto legible."""
    if v is None:
        return ""
    if isinstance(v, bool):
        return ("sí" if v else "no") if lang == "es" else ("yes" if v else "no")
    if isinstance(v, (int, float)):
        return format_number(v, lang)
    if isinstance(v, list):
        items = [format_value(x, lang) for x in v if x not in (None, "")]
        if len(items) <= 1:
            return "".join(items)
        conj = get_language(lang).res.TEXTS.get("list_and", "y")
        return ", ".join(items[:-1]) + f" {conj} " + items[-1]
    if isinstance(v, dict):
        if "amount" in v and "currency" in v:
            amount = format_number(v["amount"], lang)
            sym = _CURRENCY.get(v["currency"], v["currency"])
            return f"{sym}{amount}" if lang == "en" and sym in ("$", "£") else f"{amount} {sym}"
        if "amount" in v and "unit" in v:
            names = _UNITS.get(lang, _UNITS["es"]).get(v["unit"], (v["unit"], v["unit"]))
            amount = v["amount"]
            return f"{format_number(amount, lang)} {names[0] if amount == 1 else names[1]}"
        return json.dumps(v, ensure_ascii=False)
    s = str(v)
    try:
        if _DATE_RE.match(s):
            return format_date(date.fromisoformat(s), lang)
        if _TIME_RE.match(s):
            return s[:5]
        if _DT_RE.match(s):
            dt = datetime.fromisoformat(s)
            sep = " a las " if lang == "es" else " at "
            return format_date(dt.date(), lang) + sep + dt.strftime("%H:%M")
    except ValueError:
        pass
    return s


def raw_value(v) -> str:
    if isinstance(v, (dict, list)):
        return json.dumps(v, ensure_ascii=False)
    return "" if v is None else str(v)


def render(template: str, params: dict, originals: dict, contexts: dict, lang: str = "es") -> str:
    def param_sub(m):
        name, mod = m.group(1), m.group(2)
        if name not in params:
            return ""
        if mod == "original":
            return format_value(originals.get(name, params[name]), lang)
        if mod == "value":
            return raw_value(params[name])
        return format_value(params[name], lang)

    def ctx_sub(m):
        ctx, name, mod = m.group(1).lower(), m.group(2), m.group(3)
        cparams = (contexts.get(ctx) or {}).get("parameters") or {}
        if mod == "original":
            return format_value(cparams.get(name + ".original", cparams.get(name)), lang)
        if name not in cparams:
            return ""
        if mod == "value":
            return raw_value(cparams[name])
        return format_value(cparams[name], lang)

    out = _CTX_RE.sub(ctx_sub, template)
    out = _PARAM_RE.sub(param_sub, out)
    return re.sub(r"[ \t]{2,}", " ", out).strip()


def build_messages(intent: dict, params: dict, originals: dict, contexts: dict, lang: str,
                   rng: random.Random | None = None) -> list[dict]:
    """Mensajes de respuesta de una intención (elige una variante al azar)."""
    rng = rng or random
    out = []
    for r in intent.get("responses") or []:
        if r["type"] == "text" and r.get("variants"):
            text = render(rng.choice(r["variants"]), params, originals, contexts, lang)
            if text:
                out.append({"type": "text", "text": text})
        elif r["type"] == "quickReplies" and r.get("items"):
            items = [render(x, params, originals, contexts, lang) for x in r["items"]]
            out.append({"type": "quickReplies", "items": [x for x in items if x]})
        elif r["type"] == "payload":
            out.append({"type": "payload", "payload": r.get("payload")})
    return out


def fulfillment_text(messages: list[dict]) -> str:
    return "\n".join(m["text"] for m in messages if m["type"] == "text")

"""Recursos del idioma español.

Todas las palabras están normalizadas: minúsculas y sin tildes (la "ñ" se
convierte en "n"), porque el tokenizador normaliza así el texto del usuario.
"""

STOPWORDS = frozenset("""
a al algo algun alguna algunas alguno algunos ante antes aqui asi aun bajo bien cada
como con contra cual cuales cuando de del desde donde dos durante e el ella ellas ello
ellos en entre era eran eres es esa esas ese eso esos esta estaba estado estais estamos
estan estar estas este esto estos estoy fue fueron fui ha habia han has hasta hay he la
las le les lo los mas me mi mia mias mio mios mis mucho muchos muy nada ni no nos
nosotras nosotros nuestra nuestro o os otra otras otro otros para pero poco por porque
que quien quienes se sea ser si sin sobre sois somos son soy su sus suya suyo tambien
te tenemos tener tengo ti tiene tienen todo todos tu tus un una unas uno unos usted
ustedes vosotros vuestra vuestro y ya yo
""".split())

# Abreviaturas y formas típicas de chat -> forma normalizada (puede tener varias palabras).
ABBREVIATIONS = {
    "q": "que", "k": "que", "ke": "que", "qe": "que",
    "xq": "porque", "pq": "porque", "porq": "porque", "xk": "porque", "pk": "porque",
    "tb": "tambien", "tmb": "tambien", "tbn": "tambien", "tambn": "tambien",
    "x": "por", "xa": "para", "pa": "para", "pal": "para el",
    "xfa": "por favor", "xfavor": "por favor", "porfa": "por favor", "porfi": "por favor",
    "plis": "por favor", "pls": "por favor", "plz": "por favor", "porfavor": "por favor",
    "d": "de", "dl": "del", "dnd": "donde", "cdo": "cuando", "cmo": "como",
    "msj": "mensaje", "msg": "mensaje", "bn": "bien", "tqm": "te quiero mucho",
    "ntp": "no te preocupes", "nse": "no se", "nose": "no se", "nidea": "ni idea",
    "salu2": "saludos", "grax": "gracias", "grs": "gracias", "grcs": "gracias",
    "grasias": "gracias", "graciass": "gracias", "ola": "hola", "wenas": "buenas",
    "wenos": "buenos", "aki": "aqui", "asta": "hasta", "okey": "ok", "oki": "ok",
    "okis": "ok", "vle": "vale", "sip": "si", "sii": "si", "nop": "no",
    "nope": "no", "toy": "estoy", "tas": "estas", "ta": "esta", "tmp": "tampoco",
    "tampoc": "tampoco", "mñn": "manana", "mnn": "manana", "finde": "fin de semana",
    "dsp": "despues", "dps": "despues", "hr": "hora", "hrs": "horas",
    "info": "informacion", "tlf": "telefono", "tel": "telefono", "tfno": "telefono",
    "num": "numero", "nro": "numero",
}

NUM_SMALL = {
    "cero": 0, "un": 1, "uno": 1, "una": 1, "dos": 2, "tres": 3, "cuatro": 4,
    "cinco": 5, "seis": 6, "siete": 7, "ocho": 8, "nueve": 9, "diez": 10, "once": 11,
    "doce": 12, "trece": 13, "catorce": 14, "quince": 15, "dieciseis": 16,
    "diecisiete": 17, "dieciocho": 18, "diecinueve": 19, "veinte": 20, "veintiun": 21,
    "veintiuno": 21, "veintiuna": 21, "veintidos": 22, "veintitres": 23,
    "veinticuatro": 24, "veinticinco": 25, "veintiseis": 26, "veintisiete": 27,
    "veintiocho": 28, "veintinueve": 29,
}
NUM_TENS = {
    "treinta": 30, "cuarenta": 40, "cincuenta": 50, "sesenta": 60, "setenta": 70,
    "ochenta": 80, "noventa": 90,
}
NUM_HUNDREDS = {
    "cien": 100, "ciento": 100, "doscientos": 200, "doscientas": 200,
    "trescientos": 300, "trescientas": 300, "cuatrocientos": 400, "cuatrocientas": 400,
    "quinientos": 500, "quinientas": 500, "seiscientos": 600, "seiscientas": 600,
    "setecientos": 700, "setecientas": 700, "ochocientos": 800, "ochocientas": 800,
    "novecientos": 900, "novecientas": 900,
}
NUM_HUNDRED_WORD = None
NUM_THOUSAND = {"mil": 1000}
NUM_MILLION = {"millon": 10**6, "millones": 10**6, "billon": 10**12, "billones": 10**12}
NUM_JOIN = "y"
NUM_WEAK = frozenset({"un", "una"})  # artículos que a veces son el número 1

ORDINALS = {
    "primero": 1, "primer": 1, "primera": 1, "segundo": 2, "segunda": 2,
    "tercero": 3, "tercer": 3, "tercera": 3, "cuarto": 4, "cuarta": 4,
    "quinto": 5, "quinta": 5, "sexto": 6, "sexta": 6, "septimo": 7, "septima": 7,
    "setimo": 7, "setima": 7, "octavo": 8, "octava": 8, "noveno": 9, "novena": 9,
    "decimo": 10, "decima": 10,
}
ORDINALS_WEAK = frozenset({"cuarto", "cuarta", "segundo", "segundos"})
ORDINAL_SUFFIXES = frozenset({"º", "ª", "°", "o", "a", "er", "ero", "era", "do", "da",
                              "ro", "ra", "to", "ta", "vo", "va", "no", "na", "mo", "ma"})

MONTHS = {
    "enero": 1, "ene": 1, "febrero": 2, "feb": 2, "marzo": 3, "abril": 4, "abr": 4,
    "mayo": 5, "junio": 6, "jun": 6, "julio": 7, "jul": 7, "agosto": 8, "ago": 8,
    "septiembre": 9, "setiembre": 9, "sep": 9, "sept": 9, "octubre": 10, "oct": 10,
    "noviembre": 11, "nov": 11, "diciembre": 12, "dic": 12,
}
WEEKDAYS = {
    "lunes": 0, "martes": 1, "miercoles": 2, "jueves": 3, "viernes": 4,
    "sabado": 5, "sabados": 5, "domingo": 6, "domingos": 6,
}
MONTH_NAMES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio",
               "agosto", "septiembre", "octubre", "noviembre", "diciembre"]
WEEKDAY_NAMES = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"]

DURATION_UNITS = {
    "segundo": "s", "segundos": "s", "seg": "s", "segs": "s",
    "minuto": "min", "minutos": "min", "min": "min", "mins": "min", "minutitos": "min",
    "hora": "h", "horas": "h", "h": "h", "hs": "h", "horita": "h", "horitas": "h",
    "dia": "day", "dias": "day", "semana": "wk", "semanas": "wk",
    "mes": "mo", "meses": "mo", "ano": "yr", "anos": "yr",
}

CURRENCY_WORDS = {
    "euro": "EUR", "euros": "EUR", "eur": "EUR", "€": "EUR", "pavos": "EUR",
    "dolar": "USD", "dolares": "USD", "usd": "USD", "$": "USD", "pesos": "MXN",
    "libra": "GBP", "libras": "GBP", "£": "GBP", "gbp": "GBP",
}
PERCENT_WORDS = ("por ciento", "porciento", "%")

# Si la frase habla de la mañana («despiértame a las 7», «desayuno a las 7»), «a las N»
# no se pasa a la tarde. Son comienzos de palabra (sin tildes).
MORNING_CUES = ("despert", "despiert", "levant", "madrug", "desayun", "tempran", "amanec")
# Y al revés: «cenar a las 9» son las 21:00 (palabras completas: «3 noches» no cuenta)
EVENING_CUES = frozenset({"cena", "cenar", "cenamos", "ceno", "cenaremos", "cenando", "noche"})

# Muletillas que no forman parte de un texto libre (@sys.any) si van delante: en «oye, la luz
# del baño no va» lo que no funciona es «la luz del baño»
LEADING_FILLERS = frozenset({"oye", "oiga", "hola", "mira", "mire", "perdona", "perdone", "disculpa",
                             "disculpe", "buenas", "bueno", "pues", "vale", "eh", "ey", "porfa"})

# Palabras con las que el usuario abandona el relleno de parámetros (slot filling).
# Solo cuentan si el mensaje entero está formado por estas palabras y las de relleno.
CANCEL_WORDS = frozenset({
    "cancelar", "cancela", "cancelalo", "olvidalo", "olvida", "dejalo", "deja",
    "salir", "para", "parar", "stop", "basta", "nada", "ninguno", "ninguna",
})
CANCEL_FILLER = frozenset({
    "no", "mejor", "ya", "vale", "pues", "lo", "por", "favor", "quiero", "da", "igual",
    "todo", "eso", "esto", "mejor", "asi", "bueno", "ok",
})

# Textos del sistema
TEXTS = {
    "cancelled": "De acuerdo, lo dejamos aquí.",
    "fallback": "Perdona, no te he entendido. ¿Puedes decirlo de otra forma?",
    "list_and": "y",
}

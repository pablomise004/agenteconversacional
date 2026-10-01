"""Genera examples/hotel.json: el agente grande de ejemplo (Hotel Mirador, Málaga).

El de la pizzería es para aprender; este enseña hasta dónde se puede llegar: el
recepcionista virtual de un hotel con reservas (con confirmación, cambios y
cancelación por contextos), servicios, peticiones durante la estancia, turismo y
charla, para que no se quede en blanco con cualquier cosa.

Notación de las frases (como en build_pizzeria.py):
  "una [doble](habitacion) para [el viernes](fecha_entrada)"  -> anotaciones explícitas
Las frases sin corchetes se guardan sin anotar ("annotations": null): el motor las anota
al entrenar con las mismas entidades que encuentra al analizar un mensaje, así que
entrenamiento y análisis ven lo mismo sin llenar las intenciones de parámetros que no usan.
Los corchetes solo hacen falta para repartir varios parámetros del mismo tipo («del [12] al
[15]», «[3] noches para [2] personas») y para el texto libre (@sys.any, @sys.person).

Uso:  python tools/build_hotel.py
Comprueba que cada anotación coincide con lo que detecta el motor, que no hay frases
repetidas y que la normalización no inventa parámetros, y escribe el JSON.
"""
import json
import re
import sys
import unicodedata
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
OUT = ROOT / "examples" / "hotel.json"

_n = 0


def uid(prefix):
    global _n
    _n += 1
    return f"{prefix}{_n:04d}"


MARK = re.compile(r"\[([^\]]+)\]\(([^)]+)\)")


def phrase(src, params):
    if not MARK.search(src):
        return {"id": uid("p"), "text": src, "annotations": None}
    text, anns, pos = "", [], 0
    for m in MARK.finditer(src):
        text += src[pos:m.start()]
        start = len(text)
        text += m.group(1)
        pname = m.group(2)
        if pname not in params:
            raise SystemExit(f"Parámetro desconocido «{pname}» en: {src}")
        anns.append({"start": start, "end": len(text), "entity": params[pname], "param": pname})
        pos = m.end()
    text += src[pos:]
    return {"id": uid("p"), "text": text, "annotations": anns}


def intent(name, phrases=(), responses=(), params=(), quick=(), action="", events=(), inctx=(), outctx=(),
           fallback=False, end=False, reset=False):
    pmap = {p["name"]: p["entity"] for p in params}
    resp = []
    if responses:
        resp.append({"type": "text", "variants": list(responses)})
    if quick:
        resp.append({"type": "quickReplies", "items": list(quick)})
    return {
        "id": uid("i"), "name": name, "isFallback": fallback, "events": list(events),
        "inputContexts": list(inctx),
        "outputContexts": [{"name": n, "lifespan": n_turns} for n, n_turns in outctx],
        "resetContexts": reset, "action": action or name,
        "parameters": [dict(p, id=uid("a")) for p in params],
        "trainingPhrases": [phrase(p, pmap) for p in phrases],
        "responses": resp, "webhook": False, "endConversation": end,
    }


def param(name, entity, required=False, prompts=(), is_list=False, default=""):
    return {"name": name, "entity": entity, "required": required, "isList": is_list,
            "prompts": list(prompts), "defaultValue": default}


def entity(name, entries, kind="map", fuzzy=True):
    if kind == "regex":
        return {"id": uid("e"), "name": name, "kind": "regex", "fuzzy": False, "autoExpand": False,
                "entries": [{"value": v, "synonyms": []} for v in entries]}
    return {"id": uid("e"), "name": name, "kind": kind, "fuzzy": fuzzy, "autoExpand": False,
            "entries": [{"value": v, "synonyms": s} for v, s in entries]}


# =========================================================================== entidades
entities = [
    entity("habitacion", [
        ("individual", ["individual", "habitación individual", "sencilla", "habitación sencilla", "simple",
                        "single"]),
        ("doble", ["doble", "habitación doble", "doble estándar", "estándar", "de matrimonio", "matrimonial",
                   "cama de matrimonio", "dos camas", "twin", "cama doble"]),
        ("doble con vistas al mar", ["vistas al mar", "con vistas al mar", "vista al mar", "con vistas",
                                     "vistas a la playa", "frente al mar", "doble superior", "superior",
                                     "con balcón", "doble vistas al mar", "habitación con vistas"]),
        ("familiar", ["familiar", "habitación familiar", "cuádruple", "triple", "con literas",
                      "para familias"]),
        ("suite", ["suite", "junior suite", "la suite", "suite con jacuzzi", "de lujo", "con jacuzzi",
                   "la mejor habitación"]),
    ]),
    entity("tratamiento", [
        ("circuito spa", ["circuito", "circuito spa", "circuito de spa", "circuito termal", "circuito de aguas",
                          "zona de aguas", "zona húmeda", "circuito hidrotermal"]),
        ("masaje relajante", ["masaje relajante", "masaje", "masajito", "masaje de relajación", "relajante",
                              "masaje suave", "masaje normal"]),
        ("masaje descontracturante", ["masaje descontracturante", "descontracturante", "masaje deportivo",
                                      "masaje terapéutico", "masaje de espalda", "masaje fuerte", "contracturas"]),
        ("masaje con piedras calientes", ["piedras calientes", "masaje con piedras", "piedras volcánicas",
                                          "hot stones", "masaje de piedras"]),
        ("masaje en pareja", ["masaje en pareja", "en pareja", "masaje para parejas", "masaje de pareja",
                              "masaje para dos"]),
        ("tratamiento facial", ["facial", "tratamiento facial", "limpieza facial", "limpieza de cutis",
                                "tratamiento de cara", "hidratación facial"]),
    ]),
    entity("objeto", [
        ("toallas", ["toalla", "toallas", "toallas de baño", "toallas limpias", "toalla de mano",
                     "toallas de piscina", "toalla de piscina", "toallas de playa"]),
        ("almohada", ["almohada", "almohadas", "cojín", "cojines", "almohadón", "otra almohada"]),
        ("manta", ["manta", "mantas", "edredón", "colcha", "nórdico", "frazada"]),
        ("papel higiénico", ["papel higiénico", "papel de baño", "papel del baño", "papel del váter",
                             "rollo de papel", "rollos de papel"]),
        ("secador de pelo", ["secador", "secador de pelo", "secapelos"]),
        ("plancha", ["plancha", "tabla de planchar", "plancha de ropa"]),
        ("cuna", ["cuna", "cunas", "cuna de viaje", "cuna para el bebé", "cunita"]),
        ("cama supletoria", ["cama supletoria", "cama extra", "supletoria", "otra cama", "sofá cama",
                             "cama plegable"]),
        ("adaptador de enchufe", ["adaptador", "adaptador de enchufe", "ladrón", "regleta"]),
        ("cargador", ["cargador", "cargador de móvil", "cargador del móvil", "cargador de iphone", "cable usb",
                      "cable de carga"]),
        ("kit dental", ["cepillo de dientes", "pasta de dientes", "kit dental", "dentífrico"]),
        ("kit de afeitado", ["maquinilla", "maquinilla de afeitar", "cuchilla", "kit de afeitado",
                             "espuma de afeitar"]),
        ("gel y champú", ["gel", "champú", "gel de ducha", "jabón", "acondicionador", "amenities"]),
        ("perchas", ["percha", "perchas"]),
        ("albornoz", ["albornoz", "albornoces", "bata", "zapatillas", "chanclas"]),
        ("botella de agua", ["botellas de agua", "agua mineral"]),
        ("hielo", ["hielo", "cubitos", "cubitos de hielo", "cubitera"]),
        ("kit de costura", ["kit de costura", "aguja e hilo", "costurero"]),
        ("trona", ["trona", "silla para bebé", "silla de bebé"]),
    ]),
    entity("trayecto", [
        ("del aeropuerto al hotel", ["del aeropuerto al hotel", "desde el aeropuerto", "del aeropuerto",
                                     "recogida en el aeropuerto", "en el aeropuerto", "recogerme en el aeropuerto",
                                     "recogernos en el aeropuerto", "buscarme al aeropuerto",
                                     "buscarnos al aeropuerto", "a la llegada", "recogida"]),
        ("del hotel al aeropuerto", ["del hotel al aeropuerto", "al aeropuerto", "hasta el aeropuerto",
                                     "ir al aeropuerto", "llevarme al aeropuerto", "llevarnos al aeropuerto",
                                     "para la salida", "para irnos"]),
    ]),
    entity("codigo_reserva", [r"\bMIR[-\s]?\d{4,6}\b"], kind="regex"),
]

# =========================================================================== parámetros
HAB_PROMPT = ("¿Qué habitación preferís? Tenemos individual, doble, doble con vistas al mar, "
              "familiar (hasta 4) y suite.")
P_FECHA_ENTRADA = param("fecha_entrada", "@sys.date", True,
                        ["¿Qué día llegaríais?", "¿Para qué día sería la llegada?"])
P_NOCHES = param("noches", "@sys.number", True, ["¿Cuántas noches os quedaríais?"])
P_HUESPEDES = param("huespedes", "@sys.number", True,
                    ["¿Para cuántas personas sería?", "¿Cuántas personas seríais?"])
P_HABITACION = param("habitacion", "@habitacion", True, [HAB_PROMPT])
P_HAB_NUM = param("habitacion_num", "@sys.number", True, ["¿En qué habitación estás?"])
CODIGO_PROMPT = ("Claro. ¿Me dices el código de la reserva? Empieza por MIR (por ejemplo, MIR-48213) "
                 "y lo tienes en el email de confirmación.")

RESUMEN_QUICK = ["Sí, confírmala", "Cambiar algo", "No, gracias"]
RESERVA_CTX = [("reserva", 10), ("reserva-confirmar", 3)]
MAIN_QUICK = ["Reservar una habitación", "Precios", "Servicios del hotel", "Cómo llegar"]

intents = []
add = intents.append

# =========================================================================== conversación
add(intent("saludo", [
    "hola", "buenas", "buenos días", "buenas tardes", "buenas noches", "hola qué tal", "hola buenas",
    "hey", "ey", "holaa", "saludos", "hola, buenos días", "hola mira", "hola hotel mirador", "hello", "hi",
    "buenas, ¿hay alguien?", "ola", "wenas", "hola de nuevo", "holi", "muy buenas", "hola, ¿estás ahí?",
    "buenas tardes, quería información", "hola, una consulta", "buenos días, ¿me atiendes?",
    "ey hola", "buenas noches, ¿hay alguien por ahí?", "hola, soy cliente del hotel",
], ["¡Hola! 👋 Soy Mira, la asistente virtual del Hotel Mirador. Puedo ayudarte a reservar, resolver dudas "
    "sobre el hotel o atender lo que necesites durante tu estancia. ¿Qué necesitas?",
    "¡Buenas! 😊 Soy Mira, del Hotel Mirador. ¿Quieres reservar, tienes alguna duda o estás alojado con "
    "nosotros y necesitas algo?"],
    quick=MAIN_QUICK, events=["WELCOME"], action="input.welcome"))

add(intent("saludo.que_tal", [
    "¿qué tal?", "¿cómo estás?", "¿qué tal estás?", "¿cómo te va?", "¿qué tal todo?", "¿cómo va eso?",
    "¿cómo andas?", "¿qué tal el día?", "hola, ¿cómo estás?", "¿todo bien?", "¿cómo estás hoy?",
    "¿qué tal te va?", "¿estás bien?", "¿cómo te encuentras?", "bien y tú?", "muy bien, ¿y tú?",
    "todo bien por aquí, ¿y tú qué tal?", "¿qué cuentas?", "¿cómo lo llevas?", "qué tal mira",
    "¿cómo te ha ido el día?", "¿qué tal la mañana?", "buenas, ¿cómo va todo?",
], ["¡Muy bien, gracias por preguntar! 😊 Aquí estoy, con vistas al mar y lista para ayudarte. ¿Qué necesitas?",
    "¡Genial! Cada día aprendo algo nuevo. Cuéntame, ¿en qué te ayudo?"], action="smalltalk.que_tal"))

add(intent("agradecimiento", [
    "gracias", "muchas gracias", "mil gracias", "muchísimas gracias", "te lo agradezco",
    "muy amable", "gracias por la ayuda", "gracias por todo", "perfecto, gracias", "genial, gracias",
    "vale, gracias", "ok gracias", "gracias guapa", "thank you", "thanks", "grax", "gracias majo",
    "muy amable, gracias", "me has ayudado mucho", "gracias, muy útil", "te debo una", "gracias de nuevo",
    "estupendo, muchas gracias", "gracias por la información",
], ["¡A ti! 😊 ¿Te ayudo con algo más?", "¡De nada! Para eso estoy. ¿Necesitas algo más?",
    "¡Un placer! Si surge cualquier cosa, aquí estaré."], action="smalltalk.gracias"))

add(intent("despedida", [
    "adiós", "hasta luego", "hasta pronto", "nos vemos", "chao", "chau", "bye", "adiós, gracias", "hasta otra",
    "me voy", "eso es todo", "nada más", "nada más, gracias", "eso era todo", "ya está, gracias",
    "hasta mañana", "que vaya bien", "un saludo", "hasta la próxima", "me despido", "venga, adiós",
    "chao chao", "luego hablamos", "ciao", "ya no necesito nada más", "eso es todo por ahora",
], ["¡Hasta pronto! 👋 Que disfrutes de Málaga.", "¡Adiós! Aquí estaré si necesitas algo. ☀️",
    "¡Hasta luego! Gracias por escribirnos."], action="smalltalk.adios", end=True))

add(intent("bot.identidad", [
    "¿eres un robot?", "¿eres una persona?", "¿eres humana?", "¿eres real?", "¿quién eres?",
    "¿cómo te llamas?", "¿tienes nombre?", "¿con quién hablo?", "¿eres un bot?",
    "¿estoy hablando con una máquina?", "¿eres una inteligencia artificial?", "¿eres una ia?",
    "¿eres chatgpt?", "¿quién te ha creado?", "¿quién te ha programado?", "¿qué eres?", "¿eres de verdad?",
    "¿hay alguien ahí o eres un programa?", "¿cuántos años tienes?", "¿dónde vives?", "¿eres chico o chica?",
    "¿cómo funcionas?", "¿cómo sabes tanto?", "¿eres un contestador automático?", "¿me lee una persona?",
], ["Soy Mira 🤖, la asistente virtual del Hotel Mirador. Funciono con Lince, un motor que aprende de frases de "
    "ejemplo: no duermo, no como y me sé el hotel de memoria. Si prefieres hablar con una persona, recepción "
    "está disponible las 24 horas."],
    quick=["Hablar con recepción", "¿Qué sabes hacer?"], action="smalltalk.bot"))

add(intent("charla.personal", [
    "¿cuál es tu color favorito?", "¿te gusta el fútbol?", "¿qué música te gusta?", "¿tienes novio?",
    "¿tienes novia?", "¿te casas conmigo?", "te quiero", "¿me quieres?", "¿qué haces en tu tiempo libre?",
    "¿qué comida te gusta?", "¿te gusta la playa?", "¿duermes?", "¿tienes sentimientos?", "¿te aburres?",
    "¿eres feliz?", "¿de qué equipo eres?", "¿cuál es tu película favorita?", "¿tienes amigos?",
    "¿qué te gusta hacer?", "¿tienes mascota?", "¿sueñas?", "¿cuál es tu plato favorito?",
], ["Soy una asistente virtual, así que no tengo gustos como tú… pero si pudiera, pasaría las tardes en la "
    "azotea viendo el atardecer sobre el mar. 🌅 ¿Te ayudo con algo del hotel?",
    "¡Qué pregunta! 😄 Mi pasión es que tu estancia sea perfecta. ¿En qué te ayudo?"],
    action="smalltalk.personal"))

add(intent("bot.ayuda", [
    "ayuda", "necesito ayuda", "¿me puedes ayudar?", "¿qué puedes hacer?", "¿qué sabes hacer?",
    "¿en qué me puedes ayudar?", "¿para qué sirves?", "opciones", "¿qué opciones hay?", "no sé qué preguntar",
    "¿qué te puedo preguntar?", "¿cómo funciona esto?", "¿qué cosas sabes?", "dame opciones",
    "¿qué puedo hacer aquí?", "¿me ayudas?", "ayúdame por favor", "tengo una duda", "tengo una pregunta",
    "quería preguntar una cosa", "¿puedo preguntarte algo?", "¿qué me puedes contar?",
], ["Puedo ayudarte con muchas cosas 😊:\n• Reservar habitación (y cambiarla o cancelarla)\n"
    "• Precios, ofertas y formas de pago\n• Servicios: restaurante, spa, piscina, parking, wifi…\n"
    "• Durante tu estancia: toallas, averías, despertador, taxi o traslado al aeropuerto\n"
    "• Qué ver y hacer en Málaga\n¿Por dónde empezamos?"],
    quick=["Reservar una habitación", "Precios", "Servicios del hotel", "Hablar con recepción"],
    action="smalltalk.ayuda"))

add(intent("charla.cumplido", [
    "eres muy lista", "qué lista eres", "eres genial", "me encantas", "eres la mejor", "qué maja eres",
    "eres muy útil", "me caes bien", "eres un sol", "qué rápida eres", "muy buen servicio",
    "eres muy simpática", "eres increíble", "qué bien lo haces", "buen trabajo", "eres un crack",
    "me gusta hablar contigo", "eres muy amable", "olé tú", "chapó", "eres más lista que yo",
], ["¡Muchas gracias! 😊 Me alegra mucho serte útil.", "¡Qué bien sienta eso! 🥰 ¿Te ayudo con algo más?"],
    action="smalltalk.cumplido"))

add(intent("charla.insulto", [
    "eres tonta", "eres tonto", "eres inútil", "no sirves para nada", "qué bot más malo",
    "eres una máquina estúpida", "vaya mierda", "no entiendes nada", "eres muy torpe", "menuda basura de bot",
    "qué pesada", "cállate", "eres un desastre", "estás fatal", "me tienes harto", "no me ayudas nada",
    "idiota", "imbécil", "eres lo peor", "qué bot más tonto", "eres una inútil", "no te enteras de nada",
], ["Siento no estar a la altura 😔. Si quieres, lo intentamos de otra forma: dime lo que necesitas con otras "
    "palabras, o te paso con recepción (952 123 456, las 24 horas).",
    "Vaya, lo siento. Todavía estoy aprendiendo. ¿Prefieres hablar con una persona? Recepción está disponible "
    "las 24 horas en el 952 123 456."],
    quick=["Hablar con recepción"], action="smalltalk.insulto"))

add(intent("charla.risa", [
    "jaja", "jajaja", "jajajaja", "jeje", "jiji", "xd", "lol", "jajaj qué gracia", "me parto",
    "qué gracioso", "jajaja muy bueno", "jaja vale", "ja ja", "me meo", "jajajajaja buenísimo", "jeje vale",
    "jaja qué bueno", "me he reído",
], ["😄 ¡Me alegra sacarte una sonrisa! ¿Te ayudo con algo más?", "¡Jajaja! 😄 ¿Seguimos? Dime qué necesitas."],
    action="smalltalk.risa"))

add(intent("charla.chiste", [
    "cuéntame un chiste", "dime un chiste", "¿sabes algún chiste?", "hazme reír", "cuéntame algo gracioso",
    "otro chiste", "un chiste por favor", "¿me cuentas un chiste?", "dime algo divertido", "sorpréndeme",
    "cuéntame algo", "algún chiste de hoteles", "estoy aburrido, cuéntame un chiste", "¿tienes sentido del humor?",
    "otro", "cuéntame otro", "venga, otro chiste", "dime una tontería",
], ["—Buenas, ¿tienen habitaciones con vistas al mar? —Sí, 135 euros. —¿Y sin vistas? —El mismo precio, pero "
    "le vendamos los ojos. 😄",
    "¿Cuál es el colmo de un hotel? Tener cuatro estrellas y querer ser una constelación. ⭐😄",
    "—¿Qué le dice una iguana a su hermana gemela? —Somos iguanitas. 🦎😄"],
    quick=["Otro chiste"], action="smalltalk.chiste"))

add(intent("charla.esperar", [
    "un momento", "espera", "espera un momento", "un segundo", "dame un minuto", "ahora vuelvo",
    "un momentito", "déjame pensar", "espera que lo miro", "voy a mirar una cosa", "aguanta un segundo",
    "un sec", "dame un momento", "déjame que lo consulte con mi pareja", "luego te digo", "ahora te digo",
    "deja que lo piense", "lo hablo y te digo", "espérame", "dame un rato",
], ["¡Claro! Tómate tu tiempo, aquí te espero. ⏳", "Sin prisa 😊. Cuando quieras, seguimos."],
    action="smalltalk.esperar"))

add(intent("charla.afirmacion", [
    "vale", "ok", "okey", "de acuerdo", "perfecto", "genial", "estupendo", "entendido", "muy bien", "guay",
    "sí", "claro", "fenomenal", "vale vale", "ok perfecto", "entiendo", "ah vale", "ya veo", "bien",
    "correcto", "eso es", "buenísimo", "sí, claro", "perfecto entonces", "vale, entendido",
], ["¡Genial! Dime, ¿en qué más te ayudo? 😊", "¡Perfecto! Si necesitas cualquier otra cosa, dímelo."],
    action="smalltalk.si"))

add(intent("charla.negacion", [
    "no", "no gracias", "nada", "no hace falta", "no es necesario", "ahora no", "de momento no",
    "no por ahora", "no, está bien así", "no quiero nada", "no me interesa", "paso", "tampoco", "no, nada",
    "no de momento", "mejor no", "no, ya está", "no necesito nada", "no, no hace falta",
], ["De acuerdo 🙂. Si necesitas cualquier cosa, aquí estoy.", "Vale, sin problema. ¡Aquí me tienes si me necesitas!"],
    action="smalltalk.no"))

add(intent("charla.no_entiendo", [
    "no te entiendo", "no entiendo", "¿qué?", "¿cómo?", "no me has entendido", "no es eso",
    "eso no es lo que te he preguntado", "no me refiero a eso", "me has entendido mal", "¿qué dices?",
    "no sé de qué me hablas", "te has equivocado", "eso no tiene sentido", "no es lo que he dicho", "repite",
    "¿puedes repetirlo?", "¿me lo repites?", "no lo pillo", "no has entendido nada", "eso no te lo he preguntado",
], ["Perdona si no me he explicado bien 😅. ¿Me lo dices con otras palabras? También puedes elegir una de estas "
    "opciones:"],
    quick=["Reservar una habitación", "Servicios del hotel", "Hablar con recepción"], action="smalltalk.no_entiendo"))

add(intent("charla.hora", [
    "¿qué hora es?", "¿me dices la hora?", "¿qué día es hoy?", "¿a qué día estamos?", "¿qué fecha es hoy?",
    "¿tienes hora?", "¿sabes qué hora es?", "dime la hora", "¿qué hora es en málaga?", "¿en qué día vivo?",
], ["No llevo reloj 😅, pero tu móvil seguro que sí. Por si te sirve: el check-in es a partir de las 15:00, el "
    "check-out hasta las 12:00 y recepción está abierta las 24 horas."], action="smalltalk.hora"))

add(intent("Fallback", [
    "cuál es la capital de francia", "quién ganó el mundial de 2010", "cuánto es 7 por 8",
    "cuál es la raíz cuadrada de 144", "quién es el presidente de estados unidos", "cuéntame las noticias de hoy",
    "pon música", "pon una canción de rosalía", "apaga la luz del salón", "llama a mi madre",
    "manda un whatsapp a juan", "pide una pizza", "quiero pedir comida a domicilio", "necesito un fontanero",
    "mi coche no arranca", "cómo se hace una tortilla de patatas", "receta de paella valenciana",
    "qué película me recomiendas ver", "quién escribió el quijote", "cuántos habitantes tiene españa",
    "cuál es el río más largo del mundo", "cómo se dice gato en inglés", "traduce buenos días al alemán",
    "hazme los deberes de matemáticas", "escribe un poema sobre el amor", "resume este texto",
    "quiero comprar un móvil", "cuánto cuesta un iphone", "dónde compro zapatillas de deporte",
    "quiero pedir una hipoteca", "cómo invierto en bolsa", "cuánto vale un bitcoin",
    "quiero cambiar de compañía de luz", "mi factura de la luz es muy cara", "necesito un abogado",
    "cómo arreglo mi ordenador", "mi portátil no enciende", "cómo bajo de peso rápido",
    "cuántas calorías tiene un plátano", "me he peleado con mi novia", "quiero aprender a tocar la guitarra",
    "qué es la fotosíntesis", "explícame la teoría de la relatividad", "cuándo fue la guerra civil",
    "quién pintó la mona lisa", "a qué hora juega el madrid", "resultado del barça",
    "quién va a ganar la liga", "qué opinas del gobierno", "a quién debería votar", "números de la lotería",
    "horóscopo de hoy", "busca vuelos baratos a londres", "quiero un billete de avión a parís",
    "reserva un vuelo a roma", "busco piso de alquiler en madrid", "asdfgh", "qwerty", "jkjkjk", "ñlkjh",
    "aaaaaa", "xxxxx", "dfgdfg", "ajsdhaksjd", "lorem ipsum dolor", "bla bla bla", "patata",
    "el perro de san roque no tiene rabo", "tres tristes tigres", "me gusta el chocolate",
    "los lunes son aburridos", "mi gato se llama michi", "el cielo es azul", "mañana tengo examen",
    "me gusta el fútbol", "cuál es el sentido de la vida", "existe dios", "cuántos años tiene el universo",
    "cuánto mide la torre eiffel", "dónde está australia", "cuántas patas tiene una araña",
    "por qué el cielo es azul", "cómo funciona un motor de coche", "configura el router de mi casa",
    "el wifi de mi casa no funciona", "quiero darme de baja de movistar", "cómo recupero mi contraseña de gmail",
    "olvidé la contraseña de instagram", "pedir cita para renovar el dni", "renovar el pasaporte",
    "matricularme en la universidad", "apuntarme al gimnasio de mi barrio", "reservar pista de pádel",
    "reservar entradas para el cine", "comprar entradas para un concierto", "reservar hora en la peluquería",
    "cita en el taller para el coche", "quiero adoptar un perro", "véndeme un coche", "dame un número al azar",
    "cuál es la contraseña de mi banco", "cómo se llama el rey de españa", "tengo hambre de chuches",
    "qué tal el partido de ayer", "hace mucho que no voy al cine", "mi jefe es muy pesado",
    "quiero cambiar de trabajo y no sé qué hacer", "cómo hago una página web", "test", "probando probando",
    "123", "...", "???", "eh", "mmm",
], ["Perdona, eso no lo sé 😅. Puedo ayudarte con reservas, precios, los servicios del hotel (spa, restaurante, "
    "parking…) o cualquier cosa durante tu estancia. ¿Qué necesitas?",
    "Uy, ahí no llego 🙈. Soy la asistente del Hotel Mirador: pregúntame por habitaciones, servicios, Málaga o "
    "lo que necesites durante tu estancia."],
    quick=["Reservar una habitación", "Servicios del hotel", "Hablar con recepción"], fallback=True,
    action="input.unknown"))

# =========================================================================== reservas
add(intent("reserva.habitacion", [
    "Reservar una habitación", "quiero reservar una habitación", "quiero hacer una reserva", "me gustaría reservar",
    "reservar habitación", "reserva", "¿tenéis habitaciones libres?", "¿hay disponibilidad?",
    "hacer una reserva de hotel", "booking", "quiero pillar una habitación", "necesito una habitación",
    "¿tenéis habitación para el puente?", "¿os queda alguna habitación?", "quería reservar en vuestro hotel",
    "¿tenéis disponibilidad para [este fin de semana](fecha_entrada)?",
    "quiero una [habitación doble](habitacion) para [el viernes](fecha_entrada)",
    "una [suite](habitacion) para [dos](huespedes) personas [3](noches) noches",
    "reservar [2](noches) noches desde [el 15 de octubre](fecha_entrada)",
    "necesito habitación para [4](huespedes) personas [mañana](fecha_entrada)",
    "quisiera reservar una [individual](habitacion) para [el lunes](fecha_entrada)",
    "[habitación familiar](habitacion) para [cuatro](huespedes) personas",
    "¿hay sitio para [3](huespedes) personas [el próximo sábado](fecha_entrada)?",
    "queremos ir [el 20 de diciembre](fecha_entrada), [5](noches) noches",
    "me gustaría una [doble con vistas al mar](habitacion)",
    "quiero reservar para [la semana que viene](fecha_entrada)",
    "¿puedo reservar una habitación para [pasado mañana](fecha_entrada)?",
    "necesito alojamiento para [2](noches) noches", "buscamos hotel para [este finde](fecha_entrada)",
    "reserva para [dos](huespedes) personas", "¿me reservas una [doble](habitacion)?",
    "quiero quedarme [3](noches) noches", "vamos a ir en [navidad](fecha_entrada) [4](huespedes) personas",
    "tengo pensado ir [el 3 de agosto](fecha_entrada)",
    "llegamos [el jueves](fecha_entrada) y nos quedamos [dos](noches) noches",
    "somos [2](huespedes) y queremos una noche",
    "para [2](huespedes) adultos [el 15 de agosto](fecha_entrada), [7](noches) noches, [habitación doble](habitacion)",
    "¿tenéis una [suite](habitacion) libre?", "quiero la [habitación familiar](habitacion)",
    "quiero reservar para [este sábado](fecha_entrada) solo una noche",
    "necesito una habitación para [hoy](fecha_entrada)",
    "reservar habitación [mañana](fecha_entrada) para [2](huespedes)",
    "una noche para [dos](huespedes) [hoy](fecha_entrada)",
    "quiero coger habitación para [el finde](fecha_entrada)",
    "¿tenéis algo [con vistas al mar](habitacion) para [el 12 de octubre](fecha_entrada)?",
    "reserva de [4](noches) noches para [3](huespedes) personas en una [familiar](habitacion)",
    "hola, quiero reservar [2](noches) noches para [dos](huespedes) personas",
    "somos [cuatro](huespedes) amigos y buscamos habitación",
    "quiero reservar una [habitación doble](habitacion) para [el 24 de diciembre](fecha_entrada)",
    "¿hay habitaciones disponibles para [mañana](fecha_entrada)?",
    "quiero hacer una reserva para [dentro de dos semanas](fecha_entrada)",
    "voy a estar [5](noches) noches en málaga, ¿tenéis sitio?",
    "una [individual](habitacion) para [3](noches) noches por favor",
    "queremos la [suite con jacuzzi](habitacion) para nuestro aniversario",
], ["¡Buenas noticias, hay disponibilidad! ✅ Te resumo la reserva:\n📅 Llegada: $fecha_entrada\n🌙 Noches: $noches\n"
    "👥 Personas: $huespedes\n🛏️ Habitación: $habitacion\n¿La confirmo?"],
    params=[P_FECHA_ENTRADA, P_NOCHES, P_HUESPEDES, P_HABITACION], quick=RESUMEN_QUICK, outctx=RESERVA_CTX,
    action="reserva.resumen"))

add(intent("reserva.habitacion.fechas", [
    "quiero reservar del [12](fecha_entrada) al [15 de octubre](fecha_salida)",
    "[habitación doble](habitacion) del [3](fecha_entrada) al [7 de agosto](fecha_salida)",
    "¿tenéis algo libre entre [el 5](fecha_entrada) y [el 9 de diciembre](fecha_salida)?",
    "reserva desde [el viernes](fecha_entrada) hasta [el domingo](fecha_salida)",
    "para [2](huespedes) personas del [20](fecha_entrada) al [23 de julio](fecha_salida)",
    "llegamos [el 10 de mayo](fecha_entrada) y nos vamos [el 14](fecha_salida)",
    "una [suite](habitacion) del [1](fecha_entrada) al [3 de enero](fecha_salida)",
    "entrada [el 15 de septiembre](fecha_entrada) y salida [el 18 de septiembre](fecha_salida)",
    "del [lunes](fecha_entrada) al [jueves](fecha_salida)",
    "desde [mañana](fecha_entrada) hasta [el sábado](fecha_salida)",
    "quiero una habitación de [hoy](fecha_entrada) a [mañana](fecha_salida)",
    "somos [4](huespedes), del [2](fecha_entrada) al [6 de abril](fecha_salida), [habitación familiar](habitacion)",
    "reservar del [24](fecha_entrada) al [26 de diciembre](fecha_salida) una [doble con vistas al mar](habitacion)",
    "¿hay disponibilidad del [8](fecha_entrada) al [11](fecha_salida)?",
    "me gustaría reservar desde [el 30 de octubre](fecha_entrada) hasta [el 2 de noviembre](fecha_salida)",
    "necesito habitación entrando [el miércoles](fecha_entrada) y saliendo [el viernes](fecha_salida)",
    "del [14](fecha_entrada) al [16](fecha_salida) para [dos](huespedes)",
    "check in [el 5 de junio](fecha_entrada) y check out [el 9 de junio](fecha_salida)",
    "quiero ir del [martes](fecha_entrada) al [viernes](fecha_salida) con mi pareja",
    "una [individual](habitacion) desde [el 3](fecha_entrada) hasta [el 5 de marzo](fecha_salida)",
    "estaremos desde [el 1 de agosto](fecha_entrada) hasta [el 15 de agosto](fecha_salida)",
    "vamos [el 12 de octubre](fecha_entrada) y volvemos [el 13](fecha_salida)",
    "¿tenéis habitación del [7](fecha_entrada) al [10](fecha_salida) para [tres](huespedes) personas?",
    "reserva para [2](huespedes) del [31 de diciembre](fecha_entrada) al [2 de enero](fecha_salida)",
    "una [doble](habitacion) entre [el 18](fecha_entrada) y [el 21 de noviembre](fecha_salida)",
    "quiero reservar una habitación desde [el jueves](fecha_entrada) hasta [el domingo](fecha_salida)",
    "llego [el 6 de febrero](fecha_entrada) y me voy [el 8](fecha_salida)",
    "fechas: del [19](fecha_entrada) al [22 de agosto](fecha_salida)",
], ["¡Buenas noticias, hay disponibilidad! ✅ Te resumo la reserva:\n📅 Llegada: $fecha_entrada\n"
    "📅 Salida: $fecha_salida\n👥 Personas: $huespedes\n🛏️ Habitación: $habitacion\n¿La confirmo?"],
    params=[P_FECHA_ENTRADA, param("fecha_salida", "@sys.date", True, ["¿Y qué día os iríais?"]), P_HUESPEDES,
            P_HABITACION],
    quick=RESUMEN_QUICK, outctx=RESERVA_CTX, action="reserva.resumen"))

add(intent("reserva.confirmar.si", [
    "Sí, confírmala", "sí", "confírmala", "confirma", "confirmar", "adelante", "sí, por favor",
    "vale, resérvala", "perfecto, adelante", "sí, la quiero", "dale", "venga", "ok, confirma", "sí, reserva",
    "hazla", "sí, haz la reserva", "claro que sí", "de acuerdo, confírmala", "sí, todo correcto",
    "está todo bien, confírmala", "sí, resérvamela", "perfecto, resérvala",
    "a nombre de [Laura Gómez](nombre)", "sí, a nombre de [Pedro Martín](nombre)",
    "confírmala, mi correo es [ana.lopez@gmail.com](email)",
    "sí, a nombre de [Carmen Ruiz](nombre), [carmen.ruiz@hotmail.com](email)",
    "vale, mi email es [jorge@empresa.es](email)", "sí, ponla a nombre de [Lucía](nombre)",
], ["¡Reserva confirmada, $nombre! 🎉\n🛏️ #reserva.habitacion · 👥 #reserva.huespedes · 📅 llegada el "
    "#reserva.fecha_entrada\nTe he enviado los detalles y el código de reserva a $email. La entrada es a partir "
    "de las 15:00. ¿Te ayudo con algo más? Puedo reservarte mesa, el spa o el traslado desde el aeropuerto."],
    params=[param("nombre", "@sys.person", True, ["¡Perfecto! ¿A nombre de quién hago la reserva?"]),
            param("email", "@sys.email", True, ["Gracias, $nombre. ¿A qué correo te envío la confirmación?"])],
    quick=["Traslado desde el aeropuerto", "Reservar mesa", "No, gracias"], inctx=["reserva-confirmar"],
    outctx=[("reserva-confirmar", 0), ("reserva", 0)], action="reserva.confirmar"))

add(intent("reserva.confirmar.no", [
    "no", "no, gracias", "mejor no", "todavía no", "no la confirmes", "espera, no", "no, déjalo", "ahora no",
    "lo pienso", "me lo pienso", "déjame pensarlo", "lo consulto y te digo", "de momento no", "no quiero reservar",
    "no estoy seguro", "prefiero esperar", "no, todavía no", "aún no",
], ["Sin problema, no he reservado nada. 😊 Si quieres, cambiamos las fechas o la habitación, o lo dejamos para "
    "otro momento."],
    quick=["Cambiar algo", "Ver precios"], inctx=["reserva-confirmar"], outctx=[("reserva-confirmar", 0)],
    action="reserva.no"))

add(intent("reserva.cambiar", [
    "Cambiar algo", "quiero cambiar algo", "quiero modificar algo", "espera, quiero cambiar una cosa",
    "hay algo mal", "eso no está bien", "corrige la reserva", "cambia los datos", "no es correcto",
    "me he equivocado", "quiero cambiar los datos", "algo no cuadra", "hay un error en la reserva",
    "quiero cambiar una cosa de la reserva",
], ["Claro, ¿qué quieres cambiar? Dime, por ejemplo, otra fecha, otro número de noches o de personas, u otra "
    "habitación."],
    quick=["Otra fecha", "Otro número de personas", "Otra habitación"], inctx=["reserva"],
    outctx=[("reserva", 10)], action="reserva.cambiar"))

SI_CONFIRMO = "¿Confirmo la reserva?"
add(intent("reserva.cambiar.fecha", [
    "Otra fecha", "cambiar la fecha", "otro día", "quiero cambiar el día", "la fecha está mal",
    "mejor [el 20 de octubre](fecha_entrada)", "mejor [el viernes](fecha_entrada)",
    "cámbiala para [el sábado](fecha_entrada)", "¿y si llegamos [el domingo](fecha_entrada)?",
    "que sea [el 5 de noviembre](fecha_entrada)", "cambia la llegada a [mañana](fecha_entrada)",
    "al final llegamos [el jueves](fecha_entrada)", "mejor del [13](fecha_entrada) al [16](fecha_salida)",
    "la fecha está mal, es [el 22 de octubre](fecha_entrada)", "mejor [la semana que viene](fecha_entrada)",
    "retrasa la llegada al [lunes](fecha_entrada)", "adelántala al [jueves](fecha_entrada)",
    "cambia las fechas: del [2](fecha_entrada) al [5 de diciembre](fecha_salida)",
    "pásala a [pasado mañana](fecha_entrada)", "mejor para [el 8 de agosto](fecha_entrada)",
], ["Hecho 👍 Llegada: $fecha_entrada (el resto se queda igual). " + SI_CONFIRMO],
    params=[param("fecha_entrada", "@sys.date", True, ["¿Qué día llegaríais?"]),
            param("fecha_salida", "@sys.date")],
    quick=RESUMEN_QUICK, inctx=["reserva"], outctx=RESERVA_CTX, action="reserva.cambiar.fecha"))

add(intent("reserva.cambiar.personas", [
    "Otro número de personas", "cambiar el número de personas", "quiero cambiar las personas",
    "seremos [3](huespedes)", "mejor para [4](huespedes) personas", "al final somos [dos](huespedes)",
    "que sea para [5](huespedes)", "cambia a [3](huespedes) personas", "en realidad somos [cuatro](huespedes)",
    "para [2](huespedes) adultos", "viene también mi hermana, seremos [3](huespedes)", "vamos [6](huespedes)",
    "al final vamos [dos](huespedes) personas",
    "cambia las personas a [cinco](huespedes)", "pon [4](huespedes) huéspedes",
], ["Hecho 👍 Personas: $huespedes. " + SI_CONFIRMO],
    params=[param("huespedes", "@sys.number", True, ["¿Para cuántas personas sería?"])],
    quick=RESUMEN_QUICK, inctx=["reserva"], outctx=RESERVA_CTX, action="reserva.cambiar.personas"))

add(intent("reserva.cambiar.habitacion", [
    "Otra habitación", "quiero otra habitación", "cambia el tipo de habitación", "otro tipo de habitación",
    "mejor una [suite](habitacion)", "¿y una [familiar](habitacion)?", "cámbiala a [doble](habitacion)",
    "prefiero [con vistas al mar](habitacion)", "que sea [individual](habitacion)",
    "pon una [doble con vistas al mar](habitacion)", "mejor [la suite](habitacion)",
    "¿y si cogemos [la suite](habitacion)?", "mejor [superior](habitacion)", "cambia a una [familiar](habitacion)",
    "al final queremos [dos camas](habitacion)", "mejor una más grande",
], ["Hecho 👍 Habitación: $habitacion. " + SI_CONFIRMO],
    params=[param("habitacion", "@habitacion", True, [HAB_PROMPT])],
    quick=RESUMEN_QUICK, inctx=["reserva"], outctx=RESERVA_CTX, action="reserva.cambiar.habitacion"))

add(intent("reserva.cambiar.noches", [
    "otro número de noches", "cambiar las noches", "mejor [4](noches) noches", "que sean [2](noches) noches",
    "al final [3](noches) noches", "nos quedamos [5](noches) noches", "pon [6](noches) noches",
    "quiero quedarme más noches", "mejor menos noches", "solo [1](noches) noche",
    "alarga a [7](noches) noches", "mejor solo una noche", "cambia a [dos](noches) noches",
    "quiero cambiar las noches", "en vez de eso, [4](noches) noches",
], ["Hecho 👍 Noches: $noches. " + SI_CONFIRMO],
    params=[param("noches", "@sys.number", True, ["¿Cuántas noches os quedaríais?"])],
    quick=RESUMEN_QUICK, inctx=["reserva"], outctx=RESERVA_CTX, action="reserva.cambiar.noches"))

add(intent("reserva.consultar", [
    "quiero consultar mi reserva", "¿está confirmada mi reserva?", "no me ha llegado la confirmación",
    "¿cómo veo mi reserva?", "tengo una reserva", "ver mi reserva", "estado de mi reserva",
    "quiero saber si mi reserva está bien", "no encuentro el email de la reserva", "¿me reenviáis la confirmación?",
    "reserva MIR-48213", "mi código es MIR-20517", "¿podéis comprobar mi reserva?", "hice una reserva por booking",
    "¿mi reserva incluye desayuno?", "¿cuál es mi código de reserva?", "he reservado en la web y no me llega nada",
    "¿tengo reserva a mi nombre?", "consultar reserva", "comprobar reserva",
], ["Puedes ver y gestionar tu reserva en hotelmirador.example/mi-reserva con el código (empieza por MIR) y tu "
    "email. Si no te ha llegado la confirmación, mira en la carpeta de spam o escríbenos a "
    "reservas@hotelmirador.example y te la reenviamos. Si reservaste en una agencia (Booking, Expedia…), la "
    "confirmación te la envían ellos."],
    params=[param("codigo", "@codigo_reserva")], quick=["Cambiar mi reserva", "Cancelar mi reserva"],
    action="reserva.consultar"))

add(intent("reserva.modificar", [
    "Cambiar mi reserva", "quiero modificar mi reserva", "cambiar las fechas de mi reserva",
    "necesito cambiar el día de llegada de mi reserva", "quiero añadir una noche a mi reserva", "modificar reserva",
    "¿puedo cambiar mi reserva?", "quiero cambiar la habitación de mi reserva",
    "tengo que cambiar la reserva que hice", "quiero modificar la reserva MIR-35120",
    "cambiar la reserva mir48213", "añadir desayuno a mi reserva", "añadir una persona a mi reserva",
    "quiero cambiar el nombre de la reserva", "mi vuelo se ha retrasado y llego un día más tarde",
    "¿se puede cambiar una reserva ya hecha?", "quiero alargar mi estancia",
], ["Gracias. He enviado tu petición de cambio para la reserva $codigo ✉️. Recepción te escribirá en menos de 2 "
    "horas para confirmarla. Recuerda que los cambios son gratis hasta 48 horas antes de la llegada (según "
    "disponibilidad)."],
    params=[param("codigo", "@codigo_reserva", True, [CODIGO_PROMPT])], action="reserva.modificar"))

add(intent("reserva.cancelar", [
    "Cancelar mi reserva", "quiero cancelar la reserva", "anular reserva", "necesito anular mi reserva",
    "ya no vamos a ir", "cancela mi reserva por favor", "¿cómo cancelo mi reserva?",
    "quiero cancelar la reserva MIR-48213", "anula la MIR77310", "no podemos ir, quiero cancelar",
    "me ha surgido un imprevisto y tengo que cancelar", "cancelación de reserva", "quiero anular la habitación",
    "cancelar la habitación que reservé", "al final no vamos, cancela", "quiero cancelar mi estancia",
], ["Vas a cancelar la reserva $codigo. Si faltan más de 48 horas para la llegada no tiene ningún coste. ¿La "
    "cancelo?"],
    params=[param("codigo", "@codigo_reserva", True, [CODIGO_PROMPT])], quick=["Sí, cancélala", "No, mejor no"],
    outctx=[("cancelacion", 2)], action="reserva.cancelar"))

add(intent("reserva.cancelar.si", [
    "Sí, cancélala", "sí", "cancélala", "sí, cancela", "adelante", "confirmo la cancelación", "sí, anúlala",
    "vale, cancela", "sí, por favor", "hazlo", "sí, seguro", "dale", "claro", "sí, cancélala ya", "venga, sí",
], ["Hecho. La reserva #cancelacion.codigo está cancelada ✅ y te llegará un email de confirmación. ¡Esperamos "
    "verte en otra ocasión! 👋"],
    inctx=["cancelacion"], outctx=[("cancelacion", 0)], action="reserva.cancelar.si"))

add(intent("reserva.cancelar.no", [
    "No, mejor no", "no", "no la canceles", "espera, no", "mejor la dejo", "me lo he pensado mejor",
    "no, gracias", "déjala como está", "no, al final vamos", "no quiero cancelar", "no, no la canceles",
    "mejor no la anules",
], ["¡Perfecto! Tu reserva sigue en pie. 😊 ¿Te ayudo con algo más?"],
    inctx=["cancelacion"], outctx=[("cancelacion", 0)], action="reserva.cancelar.no"))

add(intent("reserva.precios", [
    "Precios", "Ver precios", "¿cuánto cuesta una noche?", "¿cuánto cuesta la habitación?", "tarifas",
    "¿qué precio tiene la suite?", "¿cuánto vale la doble?", "precio por noche", "¿es caro?",
    "¿cuánto cuesta una individual?", "¿cuánto sale la noche?", "¿qué precios tenéis?",
    "¿cuánto me costaría una doble tres noches?", "¿cuánto cuesta la familiar?",
    "precio de la habitación con vistas al mar", "¿cuánto es la habitación doble por noche?",
    "¿cuánto cuesta en agosto?", "¿los precios incluyen desayuno?", "¿el iva está incluido?",
    "¿cuánto cuesta para dos personas?", "¿cuánto me sale el fin de semana?", "dime los precios",
    "¿cuánto cobráis?", "tarifa de la suite", "¿qué cuesta dormir una noche?", "precio habitación",
    "¿cuánto cuesta una noche en el hotel?", "¿es muy caro el hotel?", "¿hay habitaciones baratas?",
    "¿cuál es la habitación más barata?", "¿cuánto cuesta la suite con jacuzzi?",
], ["Precios por noche (desde, sin desayuno):\n🛏️ Individual: 75 €\n🛏️ Doble: 110 €\n🌊 Doble con vistas al mar: "
    "135 €\n👨‍👩‍👧 Familiar (hasta 4): 160 €\n✨ Suite con jacuzzi: 220 €\nEl IVA está incluido y el desayuno buffet "
    "cuesta 16 € por persona. En julio y agosto los precios suben un poco."],
    params=[param("habitacion", "@habitacion")],
    quick=["Reservar una habitación", "Tipos de habitación", "Ofertas"], action="reserva.precios"))

add(intent("reserva.habitaciones", [
    "Tipos de habitación", "¿qué tipos de habitaciones tenéis?", "¿cómo son las habitaciones?",
    "¿qué diferencia hay entre la doble y la suite?", "¿la suite tiene jacuzzi?", "¿cuántas camas tiene la familiar?",
    "¿las habitaciones tienen balcón?", "¿qué tamaño tienen las habitaciones?",
    "¿tenéis habitaciones con vistas al mar?", "¿hay habitaciones con dos camas?",
    "¿tenéis habitaciones comunicadas?", "¿cuántas personas caben en la familiar?",
    "¿la doble tiene cama de matrimonio?", "¿qué incluye la suite?", "fotos de las habitaciones",
    "¿tenéis habitaciones triples?", "descripción de las habitaciones", "¿la individual es muy pequeña?",
    "¿qué habitación me recomiendas?", "habitaciones", "¿cuántos metros tiene la suite?",
    "¿las camas son grandes?", "¿todas las habitaciones dan al mar?",
], ["Tenemos cinco tipos:\n• Individual (18 m²): cama de 135, para 1 persona.\n• Doble (24 m²): cama de matrimonio o "
    "dos camas, vistas a la ciudad.\n• Doble con vistas al mar (26 m²): balcón frente a la playa y cafetera.\n"
    "• Familiar (32 m²): cama doble y sofá cama, hasta 4 personas.\n• Suite (45 m²): salón, terraza con jacuzzi y "
    "vistas al mar.\nTodas tienen aire acondicionado, wifi gratis, TV, caja fuerte y minibar. Fotos en "
    "hotelmirador.example/habitaciones."],
    params=[param("habitacion", "@habitacion")],
    quick=["Precios", "Reservar una habitación"], action="reserva.habitaciones"))

add(intent("reserva.politica_cancelacion", [
    "política de cancelación", "¿puedo cancelar gratis?", "¿hasta cuándo puedo cancelar?", "¿qué pasa si cancelo?",
    "¿me devolvéis el dinero si cancelo?", "¿la reserva es reembolsable?", "¿cobráis algo por cancelar?",
    "condiciones de cancelación", "¿qué pasa si no me presento?", "si cancelo un día antes, ¿pierdo el dinero?",
    "tarifa no reembolsable", "¿puedo cambiar la fecha sin pagar?", "¿hay penalización por cancelar?",
    "¿cuántos días antes puedo anular?", "¿la cancelación es gratuita?", "¿qué es la tarifa flexible?",
], ["Con la tarifa flexible puedes cancelar gratis hasta 48 horas antes de la llegada; después se cobra la primera "
    "noche. La tarifa no reembolsable es un 10 % más barata, pero no se devuelve. Los cambios de fecha son gratis "
    "hasta 48 h antes (según disponibilidad)."],
    quick=["Cancelar mi reserva", "Formas de pago"], action="reserva.politica"))

add(intent("reserva.pago", [
    "Formas de pago", "¿cómo se paga?", "¿puedo pagar con tarjeta?", "¿aceptáis bizum?",
    "¿se paga al llegar o al reservar?", "¿cuándo me cobráis?", "¿me cobráis por adelantado?",
    "¿aceptáis american express?", "¿puedo pagar en efectivo?", "¿necesito tarjeta para reservar?",
    "¿pedís depósito?", "¿hay que dejar fianza?", "métodos de pago", "¿se puede pagar con paypal?",
    "¿me habéis cobrado ya?", "¿por qué me habéis hecho un cargo?", "¿cobráis la tasa turística?",
    "¿puedo pagar a plazos?", "pago", "¿aceptáis tarjeta de débito?",
], ["Puedes pagar con tarjeta (Visa, Mastercard, Amex), en efectivo o con Bizum en recepción 💳. Al reservar te "
    "pedimos una tarjeta solo como garantía: con la tarifa flexible pagas en el hotel, y la no reembolsable se "
    "cobra al reservar. No pedimos fianza ni hay tasa turística."], action="reserva.pago"))

add(intent("reserva.ofertas", [
    "Ofertas", "¿tenéis alguna oferta?", "descuentos", "¿hay descuento?", "código promocional",
    "¿tenéis promociones?", "club mirador", "programa de fidelización", "¿cómo me hago socio?",
    "¿dónde sale más barato reservar?", "¿es más barato en la web o en booking?",
    "¿hay descuento para estancias largas?", "¿descuento para jubilados?", "¿tenéis ofertas de última hora?",
    "¿hay algún paquete con spa?", "¿precio especial para residentes?", "mejor precio",
    "¿hacéis descuento si repito?", "¿tenéis algún chollo?",
], ["Reservando directamente en hotelmirador.example tienes el mejor precio garantizado 💸. Además, con el Club "
    "Mirador (gratis) consigues un 10 % de descuento, salida tardía y una copa de bienvenida. Para estancias de 7 "
    "noches o más hay un 15 % de descuento, y tenemos paquetes «Escapada Spa» con el circuito incluido."],
    quick=["Reservar una habitación", "Precios"], action="reserva.ofertas"))

add(intent("reserva.grupos", [
    "reserva para un grupo", "somos un grupo de 20 personas", "necesito 10 habitaciones",
    "¿tenéis tarifas para grupos?", "viaje de empresa con alojamiento", "reservar varias habitaciones",
    "viaje de fin de curso", "excursión con un grupo", "grupo de amigos de 15 personas",
    "¿hacéis descuento a grupos?", "necesito alojar a un equipo de fútbol", "precio para un grupo grande",
    "reserva de grupo",
], ["Para grupos a partir de 8 habitaciones tenemos tarifas especiales 👥. Escríbenos a grupos@hotelmirador.example "
    "con las fechas, el número de personas y el tipo de habitaciones, y te enviamos un presupuesto en menos de 24 "
    "horas."], action="reserva.grupos"))

add(intent("reserva.factura", [
    "necesito factura", "¿me podéis enviar la factura?", "factura a nombre de mi empresa", "¿cómo pido la factura?",
    "quiero la factura de mi estancia", "factura con mi nif", "no me ha llegado la factura",
    "¿podéis hacerme una factura?", "factura de la reserva", "necesito un justificante de pago", "recibo",
    "factura para la empresa", "¿la factura la dais al salir?", "corregir los datos de la factura",
    "quiero una factura con mis datos fiscales",
], ["La factura se emite al hacer el check-out 🧾. Si la necesitas a nombre de una empresa, danos los datos fiscales "
    "(razón social, NIF y dirección) en recepción o escríbenos a facturas@hotelmirador.example con tu código de "
    "reserva y te la enviamos en 24 horas."], action="reserva.factura"))

# =========================================================================== estancia
add(intent("estancia.horarios", [
    "¿a qué hora es el check in?", "hora de entrada", "¿a qué hora puedo entrar en la habitación?",
    "¿a qué hora hay que dejar la habitación?", "hora de salida", "¿cuándo es el check out?",
    "¿hasta qué hora puedo estar en la habitación?", "horario de check-in y check-out",
    "¿a qué hora se puede llegar?", "llegamos tarde por la noche, ¿hay problema?",
    "¿la recepción está abierta 24 horas?", "¿a qué hora cierra la recepción?", "¿se puede llegar de madrugada?",
    "¿a qué hora entregan las habitaciones?", "check in", "check out", "horario de recepción",
    "¿a partir de qué hora se puede entrar?", "¿cuál es la hora de salida?", "llegaré a las 2 de la madrugada",
], ["La entrada (check-in) es a partir de las 15:00 y la salida (check-out) hasta las 12:00. La recepción está "
    "abierta las 24 horas, así que puedes llegar a cualquier hora, ¡incluso de madrugada! 🌙"],
    quick=["Entrada anticipada", "Salida más tarde"], action="estancia.horarios"))

add(intent("estancia.checkin_anticipado", [
    "Entrada anticipada", "¿puedo hacer el check in antes?", "llegamos a las 9 de la mañana, ¿podemos entrar?",
    "¿puedo entrar antes de las 3?", "early check in", "¿hay forma de entrar por la mañana?",
    "nuestro vuelo llega muy temprano", "¿la habitación puede estar lista antes?", "¿cuánto cuesta entrar antes?",
    "¿podemos ocupar la habitación a mediodía?", "¿es posible hacer el check-in a las 11?",
    "llegamos pronto, ¿nos dais la habitación antes?", "entrada antes de hora",
], ["Si la habitación está lista, puedes entrar desde las 11:00 sin coste 😊. Si quieres asegurarlo, el check-in "
    "anticipado garantizado cuesta 30 €. Y si llegas antes, te guardamos el equipaje gratis mientras disfrutas de "
    "la piscina o del desayuno."], action="estancia.checkin_anticipado"))

add(intent("estancia.checkout_tardio", [
    "Salida más tarde", "late check out", "¿puedo salir más tarde?", "¿puedo dejar la habitación a las 2?",
    "¿hasta qué hora puedo quedarme el último día?", "mi vuelo sale por la noche, ¿puedo quedarme más?",
    "¿cuánto cuesta el check out tardío?", "¿puedo alargar la salida?", "quiero salir a las 6 de la tarde",
    "¿me dejáis la habitación hasta la tarde?", "¿se puede hacer el check-out más tarde?",
    "¿podemos quedarnos hasta las 16:00?", "salida tardía", "¿puedo irme después de las 12?",
], ["Claro: puedes dejar la habitación hasta las 14:00 por 20 € o hasta las 18:00 por 40 € (según disponibilidad; "
    "con el Club Mirador, hasta las 14:00 es gratis). Pídelo en recepción el día antes. Si solo necesitas guardar "
    "las maletas, la consigna es gratuita. 🧳"], action="estancia.checkout_tardio"))

add(intent("estancia.documentacion", [
    "¿qué documentos necesito?", "¿hay que llevar el dni?", "¿sirve el pasaporte?", "check in online",
    "¿puedo hacer el check-in por internet?", "¿necesitáis el dni de todos?", "¿los niños necesitan dni?",
    "¿tengo que enseñar la tarjeta con la que reservé?", "documentación para el check in",
    "¿me pedirán la tarjeta de crédito al llegar?", "¿qué tengo que llevar para registrarme?",
    "¿puedo registrarme con el carnet de conducir?", "¿por qué me pedís el dni?",
], ["Al llegar necesitamos el DNI o pasaporte de todos los adultos (es obligatorio por ley) y una tarjeta como "
    "garantía. 48 horas antes te enviamos un enlace para hacer el check-in online y ahorrarte la cola. 📲"],
    action="estancia.documentacion"))

add(intent("estancia.equipaje", [
    "consigna", "¿puedo dejar las maletas?", "¿tenéis consigna?", "¿me guardáis el equipaje?",
    "¿dónde dejo las maletas después del check out?", "llegamos pronto, ¿podemos dejar el equipaje?",
    "¿cuánto cuesta guardar las maletas?", "guardar maletas", "¿podéis guardar una bicicleta?",
    "¿puedo recibir un paquete en el hotel?", "¿me pueden subir las maletas?", "¿hay botones?",
    "¿dónde guardo el equipaje?", "¿es gratis dejar las maletas?",
], ["Tenemos consigna gratuita: puedes dejar el equipaje antes del check-in o después del check-out, el tiempo "
    "que necesites ese día 🧳. También recibimos paquetes a tu nombre y el personal te sube las maletas a la "
    "habitación."], action="estancia.equipaje"))

add(intent("estancia.wifi", [
    "wifi", "¿tenéis wifi?", "¿cuál es la contraseña del wifi?", "clave del wifi", "¿el wifi es gratis?",
    "¿hay internet?", "¿cómo me conecto a internet?", "red wifi", "¿llega el wifi a la piscina?",
    "¿es rápido el internet?", "password wifi", "¿hay wifi en las habitaciones?", "¿cuál es la red?",
    "¿puedo conectar varios dispositivos?", "contraseña de internet", "¿hay buena conexión?",
    "¿el wifi es de pago?", "necesito internet para trabajar",
], ["Sí, el wifi es gratis en todo el hotel (también en la piscina y la azotea) 📶. La red es «Mirador_Huespedes» "
    "y la contraseña viene en el sobre de la tarjeta de tu habitación; si la pierdes, pídela en recepción. Es "
    "fibra de 600 Mb, así que puedes conectar todos tus dispositivos y trabajar sin problema."],
    action="estancia.wifi"))

add(intent("estancia.parking", [
    "Parking", "¿tenéis parking?", "¿dónde puedo aparcar?", "¿cuánto cuesta el parking?", "aparcamiento",
    "¿hay garaje?", "¿se puede reservar plaza de parking?", "¿el parking es gratis?",
    "¿hay sitio para aparcar cerca?", "¿tenéis cargador para coches eléctricos?",
    "¿cabe una furgoneta en el parking?", "¿qué altura tiene el garaje?",
    "¿puedo dejar el coche después del check out?", "voy en coche, ¿dónde lo dejo?", "parking para moto",
    "¿el parking está vigilado?", "¿hay que reservar el parking?", "reservar parking",
    "¿hay aparcamiento en la calle?",
], ["Tenemos parking subterráneo por 22 € al día 🚗, con acceso directo al hotel. Las plazas son limitadas, así "
    "que te recomendamos reservarla (dímelo al reservar o pídela en recepción). Altura máxima: 2,05 m. Hay 2 "
    "cargadores para coches eléctricos (la carga está incluida). Si no quedara plaza, el parking público más "
    "cercano está a 200 m."], action="estancia.parking"))

add(intent("estancia.mascotas", [
    "¿admitís perros?", "¿se aceptan mascotas?", "¿puedo ir con mi perro?", "¿sois pet friendly?",
    "¿puedo llevar a mi gato?", "¿cuánto cuesta llevar al perro?", "¿hay límite de peso para perros?", "mascotas",
    "viajo con mi perro", "¿el perro puede quedarse solo en la habitación?", "¿puede entrar el perro en el restaurante?",
    "¿aceptáis perros grandes?", "perro guía", "¿dejan entrar animales?", "¿se admiten animales de compañía?",
    "mi perro pesa 20 kilos", "¿hay que pagar por la mascota?",
], ["¡Sí, somos pet friendly! 🐶 Admitimos perros y gatos de hasta 15 kg por 20 € la noche (con cama y cuenco de "
    "regalo). No pueden quedarse solos en la habitación ni entrar al restaurante, el spa o la piscina. Los perros "
    "guía son siempre bienvenidos y gratis. Avísanos al reservar."], action="estancia.mascotas"))

add(intent("estancia.ninos", [
    "¿tenéis cunas?", "viajo con un bebé", "¿los niños pagan?", "¿hay cama supletoria?",
    "¿cuánto cuesta una cama extra?", "¿tenéis actividades para niños?", "club infantil",
    "¿hay trona en el restaurante?", "¿es un hotel para familias?", "¿hasta qué edad los niños no pagan?",
    "viajamos con niños", "¿hay piscina para niños?", "¿ofrecéis servicio de canguro?",
    "¿los niños desayunan gratis?", "¿tenéis menú infantil?", "¿hay parque infantil?",
    "¿cabe una cuna en la habitación doble?", "niños", "¿el hotel es adecuado para niños?",
], ["¡Los niños son bienvenidos! 👶 Las cunas son gratis (bajo petición) y la cama supletoria cuesta 30 € la noche "
    "(de 3 a 12 años). Los menores de 4 años desayunan gratis y de 4 a 12 pagan la mitad. En julio y agosto hay "
    "club infantil (4 a 12 años, de 10:00 a 13:30), y en el restaurante tenemos tronas y menú infantil. También "
    "podemos buscarte una canguro."], action="estancia.ninos"))

add(intent("estancia.accesibilidad", [
    "¿el hotel es accesible?", "silla de ruedas", "¿tenéis habitaciones adaptadas?", "movilidad reducida",
    "¿hay ascensor?", "¿hay escalones en la entrada?", "¿el baño tiene ducha adaptada?", "voy en silla de ruedas",
    "¿la piscina tiene grúa?", "accesibilidad", "¿hay rampa?", "discapacidad",
    "¿tenéis habitación para personas con discapacidad?", "mi madre tiene problemas para caminar",
], ["Sí ♿. Tenemos 4 habitaciones adaptadas (ducha a ras de suelo, barras de apoyo y puertas anchas), rampas en "
    "todas las entradas y ascensores a todas las plantas. La piscina de la azotea tiene grúa. Avísanos al reservar "
    "para asignarte una habitación adaptada."], action="estancia.accesibilidad"))

add(intent("estancia.fumar", [
    "¿se puede fumar?", "¿puedo fumar en la habitación?", "zona de fumadores", "¿hay habitaciones para fumadores?",
    "¿se puede fumar en el balcón?", "fumar", "¿dónde puedo fumar?", "¿se puede vapear?", "¿está prohibido fumar?",
    "¿puedo fumar en la terraza?", "soy fumador",
], ["El hotel es 100 % libre de humo (también los balcones) 🚭. Puedes fumar en la zona habilitada de la azotea. "
    "Fumar en la habitación supone un cargo de limpieza de 150 €."], action="estancia.fumar"))

add(intent("estancia.lavanderia", [
    "lavandería", "¿tenéis servicio de lavandería?", "¿puedo lavar ropa?", "¿hay lavadora?", "planchado",
    "¿me podéis planchar una camisa?", "¿cuánto cuesta lavar la ropa?", "tintorería", "¿hay secadora?",
    "necesito lavar ropa", "¿dónde puedo lavar mi ropa?", "servicio de plancha",
], ["Tenemos servicio de lavandería y planchado 👕: si nos dejas la ropa antes de las 10:00, la tienes lista a las "
    "19:00. Los precios están en la bolsa de la habitación. No hay lavadoras de autoservicio, pero si necesitas una "
    "plancha te la subimos."], action="estancia.lavanderia"))

add(intent("estancia.equipamiento", [
    "¿qué tiene la habitación?", "¿hay secador de pelo?", "¿la habitación tiene caja fuerte?",
    "¿hay aire acondicionado?", "¿tiene nevera la habitación?", "¿hay minibar?", "¿hay cafetera en la habitación?",
    "¿tenéis albornoz?", "¿la tele tiene canales internacionales?", "¿hay calefacción?",
    "¿la habitación tiene bañera?", "¿qué amenities hay?", "¿hay plancha en la habitación?", "¿tiene microondas?",
    "¿hay enchufes usb?", "¿hay hervidor de agua?", "¿el minibar es gratis?", "¿cómo funciona la caja fuerte?",
    "¿hay carta de almohadas?", "caja fuerte", "¿hay toallas en la habitación?",
], ["Todas las habitaciones tienen aire acondicionado y calefacción, wifi, TV de 50\" con canales internacionales, "
    "caja fuerte gratuita, minibar, secador, enchufes USB y amenities 🧴. Las dobles con vistas al mar y la suite "
    "tienen además cafetera, albornoz y zapatillas. Si necesitas algo más (plancha, almohada, adaptador…), dímelo "
    "y te lo subimos."],
    quick=["Pedir algo a la habitación"], action="estancia.equipamiento"))

# =========================================================================== restauración
add(intent("restaurante.desayuno", [
    "¿a qué hora es el desayuno?", "horario del desayuno", "¿el desayuno está incluido?", "¿cuánto cuesta el desayuno?",
    "desayuno", "¿qué hay para desayunar?", "¿el desayuno es buffet?", "¿hay desayuno sin gluten?",
    "¿tenéis opciones veganas en el desayuno?", "¿puedo añadir el desayuno a mi reserva?", "¿dónde se desayuna?",
    "¿hasta qué hora se puede desayunar?", "¿se puede desayunar en la habitación?", "media pensión",
    "¿tenéis pensión completa?", "¿se puede contratar media pensión?", "¿hay desayuno para llevar?",
    "salimos muy temprano, ¿podemos desayunar antes?", "¿a qué hora abre el comedor por la mañana?",
    "¿el desayuno es bueno?",
], ["El desayuno buffet se sirve en La Terraza de 7:00 a 10:30 (fines de semana hasta las 11:00) 🥐. Cuesta 16 € por "
    "adulto y 8 € de 4 a 12 años; los menores de 4, gratis. Hay opciones sin gluten, sin lactosa y veganas, y si "
    "sales temprano te preparamos un desayuno para llevar. La media pensión (desayuno y cena) cuesta 35 € más por "
    "persona y noche."], action="restaurante.desayuno"))

add(intent("restaurante.info", [
    "Restaurante", "¿tenéis restaurante?", "¿a qué hora se cena?", "horario del restaurante",
    "¿qué tipo de comida tenéis?", "carta del restaurante", "menú del restaurante", "¿tenéis menú del día?",
    "¿se puede comer en el hotel?", "¿hay opciones vegetarianas?", "soy celíaco, ¿tenéis platos sin gluten?",
    "tengo alergia a los frutos secos", "¿el restaurante está abierto a no huéspedes?", "¿hay que reservar para cenar?",
    "¿cuánto cuesta cenar en el hotel?", "¿a qué hora abre la cocina?", "comida vegana", "¿hacéis paella?",
    "¿tenéis pescado fresco?", "¿a qué hora se come?", "¿dónde se cena en el hotel?",
], ["Nuestro restaurante La Terraza 🍽️, frente al mar, sirve cocina mediterránea y malagueña (espetos, pescaíto "
    "frito, arroces): comidas de 13:00 a 16:00 y cenas de 20:00 a 23:00. Entre semana hay menú del día por 22 €. "
    "Tenemos platos vegetarianos, veganos y sin gluten; avísanos de cualquier alergia. Está abierto también a no "
    "huéspedes y conviene reservar."],
    quick=["Reservar mesa"], action="restaurante.info"))

add(intent("restaurante.reservar", [
    "Reservar mesa", "quiero reservar mesa en el restaurante", "reserva para cenar", "reservar una mesa para cenar",
    "quiero cenar [hoy](fecha) a [las 21:00](hora)",
    "reservar mesa para [4](personas) [mañana](fecha) a [las 14:30](hora)",
    "¿tenéis mesa para [6](personas) [el sábado](fecha)?", "resérvame mesa para comer [el domingo](fecha)",
    "quiero una mesa en la terraza", "reserva en La Terraza para [tres](personas)",
    "mesa para [2](personas) a [las 9 de la noche](hora)", "queremos comer en el hotel [mañana](fecha)",
    "¿puedo reservar para cenar a [las 20:30](hora)?",
    "una mesa para [cinco](personas) personas [el viernes](fecha) a [las 21h](hora)",
    "reservar para la cena de [nochevieja](fecha)", "mesa junto a la ventana para [2](personas)",
    "quiero reservar en el restaurante del hotel", "mesa para comer", "¿me guardas mesa para cenar?",
    "reservar mesa para [dos](personas) [esta noche](fecha)",
], ["¡Reservado! ✅ Mesa en La Terraza:\n📅 $fecha a las $hora\n👥 Personas: $personas\nSi necesitas cambiarla, "
    "dímelo. ¡Que aproveche!"],
    params=[param("fecha", "@sys.date", True, ["¿Para qué día?"]),
            param("hora", "@sys.time", True, ["¿A qué hora os viene bien? Comidas de 13:00 a 16:00 y cenas de 20:00 "
                                              "a 23:00."]),
            param("personas", "@sys.number", True, ["¿Para cuántas personas?"])],
    action="restaurante.reserva"))

add(intent("restaurante.bar", [
    "¿tenéis bar?", "bar de la azotea", "¿a qué hora abre el bar?", "¿dónde puedo tomar algo?", "cócteles",
    "rooftop", "¿la azotea está abierta?", "¿se puede ver el atardecer desde el hotel?", "¿hay música en el bar?",
    "cafetería", "¿dónde me tomo un café?", "¿hasta qué hora está abierto el bar?",
    "¿puedo subir a la azotea si no estoy alojado?", "¿tenéis happy hour?", "copas", "quiero tomar una copa",
], ["El bar Azotea 🍹 (planta 8) abre de 17:00 a 01:00, con cócteles y las mejores vistas del atardecer sobre el "
    "puerto; está abierto también a no huéspedes y hay happy hour de 18:00 a 19:30. Para un café, la cafetería del "
    "lobby está abierta de 9:00 a 00:00."], action="restaurante.bar"))

add(intent("restaurante.habitacion", [
    "servicio de habitaciones", "room service", "¿puedo pedir comida a la habitación?",
    "¿hasta qué hora hay servicio de habitaciones?", "quiero cenar en la habitación",
    "¿me podéis subir algo de comer?", "carta del room service", "tengo hambre y estoy en la habitación",
    "¿se puede pedir un sándwich a la habitación?", "pedir comida a la habitación",
    "¿cuánto cuesta el servicio de habitaciones?", "quiero que me suban la cena",
], ["El servicio de habitaciones funciona de 12:00 a 23:00 🛎️. La carta está en la habitación (o escaneando el QR "
    "de la mesita) y se pide marcando el 9. Tiene un suplemento de 5 € por pedido."],
    action="restaurante.habitacion"))

# =========================================================================== bienestar
add(intent("spa.info", [
    "Spa", "¿tenéis spa?", "¿a qué hora abre el spa?", "precio del spa", "¿cuánto cuesta el circuito?",
    "¿qué tratamientos tenéis?", "¿cuánto cuesta un masaje?", "¿qué incluye el circuito spa?",
    "¿el spa está incluido?", "¿los niños pueden entrar al spa?", "¿hay que llevar gorro en el spa?",
    "¿hay sauna?", "¿tenéis jacuzzi?", "¿hay baño turco?", "¿el spa es gratis para huéspedes?",
    "¿puede ir alguien que no esté alojado al spa?", "carta de masajes", "horario del spa",
    "¿hay que reservar el spa?", "¿qué tengo que llevar al spa?", "¿qué masajes hacéis?",
], ["Mirador Spa 💆 abre de 10:00 a 21:00. El circuito (piscina climatizada, jacuzzi, sauna y baño turco, 90 min) "
    "cuesta 25 € para huéspedes y 35 € para externos. Masajes: relajante 65 €, descontracturante 70 €, piedras "
    "calientes 85 €, en pareja 125 € y tratamiento facial 55 €. Es para mayores de 16 años y el gorro es "
    "obligatorio (lo vendemos por 2 €). Mejor reservar con antelación."],
    quick=["Reservar en el spa"], action="spa.info"))

add(intent("spa.reservar", [
    "Reservar en el spa", "quiero reservar un [masaje](tratamiento)", "reserva de spa", "reservar spa",
    "quiero un [masaje relajante](tratamiento) para [mañana](fecha) a [las 11](hora)",
    "¿me reservas el [circuito](tratamiento) para [dos](personas) [el sábado](fecha)?",
    "quiero reservar un [facial](tratamiento)", "reservar [masaje en pareja](tratamiento) para [hoy](fecha)",
    "[dos](personas) entradas para el [circuito spa](tratamiento)",
    "me gustaría darme un [masaje](tratamiento) [hoy](fecha) a [las 6](hora)",
    "cita para un [masaje descontracturante](tratamiento)",
    "reservar las [piedras calientes](tratamiento) para [el domingo](fecha)",
    "quiero ir al spa [mañana](fecha) a [las 10:30](hora)", "pide cita en el spa",
    "reservar spa para [2](personas) personas", "¿hay hueco para un [masaje](tratamiento) [mañana](fecha)?",
    "quiero hacer el [circuito](tratamiento) [esta tarde](fecha)", "reserva un [masaje de espalda](tratamiento)",
    "queremos el [masaje para parejas](tratamiento) [el viernes](fecha) a [las 18:00](hora)",
], ["¡Reservado! 💆 Mirador Spa:\n✨ $tratamiento\n📅 $fecha a las $hora\n👥 Personas: $personas\nTe esperamos 10 "
    "minutos antes en la planta -1. Trae bañador; el gorro lo tenemos allí."],
    params=[param("tratamiento", "@tratamiento", True, [
        "¿Qué te gustaría reservar? Tenemos circuito spa, masaje relajante, descontracturante, con piedras calientes, "
        "en pareja o tratamiento facial."]),
        param("fecha", "@sys.date", True, ["¿Para qué día?"]),
        param("hora", "@sys.time", True, ["¿A qué hora? El spa abre de 10:00 a 21:00."]),
        param("personas", "@sys.number", default="1")],
    action="spa.reserva"))

add(intent("piscina.info", [
    "Piscina", "¿tenéis piscina?", "¿a qué hora abre la piscina?", "¿la piscina está climatizada?",
    "¿hay piscina cubierta?", "horario de la piscina", "¿dan toallas para la piscina?",
    "¿la piscina está abierta en invierno?", "¿hay hamacas?", "¿pueden bañarse los niños?", "¿hay socorrista?",
    "¿se puede comer en la piscina?", "¿dónde está la piscina?", "infinity pool", "¿la piscina tiene vistas?",
    "¿hay que reservar hamaca?", "¿puedo usar la piscina el día de salida?", "¿la piscina es grande?",
], ["Tenemos piscina en la azotea 🏊 con vistas al mar, abierta de mayo a octubre de 10:00 a 20:00, con socorrista y "
    "hamacas (no hace falta reservar). Las toallas de piscina te las dan en el propio acceso. En invierno puedes "
    "usar la piscina climatizada del spa. Los niños pueden bañarse acompañados de un adulto, y el día de salida "
    "también puedes usarla."], action="piscina.info"))

add(intent("gimnasio.info", [
    "gimnasio", "¿tenéis gimnasio?", "gym", "¿a qué hora abre el gimnasio?", "¿el gimnasio es gratis?",
    "¿qué máquinas hay en el gimnasio?", "¿hay clases de yoga?", "¿puedo hacer deporte en el hotel?",
    "¿hay entrenador personal?", "¿el gimnasio abre 24 horas?", "¿dónde puedo salir a correr?",
    "¿hay pista de tenis?", "¿hay bicicletas estáticas?", "fitness",
], ["El gimnasio 🏋️ está en la planta -1, abierto las 24 horas y gratis para huéspedes (se entra con la tarjeta de la "
    "habitación). Tiene cintas, bicis, elíptica, pesas y zona de estiramientos. Los sábados a las 9:00 hay yoga en "
    "la azotea, y para correr, el paseo marítimo es perfecto. 🏃"], action="gimnasio.info"))

# =========================================================================== en la habitación
add(intent("habitacion.peticion", [
    "Pedir algo a la habitación", "necesito que me subáis una cosa", "¿me podéis subir algo a la habitación?",
    "necesito [toallas](objeto)", "¿me podéis subir una [almohada](objeto)?",
    "[2](cantidad) [toallas](objeto) más para la [304](habitacion_num) por favor",
    "¿me traéis una [manta](objeto) a la habitación [215](habitacion_num)?",
    "en la [512](habitacion_num) necesitamos [papel higiénico](objeto)", "me falta el [secador de pelo](objeto)",
    "necesito una [plancha](objeto)", "¿podéis subir una [cuna](objeto) a la [108](habitacion_num)?",
    "quiero una [cama supletoria](objeto)",
    "¿tenéis un [adaptador de enchufe](objeto)? estoy en la [401](habitacion_num)",
    "se me ha olvidado el [cargador](objeto), ¿tenéis alguno?", "necesito un [cepillo de dientes](objeto)",
    "¿me subís [hielo](objeto)?", "faltan [perchas](objeto) en el armario",
    "habitación [310](habitacion_num): [toallas](objeto) y [almohadas](objeto) por favor",
    "¿pueden traer [albornoces](objeto)?", "quiero [gel y champú](objeto)",
    "me hace falta otra [manta](objeto), tengo frío", "traedme [botellas de agua](objeto) a la [207](habitacion_num)",
    "¿me prestáis una [maquinilla de afeitar](objeto)?", "no hay [toallas](objeto) en mi habitación",
    "necesitamos [3](cantidad) [almohadas](objeto) más", "¿me subís una [trona](objeto)?",
    "estoy en la [115](habitacion_num) y me hace falta un [secador](objeto)",
    "¿me mandáis [toallas limpias](objeto)?", "necesito un [kit de costura](objeto)",
], ["¡Ahora mismo! 🛎️ Te subimos $objeto a la habitación $habitacion_num en unos minutos."],
    params=[param("objeto", "@objeto", True, ["¿Qué necesitas que te subamos? Por ejemplo: toallas, una almohada, una "
                                               "manta, el secador…"], is_list=True),
            param("cantidad", "@sys.number"), P_HAB_NUM],
    action="habitacion.peticion"))

add(intent("habitacion.limpieza", [
    "limpieza de la habitación", "¿a qué hora limpian la habitación?", "¿pueden limpiar mi habitación?",
    "no han limpiado mi habitación", "quiero que limpien ahora", "no quiero que limpien hoy",
    "¿cada cuánto cambiáis las sábanas?", "¿cambian las toallas todos los días?", "la habitación está sucia",
    "cartel de no molestar", "¿podéis hacer la cama?", "¿se puede pedir limpieza por la tarde?",
    "servicio de limpieza", "¿pueden pasar a limpiar más tarde?", "cambio de sábanas",
], ["Limpiamos las habitaciones cada día entre las 10:00 y las 15:00 🧹; las sábanas se cambian cada 2 días y las "
    "toallas, cuando las dejes en el suelo. Si prefieres que no pasemos, cuelga el cartel de «No molestar». Para "
    "que limpien a otra hora o si algo no está bien, dímelo con tu número de habitación y aviso a pisos."],
    action="habitacion.limpieza"))

add(intent("habitacion.averia", [
    "[el aire acondicionado](averia) no funciona", "no funciona [la tele](averia)",
    "[la ducha](averia) no tiene agua caliente", "se ha roto [la cerradura](averia)",
    "no va [el wifi](averia) en la habitación [305](habitacion_num)", "tengo un problema con [la luz](averia)",
    "[el váter](averia) está atascado", "hay una avería en mi habitación", "algo no funciona en la habitación",
    "[la tarjeta](averia) no abre la puerta", "no puedo abrir [la caja fuerte](averia)",
    "[la calefacción](averia) no calienta", "hay una gotera en el baño", "[el minibar](averia) no enfría",
    "en la [412](habitacion_num) no funciona [el aire](averia)", "[la persiana](averia) está rota",
    "no sale [agua caliente](averia)", "[el enchufe](averia) no da corriente",
    "hace mucho ruido [el aire acondicionado](averia)", "[el mando de la tele](averia) no va",
    "se ha fundido [la bombilla del baño](averia)", "necesito que venga alguien de mantenimiento",
    "se ha estropeado [la cafetera](averia)", "mantenimiento", "avisar de una avería",
    "[la puerta del balcón](averia) no cierra bien", "se ha atascado [el lavabo](averia)",
    "estoy en la [220](habitacion_num) y [el secador](averia) no funciona",
], ["Siento mucho las molestias 🔧. He avisado a mantenimiento para que revisen $averia en la habitación "
    "$habitacion_num; subirán en unos 15 minutos. Si es urgente, marca el 9 desde el teléfono de la habitación."],
    params=[param("averia", "@sys.any", True, ["Vaya, lo siento 😟 ¿Qué es lo que no funciona?"]),
            param("habitacion_num", "@sys.number", True, ["¿En qué habitación estás? Aviso a mantenimiento ahora "
                                                          "mismo."])],
    action="habitacion.averia"))

add(intent("habitacion.cambio", [
    "quiero cambiarme de habitación", "¿puedo cambiar de habitación?", "no me gusta la habitación",
    "la habitación es muy ruidosa, quiero otra", "quiero una habitación más tranquila",
    "¿me podéis dar otra habitación?", "quiero otra habitación con vistas", "la habitación huele a tabaco",
    "estoy en la [208](habitacion_num) y quiero cambiarme", "quiero mudarme a otra habitación",
    "¿hay alguna habitación más grande disponible?", "mejorar mi habitación", "upgrade",
    "¿puedo pasarme a la suite?", "la habitación da a la calle y hay mucho ruido, ¿me cambiáis?",
], ["Siento que no estés a gusto 😔. He pedido a recepción que te busque otra habitación (ahora estás en la "
    "$habitacion_num); te llamarán en unos minutos con las opciones. Si te apetece pasar a una con vistas al mar o "
    "a la suite, el cambio tiene un pequeño suplemento."],
    params=[param("habitacion_num", "@sys.number", True, ["¿En qué habitación estás ahora?"])],
    action="habitacion.cambio"))

add(intent("queja.ruido", [
    "hay mucho ruido", "los vecinos de al lado hacen mucho ruido", "no puedo dormir por el ruido",
    "hay una fiesta en la habitación de al lado", "se oye música muy alta", "ruido en el pasillo",
    "los de arriba no paran de hacer ruido", "hay gente gritando en el pasillo",
    "en la [305](habitacion_num) no podemos dormir por el ruido", "molestan mucho los de la habitación de al lado",
    "están dando golpes en la pared", "un perro no para de ladrar", "queja por ruido", "qué escándalo hay fuera",
], ["Lo siento muchísimo 😔. He avisado a seguridad para que lo resuelvan ahora mismo (habitación "
    "$habitacion_num). Si el ruido continúa o prefieres cambiarte a una habitación más tranquila, dímelo o marca el "
    "9."],
    params=[param("habitacion_num", "@sys.number", True, ["Lo siento mucho. ¿En qué habitación estás? Aviso ahora "
                                                          "mismo a seguridad."])],
    action="queja.ruido"))

add(intent("queja.general", [
    "quiero poner una queja", "quiero hacer una reclamación", "hoja de reclamaciones", "estoy muy descontento",
    "el servicio ha sido pésimo", "no estoy contento con la estancia", "la habitación no es como en las fotos",
    "el personal ha sido muy borde", "me habéis cobrado de más", "estoy muy enfadado", "esto es una vergüenza",
    "queja", "quiero hablar con el director", "el desayuno era malísimo", "me han tratado fatal en recepción",
    "no volveré nunca", "quiero que me devuelvan el dinero", "estoy decepcionado con el hotel",
    "qué asco de servicio",
], ["Siento mucho que tu experiencia no esté siendo buena 😔; nos lo tomamos muy en serio. He trasladado tu queja al "
    "jefe de recepción. Si quieres, te llamamos ahora mismo para resolverlo, o puedes pedir la hoja de reclamaciones "
    "oficial en recepción."],
    quick=["Quiero que me llamen", "Hablar con recepción"], action="queja.general"))

add(intent("objetos.perdidos", [
    "he perdido algo", "objetos perdidos", "me he dejado el cargador en la habitación",
    "creo que me dejé una chaqueta", "he perdido la cartera en el hotel", "¿habéis encontrado unas gafas?",
    "me olvidé el móvil en el restaurante", "me dejé algo en la habitación al irme", "¿tenéis mis auriculares?",
    "perdí un anillo en la piscina", "me he dejado el pasaporte en la caja fuerte", "se me olvidó ropa en el armario",
    "¿podéis enviarme algo que me dejé?", "he perdido las llaves del coche",
], ["¡Vaya! 😟 Guardamos los objetos olvidados durante 3 meses. Escríbenos a recepcion@hotelmirador.example con tu "
    "nombre, las fechas de tu estancia y una descripción; si aparece, te lo guardamos o te lo enviamos por "
    "mensajería. Si sigues en el hotel, pregunta directamente en recepción."], action="objetos.perdidos"))

# =========================================================================== servicios
add(intent("servicio.despertador", [
    "llamada despertador", "¿me podéis despertar mañana?", "quiero que me despierten a [las 7](hora)",
    "despertador a [las 6:30](hora) en la [203](habitacion_num)", "despiértame a [las ocho](hora)",
    "necesito que me llaméis a [las 5 de la mañana](hora) para despertarme", "¿hacéis servicio de despertador?",
    "quiero una llamada para despertarme a [las 7 y media](hora)",
    "[mañana](fecha) tengo que levantarme a [las 6](hora), ¿me llamáis?",
    "despertar a [las 9](hora) en la habitación [118](habitacion_num)", "pon un despertador a [las 7:15](hora)",
    "¿me despertáis a [las 8 y cuarto](hora)?", "servicio de despertador",
], ["¡Hecho! ⏰ Te llamaremos a las $hora para despertarte (habitación $habitacion_num). ¡Que descanses!"],
    params=[param("hora", "@sys.time", True, ["¿A qué hora quieres que te despertemos?"]), P_HAB_NUM,
            param("fecha", "@sys.date")],
    action="servicio.despertador"))

add(intent("servicio.taxi", [
    "pedir un taxi", "¿me pedís un taxi?", "necesito un taxi", "llamad a un taxi por favor", "quiero un taxi para las 8",
    "un taxi a la estación", "¿cuánto tarda en venir un taxi?", "necesito ir al centro en taxi", "pídeme un uber",
    "¿hay taxis en la puerta?", "taxi ya", "taxi para dos personas", "¿me podéis pedir un taxi para mañana?",
    "¿me llamáis a un taxi?",
], ["¡Claro! 🚕 Recepción te pide el taxi y te avisa cuando esté en la puerta (si es para ahora, suele tardar unos 10 "
    "minutos). Al aeropuerto cuesta unos 25 € y al centro, unos 8 €."], action="servicio.taxi"))

add(intent("servicio.traslado", [
    "Reservar traslado", "Traslado desde el aeropuerto", "quiero reservar un traslado", "reservar el transfer",
    "necesito transporte [al aeropuerto](trayecto)", "¿me podéis [recoger en el aeropuerto](trayecto)?",
    "traslado [desde el aeropuerto](trayecto) [mañana](fecha) a [las 10](hora)",
    "quiero que me [llevéis al aeropuerto](trayecto) [el domingo](fecha) a [las 7 de la mañana](hora)",
    "reserva un traslado [al aeropuerto](trayecto) para [3](personas) personas",
    "¿podéis venir a [buscarnos al aeropuerto](trayecto)?", "traslado privado para [4](personas)",
    "¿me reservas el transfer [al aeropuerto](trayecto)?", "transfer",
    "necesito un traslado [el sábado](fecha) [al aeropuerto](trayecto) a [las 5 de la mañana](hora)",
    "reservar coche [hasta el aeropuerto](trayecto)", "quiero la [recogida en el aeropuerto](trayecto)",
    "aterrizamos [el viernes](fecha) a [las 18:30](hora), ¿nos [recogéis](trayecto)?",
    "[llevarnos al aeropuerto](trayecto) [mañana](fecha) a [las 12](hora), somos [2](personas)",
    "reservar traslado [del aeropuerto al hotel](trayecto)",
], ["¡Traslado reservado! 🚐\n🛫 $trayecto\n📅 $fecha a las $hora\n👥 Personas: $personas\nCuesta 35 € (hasta 3 "
    "personas) o 55 € (hasta 7) y se paga en recepción. Si vienes del aeropuerto, el conductor te esperará en "
    "llegadas con un cartel con tu nombre."],
    params=[param("trayecto", "@trayecto", True, ["Tenemos traslado privado (15 minutos): 35 € hasta 3 personas o 55 € "
                                                   "hasta 7. ¿Es para venir del aeropuerto al hotel o para ir al "
                                                   "aeropuerto?"]),
            param("fecha", "@sys.date", True, ["¿Para qué día?"]),
            param("hora", "@sys.time", True, ["¿A qué hora? Si es la recogida, dime la hora a la que aterriza tu "
                                              "vuelo."]),
            param("personas", "@sys.number", True, ["¿Cuántas personas sois?"])],
    action="servicio.traslado"))

add(intent("servicio.traslado.info", [
    "¿tenéis traslado al aeropuerto?", "¿cuánto cuesta el traslado?", "¿cómo llego desde el aeropuerto?",
    "precio del transfer", "¿hay servicio de lanzadera?", "¿cuánto se tarda al aeropuerto?",
    "¿el traslado está incluido?", "¿tenéis shuttle?", "¿cómo voy del aeropuerto al hotel?",
    "¿hay bus del aeropuerto al hotel?", "¿cuánto cuesta un taxi desde el aeropuerto?", "¿a cuánto está el aeropuerto?",
    "aeropuerto", "¿cómo se llega desde el aeropuerto?", "¿hay tren desde el aeropuerto?",
], ["El aeropuerto está a 15 minutos en coche ✈️. Opciones:\n• Traslado privado del hotel: 35 € (hasta 3 personas) o "
    "55 € (hasta 7); resérvalo con 24 h de antelación.\n• Taxi: unos 25 €.\n• Tren de cercanías (línea C1) hasta el "
    "centro (12 minutos) y desde allí 15 minutos andando."],
    quick=["Reservar traslado"], action="servicio.traslado.info"))

# =========================================================================== información
add(intent("info.servicios", [
    "Servicios del hotel", "¿qué servicios tenéis?", "¿qué tiene el hotel?", "instalaciones", "¿qué hay en el hotel?",
    "¿qué incluye el hotel?", "¿qué instalaciones hay?", "información del hotel", "cuéntame sobre el hotel",
    "¿qué ofrece el hotel?", "¿cuántas estrellas tiene el hotel?", "¿cómo es el hotel?", "háblame del hotel",
    "servicios", "quiero información sobre el hotel",
], ["El Hotel Mirador ★★★★ tiene 86 habitaciones frente al mar y además:\n🍽️ Restaurante La Terraza y bar en la "
    "azotea\n🏊 Piscina en la azotea (de mayo a octubre)\n💆 Spa con circuito y masajes\n🏋️ Gimnasio 24 h\n🚗 Parking "
    "(22 €/día)\n📶 Wifi gratis\n🐶 Admitimos mascotas\n🛎️ Recepción 24 h, consigna y traslado al aeropuerto\n"
    "¿Sobre qué quieres saber más?"],
    quick=["Restaurante", "Spa", "Piscina", "Parking"], action="info.servicios"))

add(intent("info.ubicacion", [
    "Cómo llegar", "¿dónde estáis?", "dirección del hotel", "¿cuál es la dirección?", "ubicación",
    "¿cómo llego al hotel?", "¿dónde está el hotel?", "¿estáis cerca de la playa?", "¿estáis en el centro?",
    "¿cómo se llega en coche?", "¿a cuánto está el centro?", "mándame la ubicación",
    "¿está lejos de la estación de tren?", "¿cómo llego desde la estación?", "google maps",
    "¿en qué calle está?", "¿cerca de qué está el hotel?", "¿la zona es tranquila?",
    "¿se puede ir andando al centro?", "¿en qué barrio estáis?",
], ["Estamos en el Paseo del Mirador, 12 (29016 Málaga), frente a la playa de la Malagueta 📍. El centro histórico "
    "está a 10 minutos andando, el Muelle Uno a 5 y la estación de tren María Zambrano a 10 minutos en taxi. En "
    "coche, sigue las indicaciones a «Puerto / Malagueta»; tenemos parking propio. Mapa: "
    "hotelmirador.example/como-llegar"], action="info.ubicacion"))

add(intent("info.contacto", [
    "teléfono del hotel", "¿cuál es vuestro teléfono?", "¿cómo os puedo contactar?", "email del hotel",
    "correo electrónico del hotel", "¿tenéis whatsapp?", "número de recepción", "contacto", "¿a qué email escribo?",
    "¿cuál es la web?", "redes sociales", "instagram del hotel", "¿puedo llamar por teléfono?",
], ["Puedes contactarnos las 24 horas en el 📞 952 123 456 o por WhatsApp en el 600 123 456. Email: "
    "reservas@hotelmirador.example (reservas) o recepcion@hotelmirador.example (todo lo demás). Web: "
    "hotelmirador.example, y en Instagram somos @hotelmirador."], action="info.contacto"))

add(intent("contacto.humano", [
    "Hablar con recepción", "quiero hablar con una persona", "pásame con un humano", "¿puedo hablar con alguien?",
    "quiero hablar con un agente", "no quiero hablar con un robot", "atención al cliente", "operador",
    "persona real por favor", "pásame con el encargado", "quiero hablar con alguien de verdad",
    "comunícame con recepción", "necesito hablar con un empleado", "prefiero hablar con una persona",
], ["¡Claro! Recepción está disponible las 24 horas: llama al 📞 952 123 456 (o marca el 9 desde tu habitación) o "
    "escríbenos por WhatsApp al 600 123 456. Si lo prefieres, déjame tu teléfono y te llamamos nosotros."],
    quick=["Quiero que me llamen"], action="contacto.humano"))

add(intent("contacto.llamada", [
    "Quiero que me llamen", "¿me podéis llamar?", "llamadme por favor", "que me llame alguien",
    "llámame al [612345678](telefono)", "mi teléfono es [654 321 987](telefono)", "¿podéis llamarme más tarde?",
    "prefiero que me llaméis", "devolvedme la llamada", "quiero que me llame el jefe de recepción",
    "contactadme por teléfono", "mi número es [+34 699 112 233](telefono)", "llamadme al [611 223 344](telefono)",
], ["¡Perfecto! 📞 Te llamaremos al $telefono en menos de 30 minutos (de 9:00 a 22:00). Si es urgente, también "
    "puedes llamar tú al 952 123 456."],
    params=[param("telefono", "@sys.phone-number", True, ["¡Claro! ¿A qué número te llamamos?"])],
    action="contacto.llamada"))

add(intent("opinion.positiva", [
    "me ha encantado el hotel", "todo genial", "la estancia ha sido perfecta", "muy buen hotel",
    "el personal es muy amable", "volveremos seguro", "el desayuno estaba buenísimo", "la habitación es preciosa",
    "qué vistas tan bonitas", "estamos encantados", "enhorabuena por el hotel", "un hotel de diez",
    "muy recomendable", "nos lo hemos pasado genial", "repetiremos",
], ["¡Muchísimas gracias! 🥰 Nos hace muy felices leer eso. Si te apetece, nos ayudaría mucho una reseña en Google o "
    "TripAdvisor. ¡Te esperamos pronto!"], action="opinion.positiva"))

add(intent("info.transporte", [
    "¿cómo me muevo por málaga?", "transporte público", "¿hay autobús cerca?", "parada de autobús",
    "¿dónde está la estación de tren?", "¿cómo voy al centro?", "alquiler de coches", "¿puedo alquilar un coche?",
    "¿alquiláis bicicletas?", "bicis", "patinetes", "¿hay metro?", "¿cómo llego a la estación de autobuses?",
    "¿cuánto cuesta un taxi al centro?", "¿hay uber en málaga?", "¿cómo voy a granada?", "tren a madrid",
], ["Málaga se recorre muy bien andando 🚶: el centro está a 10 minutos. La parada de autobús (líneas al centro y a la "
    "estación) está a 100 m, el taxi al centro cuesta unos 8 € y la estación de tren María Zambrano está a 10 "
    "minutos en taxi. Prestamos bicicletas gratis a huéspedes (3 horas) y en recepción te gestionamos un coche de "
    "alquiler con un día de antelación."], action="info.transporte"))

add(intent("info.turismo", [
    "¿qué puedo ver en málaga?", "¿qué visitar?", "lugares de interés", "¿qué me recomiendas visitar?", "monumentos",
    "¿qué hacer en málaga?", "planes para hoy", "me aburro", "¿qué puedo hacer esta tarde?", "museos",
    "¿merece la pena la alcazaba?", "¿dónde está el museo picasso?", "turismo", "¿qué ver en un día?",
    "rutas por málaga", "visita guiada", "¿hay algún free tour?", "sitios bonitos para hacer fotos",
    "¿qué hay cerca del hotel para visitar?", "¿qué me recomiendas hacer?",
], ["¡Málaga tiene mucho que ver! 🏛️ A menos de 20 minutos andando: la Alcazaba y el Teatro Romano, el castillo de "
    "Gibralfaro (vistas espectaculares), la Catedral, el Museo Picasso, el Centre Pompidou en el Muelle Uno y la "
    "calle Larios para ir de compras. En recepción te damos un mapa con nuestras rutas favoritas, te reservamos "
    "visitas guiadas y tenemos la agenda cultural de la semana (conciertos, teatro y fiestas)."],
    quick=["Playas", "Excursiones", "Dónde comer"], action="info.turismo"))

add(intent("info.playas", [
    "Playas", "¿está cerca la playa?", "¿cuál es la playa más cercana?", "¿qué playas me recomiendas?",
    "playa de la malagueta", "¿hay playas bonitas cerca?", "¿se puede ir andando a la playa?",
    "¿dejáis sombrillas para la playa?", "¿la playa tiene bandera azul?", "¿dónde hay chiringuitos?",
    "¿hay calas cerca?", "pedregalejo", "¿cómo es la playa?", "¿hay playa para ir con niños?",
], ["La playa de la Malagueta está justo enfrente del hotel 🏖️ (bandera azul, con hamacas y chiringuitos). A 15 "
    "minutos en bus tienes Pedregalejo y El Palo, perfectas para comer espetos. Si buscas calas, las de Nerja y Maro "
    "(a 50 minutos) son preciosas. Te prestamos toallas de playa y sombrilla en recepción."], action="info.playas"))

add(intent("info.restaurantes_cerca", [
    "Dónde comer", "¿dónde puedo comer cerca?", "recomiéndame un restaurante", "¿dónde se come bien en málaga?",
    "bares de tapas", "¿dónde tomo unas tapas?", "restaurantes cerca del hotel", "¿dónde puedo comer pescaíto frito?",
    "¿dónde como espetos?", "¿algún sitio para cenar barato?", "comida típica de málaga",
    "¿hay algún restaurante italiano cerca?", "¿dónde puedo desayunar fuera?", "heladerías",
    "sitio para cenar con niños", "¿me recomiendas algún bar?",
], ["Te recomendamos 😋: tapas en el centro (zona de la calle Larios y alrededores), espetos de sardinas en los "
    "chiringuitos de Pedregalejo y pescaíto frito en El Palo. En recepción tenemos una lista de nuestros sitios "
    "favoritos y te reservamos mesa. Y si no te apetece salir, nuestro restaurante La Terraza también es una gran "
    "opción."], action="info.restaurantes_cerca"))

add(intent("info.excursiones", [
    "Excursiones", "¿qué excursiones hay?", "caminito del rey", "¿cómo ir a ronda?", "excursión a granada",
    "visitar la alhambra", "¿organizáis excursiones?", "excursión de un día", "nerja", "cuevas de nerja",
    "¿qué pueblos bonitos hay cerca?", "tour por la costa del sol", "¿podéis reservarme una excursión?", "marbella",
    "frigiliana", "avistamiento de delfines", "¿qué hacer fuera de málaga?",
], ["Desde Málaga hay excursiones geniales 🚌: el Caminito del Rey (1 h), Ronda (1 h 30), Nerja y sus cuevas (50 min), "
    "Frigiliana, Marbella o la Alhambra de Granada (1 h 30; las entradas, con antelación). En recepción te reservamos "
    "excursiones con recogida en el hotel o un coche de alquiler."], action="info.excursiones"))

add(intent("info.tiempo", [
    "¿qué tiempo hace?", "¿qué tiempo va a hacer mañana?", "¿va a llover?", "previsión del tiempo",
    "¿hace calor en málaga?", "¿hace frío?", "temperatura", "¿se puede ir a la playa en octubre?",
    "¿qué ropa me llevo?", "el tiempo en málaga", "¿llueve mucho en málaga?", "¿hace sol?",
    "¿qué temperatura tiene el agua del mar?", "¿hará buen tiempo el fin de semana?",
], ["Málaga tiene más de 300 días de sol al año ☀️: en verano rondamos los 30 °C y en invierno unos 17 °C de día. "
    "Para la previsión exacta te recomiendo la web de AEMET. Y trae bañador: ¡la piscina del spa está climatizada "
    "todo el año!"], action="info.tiempo"))

add(intent("info.eventos", [
    "salones para eventos", "¿organizáis bodas?", "quiero celebrar una boda", "sala de reuniones",
    "¿tenéis salas para congresos?", "evento de empresa", "comunión", "celebrar un cumpleaños en el hotel",
    "cena de empresa", "¿alquiláis salones?", "despedida de soltera", "presupuesto para un evento",
    "reunión de trabajo para 30 personas", "team building",
], ["Organizamos bodas, eventos de empresa y celebraciones 🎉 en salones de 10 a 120 personas, con catering propio y "
    "la azotea para cócteles con vistas al mar. Escríbenos a eventos@hotelmirador.example con la fecha, el número de "
    "invitados y tu idea, y te preparamos un presupuesto."], action="info.eventos"))

add(intent("info.bonos_regalo", [
    "tarjeta regalo", "¿tenéis bonos regalo?", "quiero regalar una noche de hotel", "regalar un masaje",
    "cheque regalo", "vale regalo para el spa", "regalo de cumpleaños", "¿cómo compro un bono regalo?",
    "regalar una cena", "¿cuánto dura el bono regalo?", "tengo un bono regalo, ¿cómo lo uso?",
], ["¡Claro! 🎁 Tenemos tarjetas regalo para estancias, el spa o cenas en La Terraza, del importe que quieras. Se "
    "compran en hotelmirador.example/regalo o en recepción, se envían al momento por email y son válidas 1 año. "
    "Para usar una, indica el código al reservar."], action="info.bonos_regalo"))

add(intent("info.empleo", [
    "¿estáis contratando?", "quiero trabajar en el hotel", "trabajo", "ofertas de empleo",
    "¿dónde mando mi currículum?", "prácticas en el hotel", "¿buscáis camareros?", "empleo", "quiero enviar mi cv",
    "trabajar de recepcionista", "¿necesitáis personal para el verano?",
], ["¡Gracias por pensar en nosotros! 💼 Envía tu currículum a empleo@hotelmirador.example indicando el puesto que te "
    "interesa. Publicamos las ofertas en hotelmirador.example/empleo, sobre todo en primavera para la temporada de "
    "verano."], action="info.empleo"))

add(intent("info.cerca", [
    "¿hay una farmacia cerca?", "cajero automático", "¿dónde hay un cajero?", "supermercado cercano",
    "¿hay un estanco cerca?", "¿dónde cambio dinero?", "casa de cambio", "¿hay tiendas cerca?",
    "¿dónde compro protector solar?", "farmacia de guardia", "¿hay un banco cerca?", "¿dónde puedo comprar comida?",
], ["Muy cerca del hotel tienes 🏪: farmacia a 3 minutos andando (en recepción te indicamos la de guardia), cajero "
    "automático a 100 m, supermercado a 5 minutos y estanco en la misma calle. Para cambiar divisas, hay una oficina "
    "de cambio en la calle Larios."], action="info.cerca"))

add(intent("info.urgencias", [
    "urgencia", "necesito un médico", "emergencia", "me encuentro mal", "¿hay un hospital cerca?",
    "me he hecho daño", "necesito una ambulancia", "mi hijo tiene fiebre", "¿hay médico en el hotel?",
    "me ha picado una medusa", "socorro", "ayuda urgente", "me duele mucho la cabeza", "dentista",
    "me he caído", "creo que tengo una intoxicación",
], ["Si es una emergencia, llama al 112 🚑 y avisa a recepción marcando el 9: te ayudamos al momento. Podemos llamar a "
    "un médico para que venga a tu habitación, y el hospital más cercano está a 10 minutos en taxi. La farmacia está "
    "a 3 minutos andando."], action="info.urgencias"))

# =========================================================================== más formas de decirlo
# Cuantas más maneras distintas de pedir lo mismo, mejor entiende frases que nunca ha visto.
MAS_FRASES = {
    "saludo": ["holaaa, buenas", "buenas, ¿qué tal?", "hola, ¿hay alguien para ayudarme?", "hola, buenas noches",
               "saludos cordiales", "buenas a todos", "qué tal, buenas tardes", "hola, ¿se puede?", "hola otra vez"],
    "saludo.que_tal": ["¿qué tal vas?", "¿cómo vas?", "¿cómo estás, mira?", "¿qué tal llevas el día?", "¿y tú qué tal?",
                       "¿tú cómo estás?", "¿estás bien hoy?", "¿cómo te sientes?"],
    "agradecimiento": ["muchas gracias, de verdad", "gracias, qué amable", "se agradece", "gracias por contestar",
                       "genial, mil gracias", "gracias, me sirve", "gracias por atenderme", "perfecto, muchísimas gracias"],
    "despedida": ["adiós y gracias", "hasta luego, gracias", "bueno, ya está, adiós", "nos vemos pronto", "chao, gracias",
                  "hasta la vista", "que tengas buen día", "me tengo que ir, adiós"],
    "bot.identidad": ["¿hablo con una persona o con una máquina?", "¿eres humano o máquina?", "¿me atiende un robot?",
                      "¿eres una persona de verdad?", "¿estoy hablando con alguien real?", "¿eres un asistente virtual?",
                      "¿qué tipo de programa eres?", "¿eres un chatbot?", "dime tu nombre", "¿quién me está contestando?"],
    "charla.personal": ["¿estás casada?", "¿tienes pareja o estás soltera?", "¿qué canciones te gustan?", "¿escuchas música?",
                        "¿cuál es tu grupo favorito?", "¿qué series ves?", "¿te gusta viajar?", "¿te gusta tu trabajo?",
                        "¿qué haces cuando no hay nadie?", "¿cuál es tu canción favorita?"],
    "bot.ayuda": ["¿en qué me puedes echar una mano?", "¿qué haces tú?", "¿qué funciones tienes?", "¿cómo me puedes ayudar?",
                  "explícame qué puedes hacer", "¿para qué estás?", "¿con qué me ayudas?"],
    "charla.cumplido": ["me encanta cómo me atiendes", "qué bien me ayudas", "me ayudas un montón, eres genial",
                        "eres la caña", "eres un amor", "qué eficiente eres", "eres un encanto"],
    "charla.insulto": ["no vales nada", "inservible", "qué porquería", "porquería de bot", "basura de asistente",
                       "eres un asco", "vaya robot más inútil", "eres malísima"],
    "charla.risa": ["jajajajajaja", "jaja no", "jaja vale vale", "me muero de risa", "qué risa"],
    "charla.chiste": ["cuéntame un chiste malo", "¿te sabes alguno gracioso?", "dime un chiste de hoteles",
                      "alégrame el día", "algo para reírme"],
    "charla.esperar": ["espera un poco", "un minuto", "dame un segundo que lo busco", "ahora lo miro y te digo",
                       "espérate un momento", "deja que lo compruebe"],
    "charla.afirmacion": ["vale, genial", "de acuerdo entonces", "perfecto, entendido", "ah, vale, perfecto",
                          "ok, ya lo tengo", "estupendo entonces"],
    "charla.negacion": ["no, gracias, ya está", "no, de verdad", "no, no hace falta nada", "no quiero", "para nada"],
    "charla.no_entiendo": ["no te sigo", "¿perdona?", "no entiendo lo que dices", "eso no es", "no me has entendido bien",
                           "explícamelo otra vez"],
    "charla.hora": ["¿qué hora tienes?", "dime qué día es", "¿hoy qué día es?", "¿es muy tarde?"],
    "reserva.habitacion": [
        "quiero reservar habitación para [el fin de semana](fecha_entrada) que viene",
        "¿tenéis una [doble](habitacion) libre [esta noche](fecha_entrada)?",
        "me gustaría hacer una reserva de [3](noches) noches", "¿hay hueco para [2](huespedes) personas?",
        "necesito reservar una [individual](habitacion)", "quiero dormir en vuestro hotel [el sábado](fecha_entrada)",
        "una [doble](habitacion) para [dos](huespedes), por favor", "¿me podéis reservar una habitación?",
        "queremos reservar [4](noches) noches en agosto",
        "busco una [habitación con vistas](habitacion) para [el viernes](fecha_entrada)",
        "quiero reservar en el hotel mirador", "¿tenéis habitaciones para [5](huespedes) personas?",
        "reserva de habitación para [la semana que viene](fecha_entrada), [2](huespedes) adultos",
        "querría una [suite](habitacion) [2](noches) noches", "hola, ¿puedo hacer una reserva?",
        "necesito hotel para [esta noche](fecha_entrada)", "quiero alojarme [3](noches) noches",
        "¿os quedan [dobles](habitacion) para [el 31 de diciembre](fecha_entrada)?",
        "reservar una habitación [triple](habitacion)", "habitación para [tres](huespedes)",
        "¿hay habitaciones libres [mañana](fecha_entrada)?", "quiero quedarme en el hotel",
    ],
    "reserva.habitacion.fechas": [
        "una habitación del [2](fecha_entrada) al [5 de septiembre](fecha_salida)",
        "reservar desde [el lunes](fecha_entrada) hasta [el jueves](fecha_salida)",
        "queremos ir del [20](fecha_entrada) al [25](fecha_salida)",
        "del [6](fecha_entrada) al [9 de octubre](fecha_salida), una [doble](habitacion)",
        "entrada [el viernes](fecha_entrada), salida [el lunes](fecha_salida)",
        "¿hay sitio entre [el 11](fecha_entrada) y [el 14 de abril](fecha_salida)?",
        "llegaríamos [el 2 de mayo](fecha_entrada) y saldríamos [el 5 de mayo](fecha_salida)",
        "para [dos](huespedes) del [27](fecha_entrada) al [30 de junio](fecha_salida)",
    ],
    "reserva.confirmar.si": ["perfecto, sí", "sí, genial", "sí, está perfecto", "perfecto", "vale", "ok", "de acuerdo",
                             "genial, confírmala", "está bien, resérvala", "sí, adelante"],
    "reserva.confirmar.no": ["no, mejor otro día", "no, espera", "no lo tengo claro", "nada, déjalo"],
    "reserva.cambiar": ["quiero cambiar algún dato", "cambiar datos de la reserva", "modifica la reserva",
                        "hay un dato mal", "quiero corregir algo"],
    "reserva.cambiar.fecha": ["cámbiala al [martes](fecha_entrada)", "mejor que sea [el 18 de octubre](fecha_entrada)",
                              "en realidad llegamos [el sábado](fecha_entrada)",
                              "pon la llegada [el 3 de diciembre](fecha_entrada)", "cambia el día de llegada"],
    "reserva.cambiar.personas": ["somos [5](huespedes) al final", "ponla para [dos](huespedes)",
                                 "cambia a [4](huespedes) huéspedes", "vamos a ser [tres](huespedes)",
                                 "al final iremos [2](huespedes)"],
    "reserva.cambiar.habitacion": ["mejor una [individual](habitacion)", "cámbiala por una [suite](habitacion)",
                                   "prefiero la [familiar](habitacion)", "quiero una [con vistas al mar](habitacion)",
                                   "pásala a [doble](habitacion)"],
    "reserva.cambiar.noches": ["que sean [3](noches)", "mejor [cinco](noches) noches", "pon solo [1](noches) noche",
                               "alarga la estancia a [4](noches) noches", "cambia las noches a [6](noches)"],
    "reserva.consultar": ["no he recibido el correo de confirmación", "no me llega el email de la reserva",
                          "¿podéis mirar si tengo reserva?", "comprobar mi reserva", "¿me confirmáis la reserva?",
                          "¿cómo sé si mi reserva está hecha?"],
    "reserva.modificar": ["quiero cambiar mi reserva de fecha", "modificar mi reserva, por favor", "¿cómo cambio mi reserva?",
                          "necesito mover mi reserva a otro día", "cambiar el número de personas de mi reserva"],
    "reserva.cancelar": ["cancela la reserva", "quiero cancelar", "anular mi reserva", "necesito cancelar mi reserva",
                         "ya no iremos, anula la reserva"],
    "reserva.cancelar.si": ["sí, quiero cancelarla", "adelante, anúlala", "sí, la cancelo"],
    "reserva.cancelar.no": ["no, me la quedo", "mejor no la canceles", "no, espera, que vamos"],
    "reserva.precios": ["¿qué precio tiene una noche?", "¿cuánto cuesta dormir aquí?", "precio de una noche en la doble",
                        "¿cuánto vale la habitación familiar?", "¿a cuánto sale la noche?", "tarifa por noche",
                        "¿cuál es el precio de la habitación?", "¿cuánto cuesta la habitación individual?"],
    "reserva.habitaciones": ["¿cómo es la habitación doble?", "¿cómo es la habitación familiar?", "¿cómo son las suites?",
                             "¿qué tiene la suite?", "¿qué tipo de camas hay?", "¿las habitaciones son amplias?",
                             "¿hay habitaciones para 4 personas?", "información de las habitaciones"],
    "reserva.politica_cancelacion": ["¿qué ocurre si anulo la reserva?", "si anulo la reserva, ¿me cobráis?",
                                     "¿tiene coste anular?", "¿hasta cuándo puedo anular gratis?",
                                     "¿perdería el dinero si cancelo?"],
    "reserva.pago": ["¿cómo pago la habitación?", "¿se puede pagar con visa?", "¿cuándo tengo que pagar?",
                     "¿se paga al hacer la reserva?", "¿aceptáis tarjetas?"],
    "reserva.ofertas": ["¿hay ofertas?", "¿tenéis descuento para socios?", "promociones", "¿algún descuento?",
                        "quiero usar un código descuento"],
    "reserva.grupos": ["reserva para muchas personas", "somos un grupo grande", "¿qué precio tenéis para grupos?"],
    "reserva.factura": ["quiero factura", "¿me hacéis factura?", "envíame la factura por email",
                        "¿podéis mandarme la factura a mi correo?"],
    "estancia.horarios": ["¿hay alguien en recepción por la noche?", "¿la recepción abre por la noche?",
                          "¿hay recepción nocturna?", "¿a qué hora puedo hacer el check in?", "¿hasta qué hora es la salida?",
                          "¿a qué hora abre la recepción?"],
    "estancia.checkin_anticipado": ["¿podemos llegar antes de la hora de entrada?", "llegaremos por la mañana, ¿podemos entrar?",
                                    "¿hay check in temprano?", "quiero entrar antes"],
    "estancia.checkout_tardio": ["¿podemos irnos más tarde?", "¿hasta qué hora podemos quedarnos el día de salida?",
                                 "quiero salir después de las 12", "salida tardía, ¿cuánto cuesta?"],
    "estancia.documentacion": ["¿qué hay que presentar al llegar?", "¿me pedís el pasaporte?",
                               "¿hace falta el dni de los niños?"],
    "estancia.equipaje": ["¿puedo dejar la maleta antes del check in?", "¿os dejo la maleta antes de entrar en la habitación?",
                          "¿hay sitio para guardar el equipaje?", "dejar maletas", "¿me guardáis la maleta hasta la tarde?"],
    "estancia.wifi": ["¿cómo conecto el móvil al wifi?", "¿cuál es la clave de internet?", "¿hay wifi gratuito?",
                      "datos del wifi"],
    "estancia.parking": ["¿dónde aparco?", "¿hay plazas de aparcamiento?", "¿tenéis plaza de garaje?",
                         "¿se puede aparcar en el hotel?"],
    "estancia.mascotas": ["¿puedo ir con mi perrito?", "¿aceptáis animales?", "¿se puede llevar al gato?", "voy con mi mascota"],
    "estancia.ninos": ["¿qué precio tiene la cama supletoria?", "¿cuánto se paga por la cama supletoria?",
                       "¿hay cunas para bebés?", "¿cuánto pagan los niños?", "¿tenéis actividades infantiles?"],
    "estancia.accesibilidad": ["¿hay habitaciones para minusválidos?", "¿se puede ir en silla de ruedas por el hotel?"],
    "estancia.fumar": ["¿hay sitio para fumar?", "¿se permite fumar?"],
    "estancia.lavanderia": ["¿lavan la ropa?", "¿tenéis lavadoras?"],
    "estancia.equipamiento": ["¿hay secador en el baño?", "¿la habitación tiene tele?", "¿hay nevera?",
                              "¿la habitación tiene aire acondicionado?"],
    "restaurante.desayuno": ["¿hasta qué hora hay desayuno?", "¿el desayuno se paga aparte?", "precio del desayuno",
                             "¿qué incluye el desayuno?"],
    "restaurante.info": ["¿hay restaurante?", "¿a qué hora abre el restaurante?", "¿qué hay de cenar?",
                         "¿tenéis comida sin gluten?"],
    "restaurante.reservar": ["reserva una mesa para dos", "quiero reservar para comer hoy a las 14:00",
                             "¿hay mesa libre para cenar?", "mesa para cuatro personas mañana", "reservar cena para el sábado",
                             "quiero cenar en el restaurante del hotel esta noche"],
    "restaurante.bar": ["¿hay bar en el hotel?", "¿tiene bar el hotel?", "¿dónde está el bar?",
                        "¿dónde se puede tomar un cóctel?"],
    "restaurante.habitacion": ["¿me suben la comida a la habitación?", "quiero pedir algo de comer a mi habitación",
                               "¿hay servicio de comida en la habitación?"],
    "spa.info": ["información del spa", "¿cuánto vale el circuito spa?", "¿hasta qué hora abre el spa?",
                 "¿qué servicios tiene el spa?"],
    "spa.reservar": ["quiero reservar en el spa para mañana", "reserva un facial para el lunes", "quiero un masaje",
                     "cita en el spa para dos", "reservar el circuito hoy a las 5"],
    "piscina.info": ["¿hay piscina en el hotel?", "¿cuándo abre la piscina?", "¿la piscina tiene agua caliente?"],
    "gimnasio.info": ["¿hay gimnasio?", "¿dónde está el gimnasio?", "¿puedo usar el gimnasio?"],
    "habitacion.peticion": ["quiero una [manta](objeto)", "quiero [toallas](objeto)", "quiero [otra almohada](objeto)",
                            "¿me podéis traer un [cargador](objeto)?",
                            "necesito [papel higiénico](objeto) en la [208](habitacion_num)",
                            "subidme [toallas](objeto) por favor", "¿podéis traer una [plancha](objeto) a mi habitación?",
                            "me faltan [perchas](objeto)"],
    "habitacion.limpieza": ["¿cuándo limpian?", "que pasen a limpiar", "quiero sábanas limpias"],
    "habitacion.averia": ["[el aire](averia) no se enciende", "[la luz](averia) no enciende",
                          "[la televisión](averia) no responde", "no funciona [la ducha](averia)",
                          "se ha roto [el grifo](averia)", "[la cisterna](averia) no funciona",
                          "hay un problema con [el aire acondicionado](averia)", "[la caja fuerte](averia) se ha bloqueado"],
    "habitacion.cambio": ["¿me cambiáis de habitación?", "quiero otra habitación, esta no me gusta",
                          "necesito cambiar de habitación"],
    "queja.ruido": ["qué ruido hay", "hay muchísimo ruido en mi habitación", "no se puede dormir con este ruido"],
    "queja.general": ["es inaceptable", "esto no puede ser", "es intolerable", "me quiero quejar", "tengo una queja",
                      "quiero presentar una queja"],
    "objetos.perdidos": ["me he dejado unas gafas", "he olvidado algo en el hotel", "¿se ha encontrado un reloj?"],
    "servicio.despertador": ["despertadme a [las 7](hora)", "¿me llamáis a [las 8](hora) para despertarme?",
                             "quiero que me despertéis mañana temprano"],
    "servicio.taxi": ["pídeme un taxi", "un taxi, por favor", "¿podéis llamar a un taxi?"],
    "servicio.traslado": ["quiero el traslado [al aeropuerto](trayecto)",
                          "reservar transfer [desde el aeropuerto](trayecto)", "necesito que me recojan en el aeropuerto"],
    "servicio.traslado.info": ["¿tenéis transfer?", "¿hay transfer desde el aeropuerto?",
                               "¿ofrecéis traslado desde el aeropuerto?", "¿cuánto vale el transfer?",
                               "¿cómo puedo ir del aeropuerto al hotel?"],
    "info.servicios": ["¿qué servicios ofrece el hotel?", "¿qué hay en las instalaciones?", "servicios que tenéis"],
    "info.ubicacion": ["¿dónde queda el hotel?", "dirección", "¿estáis lejos del centro?", "¿cómo se llega al hotel?"],
    "info.contacto": ["¿a qué correo escribo?", "¿cuál es vuestro correo?", "dirección de email", "¿tenéis teléfono?"],
    "contacto.humano": ["¿me pasas con recepción?", "quiero hablar con un humano", "hablar con alguien de recepción"],
    "contacto.llamada": ["¿me podéis llamar al móvil?", "llamadme cuando podáis"],
    "opinion.positiva": ["muy contentos con todo", "estamos muy contentos", "todo perfecto en la estancia",
                         "es un hotel maravilloso", "qué maravilla de hotel"],
    "info.transporte": ["¿cómo voy en autobús al centro?", "¿hay bicis para alquilar?", "¿cómo me desplazo por málaga?"],
    "info.turismo": ["¿qué hago hoy?", "¿qué hacemos esta noche?", "¿qué se puede hacer por la tarde?",
                     "¿qué sitios merecen la pena?"],
    "info.playas": ["¿hay playa cerca?", "¿a cuánto está la playa?"],
    "info.restaurantes_cerca": ["¿dónde puedo cenar por aquí?", "sitios para comer cerca", "¿algún restaurante bueno cerca?"],
    "info.excursiones": ["¿qué excursiones se pueden hacer?", "quiero hacer una excursión"],
    "info.tiempo": ["¿hace buen tiempo?", "¿qué tiempo hará?"],
    "info.eventos": ["¿hacéis bodas?", "quiero organizar una celebración"],
    "info.bonos_regalo": ["bono regalo", "¿vendéis tarjetas regalo?", "quiero regalar el spa a mi madre"],
    "info.empleo": ["¿buscáis personal?", "¿necesitáis gente?", "¿hay vacantes?", "busco trabajo"],
    "info.cerca": ["¿dónde hay una farmacia?", "¿hay cajeros cerca?"],
    "info.urgencias": ["necesito ayuda médica", "llamad a una ambulancia"],
    "Fallback": ["traduce esta frase al inglés", "cómo se dice adiós en italiano", "qué es el amor",
                 "quién descubrió américa", "cuántos planetas hay", "cómo funciona internet", "pon la radio",
                 "abre spotify", "dime un sinónimo de feliz"],
}

# segunda ronda: otros órdenes y palabras que faltaban (p. ej. «quejarme», que si no está en el
# vocabulario el corrector lo cambia por «quedarme» y la frase acaba en reservas)
MAS_FRASES_2 = {
    "habitacion.averia": ["no se enciende [la tele](averia)", "no va [la luz](averia) de la [304](habitacion_num)",
                          "[la tele](averia) de la [215](habitacion_num) no funciona", "tengo [la ducha](averia) rota",
                          "no tengo agua caliente", "no hay [luz](averia) en la habitación",
                          "[el baño](averia) está atascado", "no enciende [el aire acondicionado](averia)",
                          "en mi habitación no funciona [la calefacción](averia)", "se ha estropeado algo en la habitación",
                          "[el wifi](averia) de la habitación no va", "no puedo encender [la luz](averia)"],
    "queja.general": ["quiero quejarme", "quería quejarme de la limpieza", "necesito quejarme",
                      "me quiero quejar del servicio", "tengo que quejarme"],
    "habitacion.peticion": ["quiero un [adaptador](objeto)", "me hace falta un [secador de pelo](objeto)",
                            "¿me subís una [manta](objeto) a la [220](habitacion_num)?", "necesito [jabón](objeto)",
                            "¿podéis subir [toallas](objeto)?"],
    "estancia.ninos": ["¿disponéis de cunas?", "¿hay cuna para bebé?", "¿ponéis cuna en la habitación?"],
    "estancia.equipamiento": ["¿hay minibar en las habitaciones?", "¿las habitaciones tienen nevera?",
                              "¿qué hay en las habitaciones?", "¿la habitación tiene minibar?"],
    "info.contacto": ["email de reservas", "¿a qué correo mando la reserva?", "correo de reservas",
                      "¿cuál es el teléfono de reservas?"],
    "info.tiempo": ["¿hará calor?", "¿qué tiempo hace esta semana?", "¿va a hacer frío el fin de semana?"],
    "info.urgencias": ["me he cortado", "estoy sangrando", "me he quemado", "me ha dado un mareo",
                       "me he torcido el tobillo"],
    "charla.cumplido": ["qué buena asistente", "eres muy buena", "qué bien funcionas"],
    "charla.insulto": ["qué asistente más malo", "eres muy mala", "qué mal funcionas"],
    "Fallback": ["recomiéndame un videojuego", "recomiéndame una canción", "se me ha estropeado la lavadora de casa",
                 "mi nevera hace mucho ruido", "necesito un taxi en barcelona"],
}
# tercera ronda: más maneras de expresar lo mismo con otras palabras
MAS_FRASES_3 = {
    "charla.chiste": ["algo que me haga gracia", "dime algo gracioso", "quiero reírme un rato"],
    "charla.insulto": ["no sabes nada", "no tienes ni idea", "no sabes ni lo más básico"],
    "reserva.precios": ["¿cuánto cuestan las habitaciones?", "¿cuánto valen las suites?",
                        "¿qué valen las habitaciones dobles?"],
    "reserva.modificar": ["me he equivocado de día en la reserva", "reservé para un día que no era",
                          "quiero cambiar la fecha que puse en la reserva"],
    "reserva.politica_cancelacion": ["¿recupero el dinero si cancelo?", "¿hay reembolso si anulo?",
                                     "¿se devuelve el dinero al cancelar?"],
    "estancia.wifi": ["¿hay wifi en la terraza?", "¿llega el wifi a la azotea?", "¿va bien el wifi?"],
    "estancia.mascotas": ["¿hay problema si llevo a mi perro?", "¿puedo llevar mascota sin problema?", "voy con mi gato"],
    "queja.ruido": ["están de fiesta en la habitación de al lado", "hay una fiesta y no puedo dormir",
                    "los de al lado tienen fiesta"],
    "contacto.humano": ["¿me atiende alguien?", "¿alguien me puede atender?", "que me atienda una persona"],
    "info.urgencias": ["llevadme al hospital", "tengo que ir a urgencias", "¿dónde está el hospital?"],
    "opinion.positiva": ["lo hemos pasado muy bien", "nos lo pasamos fenomenal", "qué bien hemos estado"],
    "spa.info": ["precio de los masajes", "¿cuánto cuestan los tratamientos del spa?", "tarifas del spa",
                 "¿qué vale el circuito termal?"],
    "habitacion.averia": ["[el aire acondicionado](averia) hace mucho ruido", "[la nevera](averia) hace un ruido raro"],
    "charla.esperar": ["espera que le pregunto a mi marido", "lo pregunto y te digo", "voy a consultarlo"],
}
# cuarta ronda: palabras coloquiales («súper», «promo», «hobby») y preguntas que se parecían a un
# ejemplo negativo («horario de entrada» frente a «comprar entradas para un concierto»)
MAS_FRASES_4 = {
    "charla.personal": ["¿tienes hobbies?", "¿cuáles son tus aficiones?", "¿tienes algún pasatiempo?"],
    "charla.cumplido": ["qué asistente más maja", "qué asistente más lista"],
    "bot.identidad": ["¿hablo con un humano?", "¿eres humana o un bot?"],
    "reserva.precios": ["¿qué vale una noche?", "precios en temporada alta", "¿cuánto cuesta en temporada baja?",
                        "precio de una doble para el fin de semana", "¿cuánto cuesta una doble para el puente?"],
    "reserva.consultar": ["quiero revisar mi reserva", "revisar los datos de la reserva",
                          "¿puedo ver los datos de mi reserva?"],
    "reserva.ofertas": ["¿hay alguna promo?", "promo de verano", "¿tenéis alguna promoción ahora?"],
    "reserva.grupos": ["habitaciones para los invitados de una boda", "alojamiento para los invitados de una boda"],
    "estancia.horarios": ["¿cuál es el horario de entrada?", "horario de entrada y salida",
                          "¿a qué hora hay que salir de la habitación?", "¿a qué hora es la entrada?"],
    "estancia.ninos": ["¿mi hijo paga?", "¿un niño de 5 años paga?", "¿los bebés pagan?", "¿cuánto paga un niño?"],
    "habitacion.limpieza": ["no me han hecho la cama", "hoy no han hecho la habitación", "hoy no han pasado a limpiar"],
    "habitacion.cambio": ["la habitación es muy oscura, ¿me dais otra?", "la habitación da a un patio interior",
                          "esta habitación no me convence, ¿tenéis otra?"],
    "queja.ruido": ["no hay quien duerma con tanto ruido", "llevan toda la noche haciendo ruido", "cuánto jaleo"],
    "info.cerca": ["¿dónde hay un súper?", "¿hay un súper por aquí?", "¿hay alguna farmacia por aquí?",
                   "¿hay alguna tienda por aquí?"],
    "info.turismo": ["¿hay conciertos esta semana?", "agenda cultural", "¿qué hay esta semana en la ciudad?",
                     "¿hay alguna fiesta este fin de semana?", "¿hay algún espectáculo esta noche?"],
    "Fallback": ["¿cómo se dice hola en chino?", "traduce hola al inglés", "¿dónde puedo comprar acciones?",
                 "quiero invertir en criptomonedas"],
}
# quinta ronda: averías con objetos y verbos que faltaban (persiana, grifo, váter, enchufes…)
MAS_FRASES_5 = {
    "habitacion.averia": ["[el váter](averia) pierde agua", "[la cisterna](averia) no para de correr",
                          "[el inodoro](averia) está atascado", "[la persiana](averia) no baja",
                          "[la persiana](averia) se ha atascado", "[el grifo](averia) gotea",
                          "gotea [el grifo del lavabo](averia)", "[la ducha](averia) pierde agua",
                          "[el desagüe de la ducha](averia) no traga", "[los enchufes](averia) no tienen corriente",
                          "[la ventana](averia) no cierra bien", "no puedo cerrar [la puerta](averia)",
                          "[la luz](averia) parpadea", "[el secador](averia) no va bien",
                          "[el mando](averia) no tiene pilas", "[la caja fuerte](averia) no se abre",
                          "se ha caído [la barra de la cortina](averia)", "[la nevera](averia) no enfría",
                          "[el aire](averia) gotea", "se ha ido [la luz](averia)", "[el agua](averia) sale fría",
                          "[la cama](averia) está rota", "[la llave](averia) no funciona",
                          "no va [la tele](averia)", "no me va [el wifi](averia)", "no me funciona [la ducha](averia)",
                          "falla [el aire acondicionado](averia)", "[la tele](averia) falla"],
}
# sexta ronda: vocabulario que faltaba en el último examen (garaje, moverme, perrito, cardio…)
MAS_FRASES_6 = {
    "estancia.parking": ["¿tenéis garaje?", "¿cuánto cuesta el garaje?", "precio del garaje por día"],
    "estancia.mascotas": ["¿mi perrito puede venir?", "viajo con mi perrita", "¿pueden subir perros a la habitación?"],
    "gimnasio.info": ["¿hay máquinas de cardio?", "¿tenéis cinta de correr?", "¿hay pesas en el gimnasio?"],
    "info.transporte": ["¿cómo puedo moverme por málaga?", "¿cómo nos movemos por la ciudad?",
                        "¿cómo se mueve uno por aquí sin coche?"],
    "queja.ruido": ["los del piso de arriba no paran", "hay ruido en el piso de arriba", "los de abajo hacen ruido"],
    "reserva.politica_cancelacion": ["si no puedo ir, ¿me cobráis algo?", "¿pierdo el dinero si no voy?"],
    "spa.reservar": ["apúntame al [circuito termal](tratamiento)", "¿me apuntas a un [masaje](tratamiento)?"],
}
for _ronda in (MAS_FRASES_2, MAS_FRASES_3, MAS_FRASES_4, MAS_FRASES_5, MAS_FRASES_6):
    for _name, _frases in _ronda.items():
        MAS_FRASES[_name] = MAS_FRASES.get(_name, []) + _frases

for _it in intents:
    _extra = MAS_FRASES.pop(_it["name"], [])
    _pmap = {p["name"]: p["entity"] for p in _it["parameters"]}
    _it["trainingPhrases"] += [phrase(p, _pmap) for p in _extra]
assert not MAS_FRASES, f"Intenciones desconocidas en MAS_FRASES: {sorted(MAS_FRASES)}"

# =========================================================================== agente
agent = {
    "id": "hotel",
    "name": "Hotel (ejemplo)",
    "description": "Ejemplo grande: Mira, la recepcionista virtual del Hotel Mirador, en Málaga. Reservas con "
                   "confirmación, cambios y cancelación, servicios, peticiones a la habitación, quejas, turismo y "
                   "conversación natural.",
    "language": "es",
    "timezone": "Europe/Madrid",
    "settings": {"threshold": 0.25, "defaultLifespan": 5, "spellCorrection": True,
                 "normalization": {"checkin": "check in", "checkout": "check out", "parquin": "parking",
                                   "parkin": "parking", "wify": "wifi", "wiffi": "wifi", "hab": "habitación"},
                 "webhook": {"url": "", "headers": {}, "timeout": 5}, "apiKey": ""},
    "entities": entities,
    "intents": intents,
}


# =========================================================================== comprobaciones
def _fold(s):
    s = unicodedata.normalize("NFKD", s.lower())
    s = "".join(ch for ch in s if not unicodedata.combining(ch))
    return re.sub(r"[^\w@]+", " ", s).strip()


def check(agent):
    from app.agents import normalize_agent
    from app.nlu.engine import NLUEngine, entity_kind
    from app.nlu.sys_entities import ANY_LIKE

    problems = []
    norm = normalize_agent(json.loads(json.dumps(agent)))
    for before, after in zip(agent["intents"], norm["intents"]):
        extra = {p["name"] for p in after["parameters"]} - {p["name"] for p in before["parameters"]}
        if extra:
            problems.append(f"{before['name']}: la normalización añade parámetros {sorted(extra)}")
    eng = NLUEngine(norm)
    seen = {}
    for it in agent["intents"]:
        for ph in it["trainingPhrases"]:
            key = (_fold(ph["text"]), tuple(it["inputContexts"]))
            if key in seen and not it["isFallback"]:
                problems.append(f"Repetida: «{ph['text']}» en {seen[key]} y {it['name']}")
            seen.setdefault(key, it["name"])
            if ph["annotations"] is None:
                continue
            tokens = eng.tokenize(ph["text"])
            _, chosen = eng.find_entities(ph["text"], tokens)
            spans = {(a["start"], a["end"]) for a in ph["annotations"]}
            for a in ph["annotations"]:
                if entity_kind(a["entity"]) in ANY_LIKE:
                    continue
                if not any(c.start == a["start"] and c.end == a["end"] for c in chosen):
                    found = [(c.entity, c.text) for c in chosen]
                    problems.append(f"{it['name']}: «{ph['text'][a['start']:a['end']]}» no coincide con lo que "
                                    f"detecta el motor en «{ph['text']}» {found}")
            for c in chosen:
                if (c.start, c.end) not in spans and not any(a["start"] <= c.start < a["end"] for a in ph["annotations"]):
                    problems.append(f"{it['name']}: sin anotar «{c.text}» ({c.entity}) en «{ph['text']}»")
    return problems


def stats(agent):
    phrases = sum(len(i["trainingPhrases"]) for i in agent["intents"] if not i["isFallback"])
    negatives = sum(len(i["trainingPhrases"]) for i in agent["intents"] if i["isFallback"])
    synonyms = sum(len(e["synonyms"]) for ent in agent["entities"] for e in ent["entries"])
    per = Counter({i["name"]: len(i["trainingPhrases"]) for i in agent["intents"]})
    return (f"{len(agent['intents'])} intenciones, {phrases} frases (+{negatives} ejemplos negativos), "
            f"{len(agent['entities'])} entidades con {synonyms} sinónimos; menos frases: {per.most_common()[-3:]}")


if __name__ == "__main__":
    issues = check(agent)
    for p in issues:
        print("·", p)
    print(stats(agent))
    if issues and "--force" not in sys.argv:
        raise SystemExit(f"{len(issues)} problemas: corrígelos (o --force para escribir igualmente)")
    OUT.write_text(json.dumps(agent, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(f"Escrito {OUT.relative_to(ROOT)} ({OUT.stat().st_size // 1024} KB)")

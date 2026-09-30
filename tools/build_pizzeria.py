"""Genera examples/pizzeria.json a partir de una notación compacta.

Frases: "quiero una [margarita](pizza) [familiar](tamano)" -> texto + anotaciones.
"""
import json, re, sys, uuid

OUT = str(__import__("pathlib").Path(__file__).resolve().parent.parent / "examples" / "pizzeria.json")
_n = 0
def uid(prefix):
    global _n; _n += 1
    return f"{prefix}{_n:03d}"

MARK = re.compile(r"\[([^\]]+)\]\(([^)]+)\)")

def phrase(src, params):
    text = ""; anns = []; pos = 0
    for m in MARK.finditer(src):
        text += src[pos:m.start()]
        start = len(text); text += m.group(1)
        pname = m.group(2)
        anns.append({"start": start, "end": len(text), "entity": params[pname], "param": pname})
        pos = m.end()
    text += src[pos:]
    return {"id": uid("p"), "text": text, "annotations": anns}

def intent(name, phrases=(), responses=(), params=(), quick=(), action="", events=(), inctx=(), outctx=(),
           fallback=False, end=False, reset=False, webhook=False):
    pmap = {p["name"]: p["entity"] for p in params}
    resp = []
    if responses: resp.append({"type": "text", "variants": list(responses)})
    if quick: resp.append({"type": "quickReplies", "items": list(quick)})
    return {
        "id": uid("i"), "name": name, "isFallback": fallback, "events": list(events),
        "inputContexts": list(inctx),
        "outputContexts": [{"name": n, "lifespan": l} for n, l in outctx],
        "resetContexts": reset, "action": action,
        "parameters": [dict(p, id=uid("a")) for p in params],
        "trainingPhrases": [phrase(p, pmap) for p in phrases],
        "responses": resp, "webhook": webhook, "endConversation": end,
    }

def param(name, entity, required=False, prompts=(), is_list=False, default=""):
    return {"name": name, "entity": entity, "required": required, "isList": is_list,
            "prompts": list(prompts), "defaultValue": default}

def entity(name, entries, kind="map", fuzzy=True):
    return {"id": uid("e"), "name": name, "kind": kind, "fuzzy": fuzzy, "autoExpand": False,
            "entries": [{"value": v, "synonyms": s} for v, s in entries]}

entities = [
    entity("pizza", [
        ("margarita", ["margarita", "margherita", "de tomate y queso"]),
        ("barbacoa", ["barbacoa", "bbq", "barbacoa de pollo"]),
        ("cuatro quesos", ["cuatro quesos", "4 quesos", "quattro formaggi", "de quesos"]),
        ("hawaiana", ["hawaiana", "hawaii", "con piña", "de piña"]),
        ("carbonara", ["carbonara"]),
        ("pepperoni", ["pepperoni", "peperoni", "de salami picante"]),
        ("vegetal", ["vegetal", "vegetariana", "de verduras", "vegana"]),
        ("jamón y queso", ["jamón y queso", "york", "jamón york", "prosciutto"]),
    ]),
    entity("tamano", [
        ("pequeña", ["pequeña", "individual", "chica", "small"]),
        ("mediana", ["mediana", "normal", "mediano"]),
        ("familiar", ["familiar", "grande", "XL", "enorme", "extra grande"]),
    ]),
    entity("bebida", [
        ("agua", ["agua", "agua mineral", "botella de agua"]),
        ("coca-cola", ["coca-cola", "coca cola", "cocacola", "coca", "coca cola zero"]),
        ("cerveza", ["cerveza", "birra", "caña", "cervezas"]),
        ("refresco de naranja", ["fanta", "fanta de naranja", "refresco de naranja", "naranjada"]),
        ("refresco de limón", ["fanta de limón", "refresco de limón", "limonada"]),
    ]),
    entity("entrega", [
        ("domicilio", ["a domicilio", "domicilio", "envío", "a casa", "que me la traigan", "que me lo traigan", "delivery", "a mi casa"]),
        ("recoger", ["recoger", "para recoger", "recogida", "para llevar", "paso a buscarla", "la recojo", "en el local", "paso yo"]),
    ]),
]

P_PIZZA = [
    param("cantidad", "@sys.number", default="1"),
    param("pizza", "@pizza", True, ["¿Qué pizza te apetece? Tenemos margarita, barbacoa, cuatro quesos, hawaiana, carbonara, pepperoni, vegetal y jamón y queso."]),
    param("tamano", "@tamano", True, ["¿De qué tamaño la quieres: pequeña, mediana o familiar?", "¿Pequeña, mediana o familiar?"]),
]
P_RESERVA = [
    param("personas", "@sys.number", True, ["¿Para cuántas personas es la reserva?"]),
    param("fecha", "@sys.date", True, ["¿Para qué día quieres la mesa?"]),
    param("hora", "@sys.time", True, ["¿A qué hora os viene bien?", "¿A qué hora queréis venir?"]),
]

intents = [
    intent("Bienvenida", [
        "hola", "buenas", "buenos días", "buenas tardes", "buenas noches", "hola qué tal",
        "hey", "saludos", "holi", "ey qué tal", "hola buenas", "qué pasa",
    ], ["¡Hola! 👋 Soy el asistente de la Pizzería Napoli. Puedo tomar tu pedido, reservarte mesa o contarte horarios y precios. ¿Qué te apetece?",
        "¡Buenas! 🍕 ¿Te apetece pedir una pizza, reservar mesa o necesitas información?"],
        quick=["Pedir una pizza", "Reservar mesa", "Ver la carta", "Horario"], events=["WELCOME"], action="input.welcome"),
    intent("Fallback", [], [
        "Perdona, no te he entendido. Puedo ayudarte con pedidos, reservas, la carta, precios u horarios.",
        "Vaya, eso no lo he pillado. ¿Quieres pedir una pizza, reservar mesa o saber el horario?",
    ], quick=["Pedir una pizza", "Reservar mesa", "Horario"], fallback=True, action="input.unknown"),
    intent("pedido.pizza", [
        "quiero una pizza", "quiero pedir una pizza", "quiero hacer un pedido", "hacer un pedido",
        "quiero pedir una [barbacoa](pizza)", "me pones una [margarita](pizza) [familiar](tamano)",
        "una [cuatro quesos](pizza) [mediana](tamano) por favor", "querría encargar [dos](cantidad) pizzas [hawaianas](pizza)",
        "me apetece una pizza [de pepperoni](pizza) [grande](tamano)", "tráeme una [carbonara](pizza) [pequeña](tamano)",
        "voy a querer [3](cantidad) pizzas [vegetales](pizza) [medianas](tamano)", "¿me preparas una [barbacoa](pizza)?",
        "quiero pizza", "pedir pizza", "ponme una [familiar](tamano) [de quesos](pizza)",
        "quisiera una pizza [hawaiana](pizza)", "para mí una [margarita](pizza)", "pedir comida",
        "quiero encargar comida", "me gustaría pedir [dos](cantidad) [pepperoni](pizza)",
    ], ["¡Marchando! 🍕 $cantidad × $pizza ($tamano). ¿La quieres a domicilio o para recoger?"],
        params=P_PIZZA, quick=["A domicilio", "Para recoger"], action="pedido.crear",
        outctx=[("pedido", 5), ("pedido-entrega", 2)]),
    intent("pedido.entrega", [
        "[a domicilio](entrega)", "[para recoger](entrega)", "que me la traigan [a casa](entrega)",
        "la [recojo](entrega) yo", "[paso a buscarla](entrega)", "[envío](entrega) a domicilio por favor",
        "la quiero [para llevar](entrega)", "mejor [a domicilio](entrega)", "[recoger](entrega) en el local",
        "tráemela [a casa](entrega)",
    ], ["Anotado: $entrega. ¿Quieres añadir algo de beber?"], params=[param("entrega", "@entrega", True, ["¿A domicilio o para recoger?"])],
        quick=["Sí", "No, gracias"], inctx=["pedido-entrega"], outctx=[("pedido", 5), ("pedido-bebida", 2)], action="pedido.entrega"),
    intent("pedido.bebida.si", ["sí", "vale", "claro", "sí por favor", "venga", "por qué no", "sí, algo de beber", "ok"],
           ["¿Qué quieres beber? Tenemos agua, coca-cola, refrescos de naranja y limón, y cerveza."],
           quick=["Agua", "Coca-cola", "Cerveza"], inctx=["pedido-bebida"], outctx=[("pedido", 5)], action="pedido.bebida.si"),
    intent("pedido.bebida.no", ["no", "no gracias", "nada", "nada de beber", "no hace falta", "así está bien", "no, gracias"],
           ["¡Perfecto! Tu pedido estará listo en unos 30 minutos. ¡Gracias por confiar en nosotros! 🍕"],
           inctx=["pedido-bebida"], outctx=[("pedido", 0), ("pedido-bebida", 0)], action="pedido.confirmar"),
    intent("pedido.bebida", [
        "quiero una [coca cola](bebida)", "añade [dos](cantidad) [cervezas](bebida)", "y de beber [agua](bebida)",
        "ponme una [fanta](bebida)", "también quiero [una](cantidad) [cerveza](bebida)", "una [coca-cola](bebida) por favor",
        "para beber [agua](bebida)", "quiero algo de beber", "¿qué bebidas tenéis?", "añade una bebida",
    ], ["Añado $cantidad × $bebida a tu pedido. 🥤 ¿Algo más?"], params=[
        param("cantidad", "@sys.number", default="1"),
        param("bebida", "@bebida", True, ["¿Qué quieres beber? Tenemos agua, coca-cola, refrescos y cerveza."]),
    ], action="pedido.bebida", outctx=[("pedido", 5)]),
    intent("pedido.estado", [
        "¿dónde está mi pedido?", "cuánto le falta a mi pizza", "mi pedido tarda mucho", "estado de mi pedido",
        "¿ya viene el repartidor?", "llevo una hora esperando", "¿cuándo llega mi pizza?", "no me ha llegado el pedido",
        "¿cuánto tarda el pedido?", "quiero saber cómo va mi pedido",
    ], ["Tu pedido ya está en camino 🛵. Llegará en unos 15 minutos."], action="pedido.estado"),
    intent("pedido.cancelar", [
        "cancela mi pedido", "ya no quiero la pizza", "anula el pedido", "quiero cancelar el pedido",
        "olvida el pedido", "cancelar pedido", "no quiero nada ya", "me he equivocado, cancélalo",
    ], ["He cancelado tu pedido. ¿Puedo ayudarte con algo más?"], action="pedido.cancelar", reset=True),
    intent("reserva.mesa", [
        "quiero reservar una mesa", "reservar mesa para [4](personas) personas", "¿tenéis mesa para [mañana](fecha) a [las 9](hora)?",
        "reserva para [dos](personas) [el viernes](fecha)", "quiero una mesa para cenar [el sábado](fecha) a [las 21:30](hora)",
        "me gustaría reservar", "¿hay sitio para [6](personas) personas [hoy](fecha)?", "reservar",
        "quiero reservar para [el 15 de octubre](fecha) a [las 14:00](hora) para [tres](personas) personas",
        "¿puedo reservar mesa?", "una mesa para [cinco](personas)", "queremos cenar allí [el domingo](fecha)",
        "resérvame una mesa para [pasado mañana](fecha)", "reserva a nombre de Juan", "hacer una reserva",
    ], ["¡Hecho! ✅ Mesa para $personas el $fecha a las $hora. ¡Os esperamos!"], params=P_RESERVA, action="reserva.crear",
        outctx=[("reserva", 5)]),
    intent("info.horario", [
        "¿a qué hora abrís?", "horario", "¿estáis abiertos?", "¿cuándo cerráis?", "¿abrís los domingos?",
        "¿hasta qué hora estáis?", "¿qué horario tenéis?", "¿abrís hoy?", "horario de apertura", "¿a qué hora cierra la pizzería?",
    ], ["Abrimos todos los días de 12:30 a 16:00 y de 19:30 a 23:30. 🕐"], action="info.horario"),
    intent("info.ubicacion", [
        "¿dónde estáis?", "dirección", "¿cómo llego?", "¿dónde está la pizzería?", "ubicación del local",
        "¿en qué calle estáis?", "¿dónde se encuentra el restaurante?", "mándame la ubicación",
    ], ["Estamos en la Calle Mayor 12, junto a la plaza. ¡Te esperamos! 📍"], action="info.ubicacion"),
    intent("info.carta", [
        "¿qué pizzas tenéis?", "ver la carta", "menú", "¿qué hay para comer?", "¿tenéis opciones vegetarianas?",
        "¿tenéis pizzas sin gluten?", "enséñame la carta", "¿qué tipos de pizza hay?", "la carta por favor", "¿qué me recomiendas?",
    ], ["Nuestras pizzas: margarita, barbacoa, cuatro quesos, hawaiana, carbonara, pepperoni, vegetal y jamón y queso. Todas en pequeña (8 €), mediana (11 €) o familiar (15 €). También tenemos base sin gluten."],
        quick=["Pedir una pizza", "Precios"], action="info.carta"),
    intent("info.precios", [
        "¿cuánto cuesta una pizza?", "precios", "¿cuánto vale la [familiar](tamano)?", "¿es caro?",
        "precio de la [barbacoa](pizza)", "¿cuánto cuesta la [mediana](tamano)?", "¿qué precio tienen las pizzas?",
        "¿cuánto es el envío?", "tarifas",
    ], ["La pizza pequeña cuesta 8 €, la mediana 11 € y la familiar 15 €. El envío a domicilio es gratis a partir de 20 €."],
        params=[param("tamano", "@tamano"), param("pizza", "@pizza")], action="info.precios"),
    intent("info.pago", [
        "¿puedo pagar con tarjeta?", "¿aceptáis bizum?", "formas de pago", "¿se puede pagar en efectivo?",
        "¿cómo se paga?", "métodos de pago", "¿aceptáis visa?",
    ], ["Puedes pagar en efectivo, con tarjeta o con Bizum. 💳"], action="info.pago"),
    intent("agradecimiento", [
        "gracias", "muchas gracias", "genial gracias", "mil gracias", "te lo agradezco", "perfecto, gracias", "gracias majo",
    ], ["¡A ti! 😊 ¿Puedo ayudarte con algo más?", "¡De nada! ¿Necesitas algo más?"], action="smalltalk.gracias"),
    intent("despedida", [
        "adiós", "hasta luego", "nos vemos", "chao", "bye", "eso es todo", "nada más", "hasta otra", "me voy",
    ], ["¡Hasta pronto! Que aproveche. 🍕", "¡Adiós! Aquí estaremos cuando tengas hambre."], action="smalltalk.adios", end=True),
    intent("hablar.humano", [
        "quiero hablar con una persona", "pásame con un humano", "atención al cliente", "hablar con el encargado",
        "no quiero hablar con un bot", "¿hay alguien de verdad?", "quiero poner una reclamación", "llamar por teléfono",
    ], ["Te paso con un compañero en cuanto quede libre. También puedes llamarnos al 912 345 678. 📞"], action="humano"),
    intent("smalltalk.bot", [
        "¿eres un robot?", "¿quién eres?", "¿cómo te llamas?", "¿eres humano?", "¿eres una persona real?", "¿qué eres?",
    ], ["Soy el asistente virtual de la Pizzería Napoli 🤖. No como pizza, pero sé mucho de ellas."], action="smalltalk.bot"),
]

agent = {
    "id": "pizzeria",
    "name": "Pizzería (ejemplo)",
    "description": "Agente de ejemplo: pedidos de pizza, reservas, carta, horarios. Muestra entidades, contextos, parámetros obligatorios y respuestas rápidas.",
    "language": "es",
    "timezone": "Europe/Madrid",
    "settings": {"threshold": 0.3, "defaultLifespan": 5, "spellCorrection": True, "normalization": {},
                 "webhook": {"url": "", "headers": {}, "timeout": 5}, "apiKey": ""},
    "entities": entities,
    "intents": intents,
}
if __name__ == "__main__":
    json.dump(agent, open(OUT, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
    print("intents", len(intents), "phrases", sum(len(i["trainingPhrases"]) for i in intents))

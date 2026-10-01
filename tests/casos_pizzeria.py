"""Frases de prueba para el agente de ejemplo (examples/pizzeria.json).

Ninguna aparece tal cual en las frases de entrenamiento: son paráfrasis, con
faltas, sin tildes o con abreviaturas, como escribe la gente en un chat.
"""

EN_DOMINIO = {
    "Bienvenida": [
        "hola buenas tardes", "buenass", "ola", "hey hola", "buenos dias!!", "holaaa",
    ],
    "pedido.pizza": [
        "quiero pedir una pizza de barbacoa", "me traes una margarita",
        "dos pizzas carbonara medianas", "quisiera encargar una pizza",
        "una hawaiana grande porfa", "pedir una pizza familiar de jamón y queso",
        "quiero 3 pizzas", "me pones una peperoni pequeña", "me gustaria una pizza vegetariana",
        "pido una cuatro quesos", "qiero una piza", "hacer pedido de pizza",
    ],
    "pedido.bebida": [
        "quiero una cocacola", "añade una cerveza", "y agua para beber", "ponme dos coca colas",
    ],
    "pedido.estado": [
        "donde esta mi pizza", "mi pedido no llega", "cuanto falta para que llegue",
        "ha salido ya mi pedido?", "llevo mucho esperando la pizza",
    ],
    "pedido.cancelar": [
        "cancela el pedido porfa", "ya no quiero el pedido", "anular mi pedido",
        "quiero anular la pizza",
    ],
    "reserva.mesa": [
        "reservar una mesa para mañana", "quiero reservar para 4 el sabado a las 9",
        "tienes mesa para dos esta noche?", "reserva para el viernes a las 21:00",
        "quiero hacer una reserva para 6 personas", "me reservas mesa?", "mesa para tres el domingo",
    ],
    "info.horario": [
        "a que hora abren", "cual es el horario", "estais abiertos ahora?",
        "a que hora cerrais hoy", "abris el lunes?",
    ],
    "info.ubicacion": [
        "donde esta el local", "cual es la direccion", "como llego a la pizzeria", "en que calle esta",
    ],
    "info.carta": [
        "que pizzas hay", "quiero ver el menu", "teneis pizza sin gluten",
        "que tipos de pizza teneis", "me enseñas la carta",
    ],
    "info.precios": [
        "cuanto vale una pizza", "que precio tiene la pizza mediana", "cuanto cuesta la familiar",
        "precio de las pizzas",
    ],
    "info.pago": [
        "se puede pagar con tarjeta", "aceptan bizum?", "como puedo pagar", "puedo pagar en efectivo?",
    ],
    "agradecimiento": ["gracias!!", "muchisimas gracias", "graciass", "mil gracias, muy amable"],
    "despedida": ["adios", "hasta luego!", "chao chao", "nos vemos pronto"],
    "hablar.humano": [
        "quiero hablar con alguien", "pasame con una persona", "necesito hablar con un humano",
        "quiero hablar con el encargado",
    ],
    "smalltalk.bot": ["eres un bot?", "como te llamas?", "quien eres tu", "eres una persona?"],
}

# Frases que dependen de un contexto activo: (contextos, frase, intención esperada)
CON_CONTEXTO = [
    (["pedido", "pedido-entrega"], "a domicilio porfa", "pedido.entrega"),
    (["pedido", "pedido-entrega"], "la recojo en el local", "pedido.entrega"),
    (["pedido", "pedido-bebida"], "si", "pedido.bebida.si"),
    (["pedido", "pedido-bebida"], "vale venga", "pedido.bebida.si"),
    (["pedido", "pedido-bebida"], "no gracias", "pedido.bebida.no"),
    (["pedido", "pedido-bebida"], "no, nada", "pedido.bebida.no"),
]

# Frases fuera de tema: deberían acabar en la intención de fallback
FUERA_DE_DOMINIO = [
    "cual es la capital de francia", "me duele la cabeza", "quien gano el mundial",
    "el cielo es azul", "necesito un taxi", "que tiempo hace mañana", "cuentame un chiste",
    "quiero comprar un coche", "reservar un vuelo a roma", "cuanto cuesta un iphone", "asdfgh",
    "mi perro se llama toby", "como se hace una tortilla", "tengo que estudiar para el examen",
    "pon musica", "que hora es", "apaga la luz", "cuantos años tienes", "me gusta el futbol",
    "llama a mi madre", "busca en google", "quiero un billete de tren", "mañana tengo medico",
    "la reunion es a las 5", "manda un email a juan",
]

# Agente conversacional (alternativa libre a Dialogflow)

Plataforma para crear chatbots como en Dialogflow, pero gratis y en tu propio ordenador o servidor:
intenciones, frases de entrenamiento, entidades, contextos, parámetros obligatorios, respuestas…
y una vista para ver **cómo ha tokenizado y entendido** cada frase y **corregirlo** para que aprenda.

> **Estado: en desarrollo.** El motor de lenguaje (NLU) ya funciona. Faltan la API, el gestor de
> diálogo y la consola web. Ver [Estado y hoja de ruta](#estado-y-hoja-de-ruta).

## Qué va a tener (lo básico de Dialogflow)

| Función | Estado |
|---|---|
| Tokenizador con posiciones (tildes, mayúsculas, "holaaaa", abreviaturas de chat: "xq", "xfa", "q"…) | ✅ |
| Stemmer español (raíces: reservar/reserva/reservas → `reserv`) | ✅ |
| Corrección ortográfica contra el vocabulario del agente ("rezervar" → "reservar") | ✅ |
| Entidades de sistema: `@sys.number`, `@sys.date`, `@sys.time`, `@sys.date-time`, `@sys.duration`, `@sys.unit-currency`, `@sys.percentage`, `@sys.email`, `@sys.phone-number`, `@sys.url`, `@sys.ordinal`, `@sys.any` | ✅ |
| Entidades propias con sinónimos, plurales, errores tipográficos y regex | ✅ |
| Clasificador de intenciones (TF-IDF + regresión logística + similitud) | ✅ |
| Coincidencia exacta por plantillas (como el modo por reglas de Dialogflow) | ✅ |
| Extracción de parámetros (incluye varios del mismo tipo: "de Madrid a Sevilla") | ✅ |
| Contextos de entrada/salida con duración (lifespan) | 🔧 en el motor, falta el gestor de diálogo |
| Parámetros obligatorios con preguntas (slot filling) | ⏳ |
| Respuestas con variantes, `$parametro`, `#contexto.param`, respuestas rápidas | ⏳ |
| Consola web (intenciones, entidades, simulador "Pruébalo") | ⏳ |
| Vista de tokenización + botones ✓/✗ para decirle si lo ha entendido bien o mal | ⏳ |
| Entrenamiento a partir de conversaciones reales (como "Training" de Dialogflow) | ⏳ |
| Webhook (fulfillment) compatible con Dialogflow ES | ⏳ |
| API REST + endpoint compatible con `detectIntent` de Dialogflow | ⏳ |
| Widget de chat para incrustar en cualquier web | ⏳ |
| Importar agentes exportados de Dialogflow ES (.zip) | ⏳ |

## Requisitos

- Python 3.11 o superior (probado con 3.13 en Windows 11)
- Sin servicios externos ni claves de API: todo funciona en local

## Instalación

```bash
git clone https://github.com/pablomise004/agenteconversacional.git
cd agenteconversacional
python -m venv .venv
# Windows:
.venv\Scripts\activate
# Linux / macOS:
source .venv/bin/activate
pip install -r requirements.txt
```

## Probar el motor de NLU (lo que ya funciona)

```bash
python tools/probar_nlu.py "quiero reservar mesa para 4 mañana a las 9 de la noche"
```

Muestra los tokens, las entidades detectadas, el ranking de intenciones con su confianza y los
parámetros extraídos, usando el agente de ejemplo [examples/pizzeria.json](examples/pizzeria.json)
(19 intenciones, 174 frases: pedidos, reservas, carta, horarios…).

## Estructura

```
app/nlu/
  text.py            tokenizador y normalización
  stemmer_es.py      stemmer español (Snowball adaptado a texto sin tildes)
  lang_es.py         recursos del español (números, meses, abreviaturas de chat…)
  lang_en.py         recursos del inglés
  languages.py       registro de idiomas
  sys_entities.py    entidades de sistema (@sys.*)
  entities.py        entidades propias (sinónimos, raíces, errores, regex)
  spelling.py        corrector ortográfico (SymSpell)
  features.py        rasgos para el clasificador
  classifier.py      TF-IDF por clases + regresión logística (SGD) + similitud
  engine.py          une todo: analizar frase, plantillas, parámetros, auto-anotación
examples/pizzeria.json   agente de ejemplo
tools/                   scripts de apoyo
```

## Calidad del clasificador

Medido con el dataset público MASSIVE (Amazon, español, 60 intenciones de asistente doméstico,
muy exigente) entrenando con solo 20 frases por intención: **69,7 % de acierto**, entrenando en
medio segundo. Con agentes normales (intenciones más distintas entre sí, como el de ejemplo)
el acierto es mucho mayor.

## Estado y hoja de ruta

Ver [CLAUDE.md](CLAUDE.md): contiene el diseño completo, las decisiones tomadas y la lista
de tareas pendientes en orden, para poder seguir el desarrollo desde cualquier equipo.

## Licencia

MIT

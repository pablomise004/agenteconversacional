# Agente conversacional

**Alternativa libre a Dialogflow para crear chatbots**, que funciona en tu propio ordenador o servidor,
sin cuentas, sin límites y sin pagar por mensaje.

Defines **intenciones** con frases de ejemplo, **entidades** con sinónimos, **contextos** para guiar
la conversación y **respuestas**. El bot entiende lo que escribe la gente (con faltas, sin tildes,
abreviaturas de chat…) y tú puedes ver **cómo ha tokenizado y entendido cada frase** y **corregirlo
con un clic** para que aprenda.

![Editor de intenciones](docs/img/editor.png)

## Qué incluye

| | |
|---|---|
| **Intenciones** | Frases de entrenamiento, anotación de entidades seleccionando texto (como en Dialogflow), acción y parámetros, respuestas con variantes, respuestas rápidas y payload JSON, eventos (`WELCOME`), fallback |
| **Entidades** | Propias con sinónimos, listas o expresiones regulares; tolerancia a faltas y plurales; expansión automática. Del sistema: `@sys.number`, `@sys.date`, `@sys.time`, `@sys.date-time`, `@sys.duration`, `@sys.unit-currency`, `@sys.percentage`, `@sys.email`, `@sys.phone-number`, `@sys.url`, `@sys.ordinal`, `@sys.any`… |
| **Contextos** | De entrada y de salida con duración en turnos; intenciones de seguimiento («sí»/«no» solo cuentan tras una pregunta) |
| **Parámetros obligatorios** | Si falta un dato, el bot lo pregunta (slot filling) y entiende «cancelar» o un cambio de tema |
| **Analizador** | Muestra tokens, forma normalizada, raíz, correcciones, entidades, intenciones candidatas con su confianza y las frases de entrenamiento más parecidas |
| **Aprendizaje** | Botones 👍/👎 en el simulador, pantalla de **Entrenamiento** con los mensajes reales, corrección de intención y entidades, añadir sinónimos y reglas de normalización |
| **Simulador** | Panel «Pruébalo» con detalles de cada turno: intención, confianza, parámetros, contextos |
| **Integraciones** | Widget de chat para cualquier web (una línea), API REST, API compatible con `detectIntent` de Dialogflow ES, webhook con el formato de Dialogflow |
| **Migración** | Importa agentes exportados de Dialogflow ES (ZIP) |
| **Idiomas** | Español (completo) e inglés |

## Instalación

Necesitas **Python 3.11 o superior** ([descargar](https://www.python.org/downloads/); en Windows marca
«Add python.exe to PATH»).

### Windows

Descarga o clona el proyecto y haz **doble clic en `iniciar.bat`**. La primera vez prepara el entorno
(un minuto) y después abre la consola en el navegador: <http://localhost:8000>.

### Linux / macOS

```bash
git clone https://github.com/pablomise004/agenteconversacional.git
cd agenteconversacional
./iniciar.sh
```

### A mano

```bash
python -m venv .venv
.venv\Scripts\activate          # Windows   (Linux/macOS: source .venv/bin/activate)
pip install -r requirements.txt
python -m app                   # opciones: --port 8000 --host 0.0.0.0 --no-browser --data carpeta
```

Al arrancar por primera vez se crea el agente de ejemplo **Pizzería** (pedidos, reservas, carta,
horarios) para que puedas trastear desde el principio. Los datos se guardan en la carpeta `data/`.

## Primeros pasos

1. Abre <http://localhost:8000> y escribe en el panel **Pruébalo**: «hola», «quiero una pizza»,
   «una barbacoa», «grande»… Pulsa el nombre de la intención bajo cada respuesta para ver qué entendió.
2. Si se equivoca, pulsa 👎 y elige la intención correcta: la frase se añade al entrenamiento y el
   modelo se actualiza al instante.
3. En **Analizador** escribe cualquier frase para ver la tokenización completa.
4. En **Intenciones** crea las tuyas: escribe frases de ejemplo (mejor 10 o más), selecciona palabras
   con el ratón para marcarlas como entidades y añade respuestas.
5. En **Entrenamiento** revisa lo que escribe la gente de verdad y aprueba o corrige.

![Analizador](docs/img/analizador.png)

## Conceptos (igual que en Dialogflow)

- **Intención**: lo que quiere el usuario («pedir una pizza»). Tiene frases de entrenamiento y respuestas.
- **Entidad**: un tipo de dato dentro de la frase (`@pizza`, `@sys.date`). Las propias se definen con
  un valor de referencia y sinónimos («familiar» ← «grande», «XL»).
- **Parámetro**: el valor de una entidad que extrae la intención (`$tamano = familiar`). Si es
  obligatorio y falta, el bot pregunta.
- **Contexto**: memoria de la conversación. Una intención con contexto de **salida** `pedido` (dura 5
  turnos) permite que otra con contexto de **entrada** `pedido` solo se active después.
- **Evento**: activa una intención sin texto; `WELCOME` se lanza al abrir el chat.
- **Fallback**: la intención que responde cuando no se entiende la frase. Sus frases de entrenamiento
  sirven como ejemplos negativos.
- **Umbral de confianza** (Ajustes): por debajo, responde el fallback. Por defecto 0,30.

En las respuestas puedes usar `$parametro` (formateado: «viernes 2 de octubre», «21:30», «a, b y c»),
`$parametro.original` (lo que escribió el usuario), `$parametro.value` (valor en bruto) y
`#contexto.parametro`.

## Conectarlo a tu web o aplicación

**Widget de chat** — pega esto antes de `</body>` (lo genera la página *Integraciones*):

```html
<script src="http://localhost:8000/widget.js" data-agent="pizzeria" data-title="Pizzería"></script>
```

Hay también una página de chat completa en `/chat?agent=pizzeria`.

![Chat](docs/img/chat.png)

**API REST**:

```bash
curl -X POST http://localhost:8000/api/agents/pizzeria/detect \
  -H "Content-Type: application/json" \
  -d '{"sessionId": "usuario-123", "text": "quiero una pizza barbacoa familiar"}'
```

Devuelve la intención, la confianza, los parámetros, los contextos y los mensajes de respuesta.
La documentación interactiva de toda la API está en <http://localhost:8000/docs>.

**Compatible con Dialogflow**: `POST /v2/projects/{agente}/agent/sessions/{sesión}:detectIntent` acepta
y devuelve el mismo JSON que la API v2 de Dialogflow ES.

**Webhook**: configura la URL en *Ajustes* y activa «Llamar al webhook» en las intenciones. Recibe la
misma petición que mandaría Dialogflow ES (`queryResult` con intención, parámetros y contextos) y puede
responder con `fulfillmentText`, `fulfillmentMessages`, `outputContexts` o `followupEventInput`, así que
los webhooks escritos para Dialogflow funcionan sin cambios.

## Migrar desde Dialogflow

En la consola de Dialogflow ES: *Configuración del agente → Exportar e importar → Exportar como ZIP*.
Aquí: *Agentes → Importar* y elige el ZIP. Se conservan intenciones, frases con anotaciones, entidades,
contextos, parámetros con sus preguntas, respuestas de texto y rápidas, eventos y la URL del webhook.

## Ponerlo en un servidor

Con Docker:

```bash
docker build -t agente .
docker run -d -p 8000:8000 -v agente-datos:/data -e AGENTE_ADMIN_TOKEN=pon-aqui-un-secreto agente
```

O en cualquier máquina con Python: `python -m app --host 0.0.0.0 --port 8000 --no-browser`.

| Variable | Para qué |
|---|---|
| `AGENTE_ADMIN_TOKEN` | Protege la consola y la API de administración (se pide al entrar). Muy recomendable si el servidor es público |
| `AGENTE_DATA_DIR` | Carpeta de datos (por defecto `./data`) |
| `HOST` / `PORT` | Dirección y puerto |

Cada agente puede tener además una **clave de API** (Ajustes → Seguridad) que exige la cabecera
`X-Api-Key` para hablar con el bot.

## Cómo funciona por dentro

Todo el procesamiento del lenguaje es propio y local (no usa servicios externos):

1. **Tokenización** con posiciones: minúsculas, sin tildes, «holaaaa» → «hola», abreviaturas de chat
   («xq», «xfa», «finde»…) y tus reglas de normalización.
2. **Corrección ortográfica** contra el vocabulario del agente (algoritmo SymSpell).
3. **Raíces** con un stemmer español (Snowball adaptado a texto sin tildes).
4. **Entidades** del sistema (fechas relativas, horas con «de la tarde» o «menos cuarto», números en
   palabras…) y propias (sinónimos, plurales, faltas, regex).
5. **Clasificación**: TF-IDF por intención con palabras, pares de palabras, entidades y trozos de
   letras → regresión logística entrenada con SGD, combinada con la similitud con las frases de
   entrenamiento. Si la frase coincide exactamente con una de entrenamiento, confianza 100 %.
6. **Contextos y diálogo**: filtra intenciones por contexto, rellena parámetros y genera la respuesta.

Calidad medida con el dataset público MASSIVE (Amazon, 60 intenciones de asistente doméstico en
español, muchas muy parecidas entre sí): **65 % de acierto con 20 frases por intención** (59 % con
10), entrenando en un par de segundos. Con agentes normales, de intenciones más distintas, acierta
mucho más: con el de ejemplo, 74 de 76 frases de prueba nunca vistas (con faltas y sin tildes), y
rechaza 22 de 25 frases fuera de tema.

## Desarrollo

```bash
pip install -r requirements-dev.txt
python -m pytest                 # 77 pruebas: NLU, diálogo, webhook, API, importación
python tools/probar_nlu.py "quiero una pizza barbacoa familiar"
```

```
app/
  nlu/            motor de lenguaje (tokenizador, stemmer, entidades, clasificador)
  dialog.py       gestor de diálogo: sesiones, contextos, slot filling, webhook
  server.py       API REST (FastAPI) y servidor de la consola
  storage.py      agentes en JSON y conversaciones en SQLite
  importer.py     importación de JSON y ZIP de Dialogflow
web/              consola (HTML/CSS/JS sin compilación), widget.js y chat.html
examples/         agente de ejemplo
tests/            pruebas automáticas
```

## Licencia

MIT

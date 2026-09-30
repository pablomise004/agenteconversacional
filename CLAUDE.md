# Agente conversacional — notas para continuar el desarrollo

Alternativa libre y local a Dialogflow ES. Interfaz y documentación en español; identificadores
de código en inglés, comentarios en español. Python 3.11+ (probado 3.13, Windows 11).

## Decisiones de diseño (ya tomadas)

- **Backend**: FastAPI + uvicorn. Sin Node: la consola web será HTML/CSS/JS vanilla (módulos ES,
  sin paso de compilación) servida por FastAPI desde `web/`.
- **Almacenamiento**: cada agente en `data/agents/<id>.json` (fácil de versionar/exportar);
  conversaciones, logs y sesiones en SQLite `data/runtime.sqlite3`. `data/` va en .gitignore.
  Al arrancar sin agentes, copiar `examples/pizzeria.json`.
- **NLU propio** (en `app/nlu/`, hecho y probado a mano):
  - Texto normalizado sin tildes (ñ→n), elongaciones y risas normalizadas, abreviaturas de chat.
  - Stemmer español propio sobre texto sin tildes (consistencia con/sin tildes).
  - Entidades de sistema en `sys_entities.py` (fechas relativas/absolutas, horas con
    "de la tarde", "menos cuarto", duraciones, moneda, %, teléfono, email, url, ordinales,
    números en palabras). "a las 5" sin calificador → 17:00 (1-7 → tarde). Probado con muchas
    frases en español e inglés.
  - Clasificador: TF-IDF con IDF por intención, bloque de palabras+bigramas+entidades y bloque
    de n-gramas de letras (peso 0.45) → regresión logística softmax por SGD (15 épocas,
    lr 0.5, reg 1e-4). Benchmark MASSIVE-es 20-shot: 69.7% (centroide 65%, kNN 62%,
    perceptrón 63%). Confianza = prob × sqrt(min(1, similitud/0.55)) → **falta calibrar**.
  - Las frases de la intención fallback se entrenan como clase negativa (`__fallback__:<id>`).
  - Plantillas: una frase de entrenamiento que coincide exactamente (por raíces, con entidades
    como huecos y @sys.any como comodín) da confianza 1.0 y los valores de sus parámetros.
  - Parámetros del mismo tipo se reparten usando la palabra anterior aprendida
    ("de @ciudad a @ciudad").
- **Formato del agente** (ver `examples/pizzeria.json`): `intents[]` con `inputContexts`,
  `outputContexts[{name,lifespan}]`, `events`, `parameters[{name,entity,required,isList,prompts,
  defaultValue}]`, `trainingPhrases[{id,text,annotations[{start,end,entity,param}]}]`
  (`annotations: null` = auto-anotar al entrenar), `responses[{type:text,variants}|
  {type:quickReplies,items}|{type:payload,payload}]`, `webhook`, `endConversation`,
  `resetContexts`, `isFallback`. `entities[]` con `kind` map|list|regex, `fuzzy`, `autoExpand`,
  `entries[{value,synonyms}]`. `settings`: threshold (0.3), defaultLifespan, spellCorrection,
  normalization (mapa propio de palabras), webhook {url,headers,timeout}, apiKey.

## Pendiente (en este orden)

1. **Calibrar confianza/fallback** con el agente de ejemplo: escribir `tests/` con frases de
   prueba en dominio (paráfrasis, faltas) y fuera de dominio ("¿capital de Francia?",
   "reservar un vuelo"…) y ajustar `NLUEngine.confidence` y el umbral por defecto.
2. `app/dialog.py`: gestor de diálogo. Sesiones (SQLite, caducan a los 20 min), contextos
   (decremento de lifespan por turno, parámetros en contextos, lifespan 0 = borrar,
   resetContexts), eventos (WELCOME), slot filling (preguntar `prompts` de los parámetros
   obligatorios; "cancelar" usando CANCEL_WORDS+CANCEL_FILLER; salir si otra intención
   supera 0.8), defaultValue con `#contexto.param`, fallback contextual, endConversation.
3. Respuestas: variante aleatoria; `$param` (fechas/horas formateadas en humano),
   `$param.original`, `$param.value`, `#contexto.param`; listas "a, b y c".
4. Webhook compatible con Dialogflow ES (request `queryResult`…, response `fulfillmentText`,
   `fulfillmentMessages`, `outputContexts`, `followupEventInput`). Usar urllib (sin deps).
5. `app/server.py` (FastAPI): CRUD agentes/intenciones/entidades, `/analyze` (sin sesión),
   `/annotate` (auto-anotar frase), `/detect` (con sesión), logs + feedback
   (aprobar / reasignar intención / corregir anotaciones / añadir sinónimo / regla de
   normalización), historial, import/export JSON, importar zip de Dialogflow ES,
   endpoint `/v2/projects/{agent}/agent/sessions/{session}:detectIntent`. Reentrenar de forma
   perezosa cuando el agente cambia. CORS abierto; token de admin opcional por variable de
   entorno. `python -m app` arranca y abre el navegador.
6. Consola web `web/`: lista y editor de intenciones (frases con anotaciones de colores,
   seleccionar texto → elegir entidad), entidades (tabla valor/sinónimos, edición masiva),
   simulador lateral con detalles (intención, confianza, parámetros, contextos, tokens) y
   botones ✓/✗, página "Tokenizador/Análisis", "Entrenamiento" (logs para revisar),
   historial, integraciones (API, widget), ajustes. Tema claro/oscuro, escapar siempre HTML.
7. `web/widget.js` (burbuja de chat incrustable) y `web/chat.html` (demo a pantalla completa).
8. Tests con pytest (NLU, diálogo, API con TestClient), `iniciar.bat`/`iniciar.sh`,
   Dockerfile, completar README.
9. Opcional: embeddings multilingües (onnxruntime) como modo avanzado; validación del agente
   (frases duplicadas entre intenciones, validación cruzada por intención).

## Comandos útiles

```bash
python -m venv .venv && .venv\Scripts\activate && pip install -r requirements.txt
python tools/probar_nlu.py "quiero una pizza barbacoa familiar"
python tools/build_pizzeria.py   # regenera examples/pizzeria.json desde notación [texto](param)
```

Benchmark: dataset MASSIVE es (https://huggingface.co/datasets/mteb/amazon_massive_intent,
ficheros `train/es.json.gz` y `test/es.json.gz`).

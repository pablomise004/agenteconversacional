# Agente conversacional — notas para continuar el desarrollo

Alternativa libre y local a Dialogflow ES. Interfaz y documentación en español; identificadores
de código en inglés, comentarios en español. Python 3.11+ (probado 3.13, Windows 11).

## Estado (versión 0.2.0)

Funciona de punta a punta: motor NLU, diálogo, API, consola web, widget, tests (77) y lanzadores.

- `app/nlu/`: tokenizador (posiciones, normalización sin tildes, abreviaturas de chat, reglas
  propias del agente), stemmer español propio, corrector SymSpell (no cambia la primera letra salvo
  "h" muda), entidades de sistema (`sys_entities.py`), entidades propias (exacta → raíz → corregida →
  regex), clasificador y motor (`engine.py`).
- Clasificador (`classifier.py`): TF-IDF con IDF por intención (bloque palabras+bigramas+entidades y
  bloque de n-gramas de letras con peso 0.45) → regresión logística softmax por SGD; la probabilidad
  se mezcla 85/15 con una "probabilidad por parecido" (softmax de similitud/0.1). La intención se
  ELIGE por probabilidad y se ACEPTA por confianza = sqrt(prob) × min(1, sim/0.65)²; umbral 0.3.
  Las intenciones con contexto de entrada activo y confianza ≥ 0.5 tienen prioridad. Una frase de
  entrenamiento que coincide exactamente (plantilla) da confianza 1.0 y sus parámetros.
- Calidad: MASSIVE-es (60 intenciones) 65.3 % con 20 frases/intención, 59.2 % con 10. Agente de
  ejemplo: 74/76 en dominio, 22/25 fuera de dominio rechazadas (`tests/casos_pizzeria.py`).
- `@sys.any` sin plantilla exacta: anclas izquierda/derecha aprendidas de las anotaciones.
- `app/dialog.py`: sesiones en SQLite (20 min), contextos (decrementan cada turno; los puestos en el
  turno conservan su duración; lifespan 0 borra), eventos, slot filling (cancelar solo si TODO el
  mensaje son palabras de cancelación; otra intención ≥ 0.8 interrumpe), defaultValue con
  `#ctx.param`, fallback contextual, endConversation (borra contextos), webhook Dialogflow ES
  (`app/webhook.py`, urllib) con followupEventInput.
- Registro de mensajes: los turnos de slot filling, cancelación y evento se guardan con
  review='none' (no aparecen en Entrenamiento).
- `app/server.py`: API REST (ver /docs), endpoint compatible `:detectIntent`, import JSON/ZIP de
  Dialogflow (`app/importer.py`), validación (`app/validation.py`), token de admin opcional
  (`AGENTE_ADMIN_TOKEN`), clave de API por agente (`X-Api-Key`).
- `web/`: consola en JS vanilla con módulos ES (sin compilación). `js/app.js` (rutas por hash,
  estado), `js/ui.js` (h() crea DOM sin innerHTML con datos del usuario), `js/annotate.js`
  (anotar seleccionando texto), `js/simulator.js`, `js/pages/*.js`. `widget.js` usa Shadow DOM.
- Verificación de la interfaz: Playwright con Edge instalado (`channel="msedge"`), sin descargar
  navegadores. Ojo: en este equipo `NoDefaultCurrentDirectoryInExePath=1`, así que para lanzar
  `iniciar.bat` desde otra terminal hay que usar la ruta completa.

## Ideas pendientes (por orden de utilidad)

1. Respuestas condicionales (p. ej. según `$entrega`) y respuestas por canal.
2. Exportar a ZIP de Dialogflow ES (ahora solo se importa).
3. Embeddings multilingües opcionales (onnxruntime + MiniLM) como "modo avanzado" para subir el
   acierto con pocas frases; mantener el modo actual como predeterminado (sin dependencias pesadas).
4. Validación cruzada por intención en la consola (qué frases se confunden entre sí).
5. Entidades compuestas y `@sys.geo-city` con diccionario.
6. Más idiomas (hay stemmer Snowball para fr/it/pt/de/ca/nl, faltan números y fechas).

## Comandos útiles

```bash
python -m venv .venv && .venv\Scripts\activate && pip install -r requirements-dev.txt
python -m app                     # consola en http://localhost:8000 (--port, --host, --data, --no-browser)
python -m pytest                  # 77 pruebas
python tools/probar_nlu.py "quiero una pizza barbacoa familiar"
python tools/build_pizzeria.py    # regenera examples/pizzeria.json desde notación [texto](param)
```

Benchmark: dataset MASSIVE es (https://huggingface.co/datasets/mteb/amazon_massive_intent,
ficheros `train/es.json.gz` y `test/es.json.gz`): crear un agente con N frases por intención
(`annotations: None`) y medir `engine.analyze(texto).best["id"]` sobre el test.

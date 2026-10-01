# Agente conversacional — contexto para Claude

Alternativa libre y local a **Dialogflow ES** para crear chatbots en español, con una consola web
que además sirve para **aprender cómo funciona el NLU por dentro** (página «Entrenar»).
Repositorio: https://github.com/pablomise004/agenteconversacional

## Sobre el usuario y el proyecto

- Pablo (pablomise004) lo usa para crear chatbots y **para aprender**: valora explicaciones visuales
  y en lenguaje sencillo de cómo aprende el modelo. Habla español; toda la interfaz, la
  documentación y los mensajes van en español.
- Trabaja desde varios ordenadores: el contexto del proyecto vive en este fichero, en
  `README.md`, `docs/GUIA.md` (guía de uso, también se muestra dentro de la consola) y
  `docs/ARQUITECTURA.md` (referencia técnica detallada: léela antes de tocar el NLU).
- Preferencias ya expresadas: modo oscuro **clásico** (grises neutros, sin tintes azulados);
  quiere poder ver y entender el entrenamiento; quiere todo subido a GitHub.

## Arranque y comandos

```bash
python -m venv .venv && .venv\Scripts\activate && pip install -r requirements-dev.txt
python -m app                         # http://localhost:8000  (--port --host --data --no-browser)
python -m pytest                      # 84 pruebas (deben pasar siempre)
pip install playwright && python -m pytest tests/e2e -m e2e   # 15 pruebas en navegador real
python tools/benchmark_massive.py     # acierto con MASSIVE (referencia: 59 % k=10, 65,6 % k=20)
python tools/probar_nlu.py "frase"    # prueba rápida del NLU con el agente de ejemplo
python tools/build_pizzeria.py        # regenera examples/pizzeria.json desde notación [texto](param)
```

En Windows el usuario arranca con doble clic en `iniciar.bat` (crea `.venv`, instala y lanza).

## Mapa rápido

- `app/nlu/`: motor de lenguaje propio (tokenizador, stemmer, corrector, entidades `@sys.*` y
  propias, rasgos, clasificador, motor, `insights.py` para la página Entrenar).
- `app/dialog.py`: turnos de conversación (contextos, slot filling, fallback, webhook).
- `app/server.py`: API FastAPI (`/docs`), sirve `web/` en `/` y `docs/` en `/guia`.
- `app/storage.py`: agentes en `data/agents/<id>.json`, conversaciones en `data/runtime.sqlite3`
  (`data/` no se sube a Git).
- `web/`: consola en JavaScript sin compilación (módulos ES). `js/pages/learn.js` es la página
  «Entrenar»; `js/charts.js` los gráficos; `js/markdown.js` pinta `docs/GUIA.md`.
- `examples/pizzeria.json`: agente de ejemplo que se copia al arrancar sin agentes.
- `tests/casos_pizzeria.py`: frases de calibración (en dominio, con contexto, fuera de dominio).

## Convenciones

- Identificadores en inglés; comentarios, textos de interfaz y documentación en español.
- Python 3.11+, sin dependencias pesadas: FastAPI, uvicorn, numpy, snowballstemmer, tzdata.
  No añadir scikit-learn ni frameworks JS sin hablarlo.
- Todo agente que entra (API, importación, consola) pasa por `app/agents.py:normalize_agent()`.
- La consola construye el DOM con `h()` de `web/js/ui.js`; **nunca `innerHTML` con datos de
  usuario** (solo iconos SVG constantes).
- Colores: variables CSS en `web/css/app.css` (`--panel`, `--text`, `--accent-text`, `--series-1`…),
  con valores para claro y oscuro (el oscuro, grises neutros). Los colores de gráficos están
  validados para daltonismo; si se cambian, revalidar.
- Antes de dar algo por terminado: `python -m pytest` y, si se toca la consola, las pruebas e2e o
  capturas con Playwright (Edge instalado: `p.chromium.launch(channel="msedge")`) mirando las imágenes.
- Si cambia el clasificador: comparar con `tools/benchmark_massive.py` y con los tests de calibración.
- Commits en español; terminar con la línea de coautoría que indique el entorno.

## Detalles del NLU que conviene no romper

- La intención se **elige** por probabilidad (85 % regresión logística + 15 % parecido) y se
  **acepta** por confianza `√p · min(1, sim/0,65)²` frente al umbral (0,3 por defecto).
- Intenciones con contexto de entrada activo y confianza ≥ 0,5 tienen prioridad.
- Las frases del fallback son ejemplos negativos (clase `__fallback__:<id>`).
- Los turnos de slot filling / cancelación / evento se registran con `review='none'` (no aparecen
  en Revisión).
- El corrector no cambia la primera letra (salvo «h» muda).
- Detalles y números de cada decisión: `docs/ARQUITECTURA.md`.

## Entorno del ordenador original (Windows 11)

- `NoDefaultCurrentDirectoryInExePath=1`: desde una terminal, `iniciar.bat` hay que lanzarlo con su
  ruta completa (con doble clic funciona normal).
- Para imprimir tildes desde Python en la consola: `PYTHONIOENCODING=utf-8`.
- Tras cambiar código Python hay que reiniciar el servidor; JS/CSS se sirven en caliente (recargar).
- No hay Node instalado; la consola no lo necesita.

## Ideas pendientes (por orden de utilidad)

1. Respuestas condicionales (según `$param`) y respuestas por canal.
2. Exportar a ZIP de Dialogflow ES (ahora solo se importa).
3. Modo avanzado opcional con *embeddings* multilingües (onnxruntime + MiniLM) para acertar más con
   pocas frases; mantener el modo actual por defecto.
4. Entidades compuestas; diccionarios para `@sys.geo-city` / `@sys.given-name`.
5. Más idiomas (stemmers Snowball ya disponibles para fr/it/pt/de/ca/nl; faltan números y fechas).
6. En la página Entrenar: animar también el examen ronda a ronda.

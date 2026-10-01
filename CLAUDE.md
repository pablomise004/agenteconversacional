# Lince (agente conversacional) — contexto para Claude

**Lince** es una alternativa libre y local a **Dialogflow ES** para crear chatbots en español, con
una consola web que además sirve para **aprender cómo funciona el NLU por dentro** (página
«Entrenar»). El nombre: «listo como un lince» y «vista de lince» (ver el modelo por dentro); el
logotipo es una burbuja de chat con orejas de lince (`web/favicon.svg`).
Repositorio: https://github.com/pablomise004/agenteconversacional

## Sobre el usuario y el proyecto

- Pablo (pablomise004) lo usa para crear chatbots y **para aprender**: valora explicaciones visuales
  y en lenguaje sencillo de cómo aprende el modelo. Habla español; toda la interfaz, la
  documentación y los mensajes van en español.
- Trabaja desde varios ordenadores: el contexto del proyecto vive en este fichero, en
  `README.md`, `docs/GUIA.md` (guía de uso, también se muestra dentro de la consola) y
  `CONTRIBUTING.md` (arquitectura y referencia técnica detallada: léela antes de tocar el NLU;
  se llama así para que GitHub la muestre como pestaña junto al README).
- Preferencias ya expresadas: modo oscuro **clásico** (grises neutros, sin tintes azulados);
  quiere poder ver y entender el entrenamiento; quiere todo subido a GitHub; quiere una interfaz
  **moderna, con microanimaciones, tablas bonitas e intuitiva**, y la referencia de la API con el
  mismo estilo que la consola. La pizzería le parece el ejemplo perfecto para aprender; el hotel
  es para ver el potencial («que no parezca tonto ni se pierda con cualquier cosa»).

## Arranque y comandos

```bash
python -m venv .venv && .venv\Scripts\activate && pip install -r requirements-dev.txt
python -m app                         # http://localhost:8000  (--port --host --data --no-browser)
python -m pytest                      # 131 pruebas (deben pasar siempre)
pip install playwright && python -m pytest tests/e2e -m e2e   # 22 pruebas en navegador real
python tools/benchmark_massive.py     # acierto con MASSIVE (referencia: 59 % k=10, 65,6 % k=20)
python tools/probar_nlu.py "frase"    # prueba rápida del NLU (--agente hotel para el ejemplo grande)
python tools/build_pizzeria.py        # regenera examples/pizzeria.json desde notación [texto](param)
python tools/build_hotel.py           # regenera examples/hotel.json y comprueba sus anotaciones
python tools/capturas_docs.py         # rehace las capturas de docs/img (Playwright)
python tools/build_icons.py           # rehace favicon.ico y web/icons/*.png desde web/favicon.svg
```

En Windows el usuario arranca con doble clic en `iniciar.bat` (crea `.venv`, instala y lanza).

## Mapa rápido

- `app/nlu/`: motor de lenguaje propio (tokenizador, stemmer, corrector, entidades `@sys.*` y
  propias, rasgos, clasificador, motor, `insights.py` para la página Entrenar).
- `app/dialog.py`: turnos de conversación (contextos, slot filling, fallback, webhook).
- `app/server.py`: API FastAPI, sirve `web/` en `/`, `docs/` en `/guia` y la referencia de la API
  en `/docs` (página propia `web/api.html` + `js/apidocs.js` que lee `/openapi.json`; Swagger está
  desactivado porque depende de un CDN). Cada ruta lleva `summary=` en español, docstring y ejemplos.
- `app/storage.py`: agentes en `data/agents/<id>.json`, conversaciones en `data/runtime.sqlite3`
  (`data/` no se sube a Git).
- `web/`: consola en JavaScript sin compilación (módulos ES). `js/ui.js` tiene `h()` y los
  componentes comunes (`pageHead`, `dataTable`, `segmented`, `codeBlock`/`codeTabs`, `emptyState`,
  `busy`, `countUp`, `stagger`, tooltips, tema); `js/palette.js` el buscador Ctrl+K;
  `js/pages/learn.js` la página «Entrenar»; `js/charts.js` los gráficos; `js/markdown.js` pinta
  `docs/GUIA.md`. `css/app.css` tiene los colores, la fuente (Inter local, `web/fonts/`) y las
  animaciones; `css/api.css` lo propio de `/docs`.
- `examples/pizzeria.json` (pequeño, para aprender) y `examples/hotel.json` (88 intenciones, más de
  2.000 frases, para enseñar el potencial): se copian una vez cada uno al arrancar
  (`server.py:seed_examples`, marca en `data/seeded_examples.json`; un ejemplo borrado no vuelve).
  Se generan con `tools/build_pizzeria.py` y `tools/build_hotel.py`: no editar el JSON a mano.
- `tests/casos_pizzeria.py`: frases de calibración (en dominio, con contexto, fuera de dominio).
  `tests/casos_hotel.py` y `tests/test_hotel.py`: lo mismo para el hotel, más conversaciones.
- La consola abre en la lista de agentes (`#/agents`), no en un agente.

## Convenciones

- Identificadores en inglés; comentarios, textos de interfaz y documentación en español.
- Python 3.11+, sin dependencias pesadas: FastAPI, uvicorn, numpy, snowballstemmer, tzdata.
  No añadir scikit-learn ni frameworks JS sin hablarlo.
- Todo agente que entra (API, importación, consola) pasa por `app/agents.py:normalize_agent()`.
- La consola construye el DOM con `h()` de `web/js/ui.js`; **nunca `innerHTML` con datos de
  usuario** (solo iconos SVG constantes y el logotipo).
- Colores: variables CSS en `web/css/app.css` (`--panel`, `--text`, `--accent-text`, `--primary`,
  `--series-1`…), con valores para claro y oscuro (el oscuro, grises neutros). Los colores de
  gráficos están validados para daltonismo; si se cambian, revalidar.
- Antes de crear un componente nuevo, mira si ya hay uno en `ui.js`. Las páginas empiezan con
  `pageHead({icon, title, sub, actions})`; las tablas de datos usan `dataTable()` (ordenables).
- Microanimaciones cortas en CSS y siempre desactivadas con `prefers-reduced-motion`. Los `title`
  se ven como tooltips propios. El logotipo está en `web/favicon.svg` y en `ui.js:logo()`.
- Probar también a ~1280 px con el simulador abierto (zona central estrecha): nada debe salirse
  ni estrujarse. Los bloques de código siguen el tema (claros en claro); el widget tiene
  `data-theme` (light/dark/auto) y su vista previa en Integraciones usa los mismos colores.
- Antes de dar algo por terminado: `python -m pytest` y, si se toca la consola, las pruebas e2e y
  capturas con Playwright (Edge instalado: `p.chromium.launch(channel="msedge")`) mirando las
  imágenes; `tools/capturas_docs.py` rehace las de la documentación. Revisar claro, oscuro y móvil.
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
- El texto libre (`@sys.any` y demás `ANY_LIKE`) cuenta como palabras al entrenar, no como entidad:
  al preguntar nunca se detecta. Al extraerlo se corta antes de otro dato de la intención y sin
  muletillas delante.
- Una plantilla con comodín no gana si el modelo ve más probable el fallback.
- Parámetros del mismo tipo: se reparten por lo que llevaban a los lados en las anotaciones;
  «un/una» solo es número si lo de detrás encaja.
- Medir con frases nuevas escritas aparte (comprobando que no están ya en el entrenamiento): la
  validación cruzada es pesimista con frases variadas (hotel: 65 % frente a 91,5 %).
- Detalles y números de cada decisión: `CONTRIBUTING.md`.

## Entorno del ordenador original (Windows 11)

- `NoDefaultCurrentDirectoryInExePath=1`: desde una terminal, `iniciar.bat` hay que lanzarlo con su
  ruta completa (con doble clic funciona normal).
- Para imprimir tildes desde Python en la consola: `PYTHONIOENCODING=utf-8`.
- Tras cambiar código Python (o hacer `git pull`) hay que reiniciar el servidor; JS/CSS se sirven en
  caliente (recargar). La consola avisa si el servidor va con código anterior (`restartNeeded` en
  `/api/info` y `APP_VERSION` de `web/js/app.js` frente a `app/__init__.py`: al subir la versión,
  cambiar las dos).
- No hay Node instalado; la consola no lo necesita.

## Ideas pendientes (por orden de utilidad)

1. Respuestas condicionales (según `$param`) y respuestas por canal.
2. Exportar a ZIP de Dialogflow ES (ahora solo se importa).
3. Modo avanzado opcional con *embeddings* multilingües (onnxruntime + MiniLM) para acertar más con
   pocas frases; mantener el modo actual por defecto.
4. Entidades compuestas; diccionarios para `@sys.geo-city` / `@sys.given-name`.
5. Más idiomas (stemmers Snowball ya disponibles para fr/it/pt/de/ca/nl; faltan números y fechas).
6. En la página Entrenar: animar también el examen ronda a ronda.
7. Lista de intenciones agrupada por prefijo (`reserva.*`, `charla.*`…): con las 88 del hotel se
   hace larga.

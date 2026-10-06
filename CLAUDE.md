# Lince (agente conversacional) — contexto para Claude

**Lince** es una alternativa libre y local a **Dialogflow ES** para crear chatbots en español, con
una consola web que además sirve para **aprender cómo funciona el NLU por dentro** (página
«Entrenar»). Desde la 0.13.0 tiene también **machine learning** (como un Azure ML sencillo y
transparente): proyectos con una tabla o imágenes, entrenamiento automático o personalizado, modelos
que se ven por dentro y una API para usarlos. El nombre: «listo como un lince» y «vista de lince» (ver el modelo por dentro); el
logotipo es la cabeza de un lince ibérico (pinceles negros, barba) sobre el degradado morado
(`web/favicon.svg`).
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
  es para ver el potencial («que no parezca tonto ni se pierda con cualquier cosa»). **Nada de
  píldoras** (`border-radius: 999px`; le parecen un tic de diseño hecho con IA): esquinas suaves,
  también en el chat, pero sin quedarse sobrio (le gusta con color y vida). **Odia el aspecto de los
  controles del navegador**: nada de `<select>` ni `<input type="color">` (usar `selectMenu()` y
  `colorPicker()` de `ui.js`). Su kit de interfaz de referencia está en `Plantillas/` (fuera de Git,
  solo en su ordenador: `uikit/src/sections/*.astro` y `uikit/src/styles/global.css`); de ahí salen el
  «Menú Expansible» y el «Color Picker HSV». Los ejemplos van
  aparte, debajo de sus agentes («Tus agentes» empieza vacío). El logotipo tiene que verse como un
  lince de verdad y bonito (rediseñado en la 0.6.0: pinceles, barba, ojos con brillo). Lo comparte
  con sus compañeros de clase (todos con Windows): la web pública tiene **cuentas** (cada uno ve solo
  sus agentes y los comparte con un enlace que da una copia), pero la red del instituto (Educacyl)
  bloquea `duckdns.org`, así que en clase usan la instalación local (README, muy paso a paso).
- Despliegue: <https://linceflow.duckdns.org>, Coolify en un servidor Oracle ARM de 24 GB, con el
  `Dockerfile` del repositorio, `AGENTE_ACCOUNTS=1`, `AGENTE_VIGIA_CLAVE` (su Vigía, en
  nexopablooms.duckdns.org: el servidor añade el script a las páginas solo si está) y un volumen en `/data`. Coolify construye desde
  GitHub: tras subir cambios hay que pulsar *Redeploy*.

## Arranque y comandos

```bash
python -m venv .venv && .venv\Scripts\activate && pip install -r requirements-dev.txt
python -m app                         # http://localhost:8000  (--port --host --data --no-browser --accounts)
python -m pytest                      # 184 pruebas (deben pasar siempre)
pip install playwright && python -m pytest tests/e2e -m e2e   # 44 pruebas en navegador real
python tools/benchmark_massive.py     # acierto con MASSIVE (referencia: 59 % k=10, 65,6 % k=20)
python tools/probar_nlu.py "frase"    # prueba rápida del NLU (--agente hotel para el ejemplo grande)
python tools/build_pizzeria.py        # regenera examples/pizzeria.json desde notación [texto](param)
python tools/build_hotel.py           # regenera examples/hotel.json y comprueba sus anotaciones
python tools/build_ml_examples.py     # regenera examples/ml/*.csv (pingüinos y bicis, con sus licencias)
python tools/capturas_docs.py         # rehace las capturas de docs/img (Playwright)
python tools/build_icons.py           # rehace favicon.ico, web/icons/*.png y web/og.png desde web/favicon.svg
python tools/actualizar_vigia.py      # pone al día web/js/vigia.js (la copia de Vigía que sirve Lince)
python -m app.users [password <usuario>]   # servidor con cuentas: usuarios / contraseña nueva
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
- `app/spaces.py`: el servidor con cuentas (`AGENTE_ACCOUNTS=1` o `--accounts`): `Accounts` (scrypt,
  bloqueo tras 8 fallos), `Spaces` (un espacio `data/spaces/<id>/` por usuario, con su `Storage`,
  modelos y diálogo; la llave va en `X-Space-Key`), `Shares` (copias en `data/shared/`, sin clave de
  API ni webhook) y `ModelPool` (modelos compartidos entre agentes iguales). Sin cuentas hay un único
  `Space` (la carpeta `data/`): la instalación local funciona como siempre. Las rutas de conversación
  aceptan la dirección pública «<espacio>.<agente>» (`publicId`); sin llave ni punto, los ejemplos de
  `data/demo/`. **Sin cuenta** (`POST /api/guest`): un espacio sin usuario cuya llave solo está en ese
  navegador; si luego crea la cuenta con esa llave, la cuenta se queda con el espacio. En la consola:
  `js/account.js` (la portada, crear la cuenta, entrar sin cuenta, contraseña), `pages/share.js` (Compartir,
  con su entrada en el menú) y `pages/shared.js` (abrir un enlace compartido).
- Web pública (0.11.0, tras una auditoría): con cuentas, `index.html` trae una **portada** estática
  (`#landing`, bloque `<!-- portada -->` que `page()` quita sin cuentas) con h1, texto, enlaces y el
  formulario, al que `account.js:signInPage()` da vida; quien ya tiene llave no la ve (`data-boot`).
  `server.py` manda cabeceras de seguridad (`protect()`), CSP por página con las huellas de sus
  `<script>` en línea (`page()`), CORS solo en `PUBLIC_ROUTES` (`PublicCORS`), el JS/CSS/fuente con
  huella (`/v/<huella>/…`, un año de caché), `robots.txt`, `sitemap.xml` y `og.png`. `web/sw.js` solo
  enseña `offline.html` si no hay red. Las páginas de la consola se cargan con `import()`. El
  `Dockerfile` instala `requirements.lock` (generado en Linux con Python 3.12: ver su cabecera).
  0.12.0 (segunda auditoría): páginas con `GET` y `HEAD` (`web_route()`) y guardadas ya hechas
  (`render()`), `/chat?agent=…` con nombre, idioma, manifiesto propio (instalable), «Volver» y tema
  (`js/chat-page.js`), Vigía servido desde `web/js/vigia.js` (`tools/actualizar_vigia.py`), `--faint`
  con contraste AA y foco con `outline`. 0.12.1: la portada va fuera de `#app` y se desplaza con la
  página (sin fundidos al entrar) y `/docs` trae la referencia en HTML sencillo (`static_reference()`).
  Los auditores de Pablo miran los píxeles: nada de texto en degradado ni de fundidos en lo que se ve
  al cargar. Detalles en CONTRIBUTING, «Web pública».
- `web/`: consola en JavaScript sin compilación (módulos ES). `js/ui.js` tiene `h()` y los
  componentes comunes (`pageHead`, `dataTable`, `segmented`, `codeBlock`/`codeTabs`, `emptyState`,
  `busy`, `countUp`, `stagger`, `tocNav` (índice de Guía y «Por dentro»), `selectMenu` (en lugar de
  `<select>`), `colorPicker`, `tokenGloss` (la tokenización), tooltips, tema);
  `js/palette.js` el buscador Ctrl+K; `js/notes.js` las notas de la versión (`docs/NOVEDADES.md`);
  `js/pages/learn.js` la página «Entrenar»; `js/pages/inside.js` «Por dentro» (el motor con sus
  fórmulas y una frase de ejemplo; si cambia una fórmula del NLU, actualizarla también ahí);
  `js/math.js` fórmulas TeX → MathML sin librerías; `js/charts.js` los gráficos; `js/markdown.js` pinta
  `docs/GUIA.md`. `css/app.css` tiene los colores, la fuente (Inter local, `web/fonts/`) y las
  animaciones; `css/api.css` lo propio de `/docs`.
- `app/ml/`: el machine learning, todo con numpy (sin scikit-learn). `table.py` lee el CSV y adivina
  los tipos; `prep.py` prepara las filas (vacíos, fechas, one-hot, escalar); `algorithms.py` los
  algoritmos (línea base, lineal, logística, árbol, bosque, k vecinos, Naive Bayes, k-medias), cada uno
  con `learned()` y `explain()`; `metrics.py`; `runner.py` un entrenamiento paso a paso (`AUTO`, el
  modo automático); `cnn.py` la red convolucional y las líneas base de píxeles; `codegen.py` el script
  equivalente; `store.py` los proyectos en `<espacio>/ml/<proyecto>/`; `api.py` las rutas `/api/ml/…`
  (entrenamientos en segundo plano, dos a la vez como mucho; predecir un CSV entero: `…/batch`). Los ejemplos: `examples.py` y
  `examples/ml/` (formas dibujadas al vuelo).
- Consola de machine learning: el botón «Chatbots / Machine learning» de la barra lateral cambia
  `state.mode`; rutas `#/ml`, `#/ml/guide`, `#/ml/inside` y `#/p/<proyecto>/data|train|jobs/<id>|
  models|models/<id>|predict|api|guide|inside`. Páginas `pages/ml-*.js`; piezas comunes en
  `js/ml-common.js` (formatos, imágenes a 64 × 64, cámara), `js/ml-charts.js` (gráficos) y
  `js/ml-views.js` (el porqué de una predicción, lo que ve la red). Guía: `docs/ML.md`.
- `examples/pizzeria.json` (pequeño, para aprender) y `examples/hotel.json` (88 intenciones, más de
  2.000 frases, para enseñar el potencial): se copian una vez cada uno al arrancar
  (`server.py:seed_examples`, marca en `data/seeded_examples.json`; un ejemplo borrado no vuelve)
  con `"example": true`, y la consola los enseña aparte (duplicar, exportar o importar quita la marca).
  Se generan con `tools/build_pizzeria.py` y `tools/build_hotel.py`: no editar el JSON a mano.
- `tests/casos_pizzeria.py`: frases de calibración (en dominio, con contexto, fuera de dominio).
  `tests/casos_hotel.py` y `tests/test_hotel.py`: lo mismo para el hotel, más conversaciones.
- La consola abre en la lista de agentes (`#/agents`), no en un agente: arriba «Tus agentes» y
  debajo «Ejemplos» (`pages/agents.js:splitAgents`, que usan también el menú de agentes y Ctrl+K).

## Convenciones

- Identificadores en inglés; comentarios, textos de interfaz y documentación en español.
- Python 3.11+, sin dependencias pesadas: FastAPI, uvicorn, numpy, snowballstemmer, tzdata.
  No añadir scikit-learn ni frameworks JS sin hablarlo.
- Todo agente que entra (API, importación, consola) pasa por `app/agents.py:normalize_agent()`.
- La consola construye el DOM con `h()` de `web/js/ui.js`; **nunca `innerHTML` con datos de
  usuario** (solo iconos SVG constantes y el logotipo).
  `h()` se salta los `null`, pero `Element.append(null)` escribe «null» en la página: filtrar antes.
- Colores: variables CSS en `web/css/app.css` (`--panel`, `--text`, `--accent-text`, `--primary`,
  `--series-1`…), con valores para claro y oscuro (el oscuro, grises neutros). Los colores de
  gráficos están validados para daltonismo; si se cambian, revalidar.
- Antes de crear un componente nuevo, mira si ya hay uno en `ui.js`. Las páginas empiezan con
  `pageHead({icon, title, sub, actions})`; las tablas de datos usan `dataTable()` (ordenables).
- Accesibilidad: el gris tenue (`--faint`) cumple 4,5:1 en todos los fondos; si se cambia, revalidar.
  Foco con el teclado: `outline` de 2 px (sin transición), no solo un halo. Bajo un degradado con texto
  blanco, poner también su color de fondo (`linear-gradient(…) var(--brand-1)`).
- Por la CSP: nada de `onclick="…"` en el HTML ni `eval`; en las pruebas, `wait_for_function("() => …")`
  (con texto suelto Playwright usa `eval` y la CSP lo bloquea). Los módulos se importan con rutas
  relativas (si no, se saltan la huella de la caché).
- Microanimaciones cortas en CSS y siempre desactivadas con `prefers-reduced-motion`. Los `title`
  se ven como tooltips propios. El logotipo está en `web/favicon.svg` y en `ui.js:logo()` (una
  prueba comprueba que son el mismo dibujo; tras cambiarlo, `tools/build_icons.py`).
- Probar también a ~1280 px con el simulador abierto (zona central estrecha) y en el móvil
  (320-390 px): nada debe salirse ni estrujarse. «Por dentro» tiene su prueba e2e a 320 y 390 px;
  las fórmulas que no caben se encogen solas (`math.js:fitFormulas`). Los bloques de código siguen
  el tema (claros en claro); el widget tiene `data-theme` (light/dark/auto) y su vista previa en
  Integraciones usa los mismos colores.
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
- `NaiveBayes` (classifier.py) solo existe para el recuadro «¿Y el teorema de Bayes?» de «Por dentro»
  (paso 7): no participa en ninguna decisión.
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
  cambiar las dos y añadir sus notas arriba en `docs/NOVEDADES.md`, en lenguaje sencillo; **fechadas el
  2 de octubre de 2026**, que lo pidió así).
- No hay Node instalado; la consola no lo necesita.

## Machine learning: detalles que conviene no romper

- Lo que se aprende al preparar (medianas, medias, categorías) sale solo de las filas de
  entrenamiento y se guarda con el modelo; las filas nuevas se preparan igual (`Preparer`).
- La columna que se predice nunca es columna para aprender (lo comprueba `runner.check_config`).
- El modo automático elige por la media de la validación cruzada y siempre incluye la línea base.
- Con más de tres grupos, los gráficos no usan más colores: todo en gris y el grupo elegido resaltado
  (solo `--series-1/2/3` están validados para daltonismo de tres en tres).
- Al agrupar, la columna con la que se comparan los grupos tampoco es para aprender (`check_config`).
- En Windows no se puede reemplazar un fichero mientras otro hilo lo lee, y la consola lee el
  entrenamiento cada medio segundo: `store._write_json`/`_read_json` reintentan. No quitarlo (sin eso,
  un entrenamiento se quedaba «Entrenando» para siempre).
- Lo que devuelve un modelo pasa por `api.plain()` (los números de numpy no van en JSON) y los
  scripts de `codegen.py` tienen que compilar (lo prueba `tests/test_ml.py`).
- Decimales con coma también en el registro del entrenamiento (la consola lo lee: `ml-job.js:EPOCH_RE`
  acepta las dos), R² y silueta siempre con tres decimales y número y «%» sin partir (espacio duro).

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

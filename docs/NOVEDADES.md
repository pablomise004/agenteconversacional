# Novedades de Lince

Lo que trae cada versión, de la más nueva a la más antigua. En la consola se ven pulsando el número
de versión (abajo a la izquierda, o arriba en la referencia de la API).

## 0.8.0 · 2 de octubre de 2026

**Copiar cualquier agente, notas de la versión y un aspecto más limpio.**

- **Notas de la versión**: pulsa el número de versión para ver qué ha cambiado. Un punto en el número
  avisa de que hay novedades que todavía no has visto.
- **Crear agente**: elige *Vacío* o *Copia de un agente* y busca el que quieras copiar: uno tuyo o uno
  de ejemplo. Si borraste un ejemplo, también puedes copiar el original.
- **Índice de la Guía y de «Por dentro»** en el móvil y con el simulador abierto: una barra pegada
  arriba dice en qué sección estás y despliega la lista para saltar a otra.
- **Más limpio**: etiquetas, contadores y botones con esquinas suaves en lugar de forma de píldora.
  En el chat (simulador, widget y página `/chat`), la caja de escribir lleva dentro el botón de
  enviar, las respuestas rápidas son botones y los avisos, una línea fina.
- **Pantallas grandes**: las páginas llegan hasta 1.360 px de ancho y los textos ya no se parten en
  dos líneas antes de tiempo.
- La Guía ya no se sale por la derecha en el móvil, y en el móvil las cabeceras fijas quedan debajo
  de la barra de arriba en vez de esconderse detrás.
- API: `copyOf` al crear un agente (copia de otro tuyo) y `examples` en `/api/info`.

## 0.7.0 · 2 de octubre de 2026

**Cuentas de usuario y agentes compartidos con un enlace.**

- En la web pública cada persona entra con su **usuario y contraseña** y solo ve sus agentes. La
  instalación en tu ordenador sigue igual, sin cuentas.
- **Compartir** (Ajustes → Compartir): un enlace con una copia del agente, sin su clave de API ni su
  webhook. Quien lo abre guarda su propia copia o descarga el JSON.
- El widget y el chat tienen una dirección pública para cada agente, y sin cuenta se puede hablar
  con los ejemplos.
- **«Por dentro» en el móvil**: las fórmulas que no caben se encogen solas y los gráficos y tablas se
  ordenan para la pantalla estrecha. Los paréntesis de las fórmulas ya no salen enormes.
- **Instalación en Windows paso a paso** en el README (Python desde la Microsoft Store o desde su web)
  y cómo ponerlo en un servidor con Coolify.

## 0.6.0 · 2 de octubre de 2026

**Página «Por dentro» y un lince nuevo.**

- **«Por dentro»**: los once pasos del motor de lenguaje, cada uno con su fórmula, qué significa cada
  símbolo y los números de verdad de una frase de tu agente, que puedes cambiar.
- **Logotipo nuevo**: la cabeza de un lince ibérico, con sus pinceles en las orejas y su barba.
- Los ejemplos van aparte: arriba, *Tus agentes* (vacío al principio) y debajo, *Ejemplos*.
- La matriz del examen cabe en el ancho aunque el agente tenga muchas intenciones.

## 0.5.0 · 1 de octubre de 2026

**El hotel: un ejemplo grande para ver hasta dónde llega.**

- **Hotel (ejemplo)**: Mira, la recepcionista virtual del Hotel Mirador, con 88 intenciones y más de
  2.000 frases: reservas, cambios, cancelaciones, peticiones a la habitación, averías, quejas,
  turismo y charla.
- La consola abre en la lista de agentes.
- Entiende mejor el texto libre («la persiana no sube»), reparte bien varios números en una frase
  («para 3 noches para 2 personas») y entiende más fechas y horas («del 12 al 15», «despiértame a
  las 7»).
- No repite seguida la misma variante de respuesta.

## 0.4.1 · 1 de octubre de 2026

**Arreglos.**

- El menú de agentes ya no se sale de su sitio y las cabeceras no se estrujan con el simulador
  abierto.
- Los bloques de código siguen el tema: claros en el modo claro.
- El widget tiene tema claro, oscuro o automático.
- La consola avisa si el servidor sigue con una versión anterior y hay que reiniciarlo.

## 0.4.0 · 1 de octubre de 2026

**Nace Lince.**

- Nombre y logotipo nuevos, y una consola rediseñada: fuente Inter, colores revisados en claro y
  oscuro y microanimaciones.
- Buscador **Ctrl+K** para saltar a cualquier página, intención, entidad o frase.
- Referencia de la API propia en `/docs`, con ejemplos en curl, JavaScript y Python y un «Pruébalo»
  que lanza peticiones de verdad.
- Vista previa en vivo del widget en Integraciones y gráfico de actividad en Historial.

## 0.3.0 · 1 de octubre de 2026

**Ver cómo aprende el agente.**

- **Entrenar**: el entrenamiento paso a paso y animado, la curva de aprendizaje, qué palabras pesan en
  cada intención, el mapa de frases y el examen con su matriz de confusión.
- **Guía de uso** dentro de la consola.
- Modo oscuro clásico, con grises neutros, y colores de gráficos pensados para el daltonismo.

## 0.2.0 · 1 de octubre de 2026

**Conversaciones, consola web y widget.**

- Diálogo como en Dialogflow ES: contextos, eventos, preguntas por los datos que faltan,
  cancelación, fallback y webhook.
- API REST, importación de agentes de Dialogflow ES (ZIP o JSON) y clave de API por agente.
- Consola web para crear intenciones y entidades, analizar frases, revisar conversaciones y
  probarlo todo en el simulador.
- Widget de chat para cualquier web y página de chat completa.

## 0.1.0 · 30 de septiembre de 2026

**El motor de lenguaje.**

- Entiende frases en español con faltas, sin tildes y con abreviaturas de chat.
- Fechas, horas, números, cantidades de dinero y entidades propias con sinónimos.
- Clasificador TF-IDF con regresión logística y el agente de ejemplo de la pizzería.

# Guía de machine learning

Además de chatbots, Lince entrena **modelos de machine learning** con tus datos: una tabla (CSV) o
imágenes. Todo se entrena en el propio servidor, sin servicios de fuera, y todo se puede ver por
dentro: qué ha aprendido cada modelo, por qué predice lo que predice y el código equivalente en Python.
Se entra con el botón **Machine learning** de arriba de la barra lateral.

## Primeros pasos

1. **Crea un proyecto.** En *Machine learning → Nuevo proyecto* eliges si tus datos son una tabla
   (CSV) o imágenes. Para practicar, los **ejemplos** ya traen los datos: *Pingüinos* (clasificar la
   especie o agruparlos), *Alquiler de bicis* (predecir un número) y *Formas* (imágenes).
2. **Datos.** Sube el CSV (o las fotos de cada clase, o hazlas con la cámara). Revisa el tipo de cada
   columna: número, categoría, fecha o texto libre.
3. **Entrenar.** Elige qué quieres hacer, la columna que se predice y con qué columnas aprende. En
   modo **automático** prueba varios algoritmos y se queda con el mejor; en modo **eligiendo tú**
   escoges el algoritmo y mueves sus ajustes.
4. **Modelos.** Cada entrenamiento deja uno o varios modelos. Ábrelos para ver sus resultados, lo que
   han aprendido, cómo se prepararon los datos y su script de Python.
5. **Probar y API.** Prueba un modelo con una fila escrita a mano (o una imagen) y publícalo para
   llamarlo desde tu web o tu aplicación.

## Qué se puede hacer

| Tarea | Para qué | Ejemplo |
|---|---|---|
| **Clasificar** | Predecir una categoría | La especie de un pingüino por sus medidas |
| **Predecir un número** (regresión) | Predecir una cantidad | Cuántas bicis se alquilarán según el tiempo |
| **Agrupar** (sin etiquetas) | Encontrar grupos de filas parecidas, sin respuesta que copiar | Pingüinos parecidos sin decirle la especie |
| **Clasificar imágenes** | Distinguir fotos o dibujos por clases | Círculos, cuadrados y triángulos |

## Los datos

Un **CSV** es una tabla guardada como texto: la primera fila con el nombre de cada columna y una fila
por ejemplo. Excel, Google Sheets o LibreOffice lo guardan con *Guardar como → CSV*. Vale separado por
comas, punto y coma o tabuladores, con coma o punto decimal: se detecta solo.

Cada columna tiene un **tipo**:

- **Número**: medidas, precios, edades.
- **Categoría**: unos pocos valores que se repiten (una isla, sí o no). Un número que en realidad es
  un código (un año, un código postal) suele ir mejor como categoría.
- **Fecha**: se parte en año, mes y día de la semana.
- **Texto libre**: casi todos distintos; no se usa para aprender. Las columnas que parecen un
  identificador (uno distinto en cada fila) tampoco.

Con **imágenes**, crea una clase por cada cosa que quieras distinguir y añade unas 20 fotos de cada
una, variadas (fondo, luz, posición): si todas las fotos de una clase tienen el mismo fondo, el modelo
puede aprenderse el fondo. Se recortan al centro y se reducen a 64 × 64 píxeles en el navegador.

## Entrenar y examinar

Antes de aprender se **esconde una parte de las filas** (el 20 %) para el examen final: un modelo que
se aprendiera los datos de memoria sacaría un 10 con sus propias filas y fallaría con las nuevas. Con
la **validación cruzada** la idea se repite dentro del entrenamiento (5 rondas, cada una con un trozo
distinto de examen) y la media de esas notas es la que usa el modo automático para elegir.

Siempre se incluye la **línea base** (decir siempre lo más frecuente, o la media): un buen modelo
tiene que ganarla de sobra. Si un modelo saca mucho más con sus filas que en el examen, lo marca como
**«memoriza»** (sobreajuste): prueba a hacerlo más sencillo o a darle más datos.

## Los algoritmos

- **Regresión lineal / logística**: suman cada columna multiplicada por un peso. Se ven sus pesos.
- **Árbol de decisión**: preguntas de sí o no («¿aleta ≤ 206 mm?»). Se ve el árbol dibujado.
- **Bosque aleatorio**: muchos árboles distintos que votan.
- **k vecinos**: busca las filas más parecidas. Se ven los vecinos de cada predicción.
- **Naive Bayes**: el teorema de Bayes, columna a columna.
- **k-medias**: agrupa en k grupos (elige k con la silueta).
- **Red neuronal convolucional** (imágenes): aprende sus propios filtros. Se ven los filtros, lo que ve
  cada capa y dónde ha mirado para decidir.

Las fórmulas de cada uno están en **Por dentro** (en *Ayuda*, dentro de Machine learning).

## Las notas

- **Exactitud**: qué parte del examen acierta. **Exactitud equilibrada** y **F1**: no se dejan engañar
  si una clase es mucho más frecuente. La **matriz de confusión** dice con qué se confunde cada clase.
- **R²**: qué parte de la variación explica (1 es perfecto; 0, como decir siempre la media). **RMSE**
  y **MAE**: lo que se equivoca, en las unidades de lo que se predice.
- **Silueta** (agrupar): si cada fila está más cerca de los de su grupo que de los del vecino.
- **Importancia de las columnas**: cuánto empeora el modelo si se barajan los valores de una columna.

## Usar el modelo desde tu web

En la página **API** del proyecto publicas un modelo: responde en
`POST /api/ml/<dirección>/predict` con las filas (o las imágenes) que le mandes. La dirección no cambia
aunque publiques otro modelo. Con una **clave de API**, solo responde a quien la mande en la cabecera
`X-Api-Key`. La página trae ejemplos en curl, JavaScript y Python.

## Si vienes de Azure Machine Learning

| En Azure | En Lince |
|---|---|
| Área de trabajo | El proyecto |
| Recurso de datos | Datos: el CSV o las imágenes por clases |
| Trabajo de ML automatizado | Entrenar en modo «Automático» |
| Script de entrenamiento personalizado | Entrenar «Eligiendo tú» y el script de la pestaña «Código» del modelo |
| Proceso (clúster de cálculo) | El propio servidor: no hay que crear nada |
| Modelo registrado | Cada modelo de la página Modelos |
| Punto de conexión en línea | Publicar un modelo (página API) |

El script de la pestaña **Código** (scikit-learn para tablas, PyTorch para imágenes) hace lo mismo que
el modelo: sirve para verlo como código, ejecutarlo en tu ordenador o llevarlo a Azure ML.

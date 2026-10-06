// «Por dentro» del machine learning: qué hace cada paso y cada algoritmo, con sus fórmulas (las mismas
// que hay en app/ml/), qué significa cada símbolo y algún ejemplo que se puede tocar.
import { h, icon, clear, pageHead, tocNav, rangeFill } from "../ui.js";
import { barList, nf } from "../charts.js";
import { fitFormulas, tex } from "../math.js";
import { projectPath, state } from "../app.js";

const SECTIONS = [
  ["idea", "La idea"],
  ["separar", "Separar: entrenamiento y examen"],
  ["preparar", "Preparar los datos"],
  ["baseline", "La línea base"],
  ["linear", "Regresión lineal"],
  ["logistic", "Regresión logística"],
  ["tree", "Árbol de decisión"],
  ["forest", "Bosque aleatorio"],
  ["knn", "k vecinos más cercanos"],
  ["bayes", "Naive Bayes"],
  ["kmeans", "k-medias (agrupar)"],
  ["metricas", "Las notas: métricas"],
  ["importancia", "Qué columnas importan"],
  ["plano", "Dibujar en un plano (PCA)"],
  ["cnn", "Red neuronal convolucional"],
  ["automatico", "El modo automático"],
];
// la sección de cada algoritmo (los enlaces «Cómo funciona por dentro» de un modelo)
const ALIAS = { pixels_logistic: "logistic", pixels_knn: "knn" };

const formula = (src) => h("div", { class: "formula" }, [src].flat().map((s) => tex(s, { display: true })));
const legend = (rows) => h("dl", { class: "sym-legend" }, rows.map(([sym, text]) => [h("dt", null, tex(sym)), h("dd", null, text)]));
const codeRef = (...paths) => h("div", { class: "code-ref" }, icon("code"), "En el código: ", paths.map((p, i) => [i ? ", " : "", h("code", null, p)]));
const note = (...kids) => h("div", { class: "notice info in-note" }, icon("info"), h("div", null, ...kids));
const p = (...kids) => h("p", null, ...kids);
const ul = (...items) => h("ul", { class: "in-list" }, items.map((i) => h("li", null, ...[i].flat())));

function liveBox(title, ...content) {
  return h("div", { class: "live" }, h("div", { class: "live-title" }, icon("sparkle"), title), h("div", { class: "live-body" }, ...content));
}

function slider({ label, min, max, step, value, onInput, fmt = (v) => nf(2).format(v) }) {
  const out = h("span", { class: "range-value" }, fmt(value));
  const input = h("input", { type: "range", min, max, step, value, "aria-label": label,
    oninput: () => { out.textContent = fmt(+input.value); rangeFill(input); onInput(+input.value); } });
  rangeFill(input);
  return h("div", { class: "param" }, h("div", { class: "param-top" }, h("label", null, label), out), input);
}

// softmax con tres puntuaciones que se mueven
function softmaxDemo() {
  const z = [2, 1, 0.2];
  const names = ["Adelia", "Barbijo", "Papúa"];
  const bars = h("div");
  const formulaBox = h("div");
  const paint = () => {
    const e = z.map((v) => Math.exp(v));
    const s = e.reduce((a, b) => a + b, 0);
    clear(bars).append(barList({ items: names.map((n, i) => ({ label: n, value: e[i] / s })), max: 1, labelWidth: 90,
      format: (v) => nf(1).format(v * 100) + " %" }));
    clear(formulaBox).append(formula(`p_{\\text{Adelia}} = \\frac{e^{${nf(1).format(z[0])}}}{e^{${nf(1).format(z[0])}} + e^{${nf(1).format(z[1])}} + e^{${nf(1).format(z[2])}}} = ${nf(3).format(e[0] / s)}`));
    fitFormulas(formulaBox);
  };
  const sliders = names.map((n, i) => slider({ label: `Puntuación de ${n} (z)`, min: -3, max: 5, step: 0.1, value: z[i], fmt: (v) => nf(1).format(v),
    onInput: (v) => { z[i] = v; paint(); } }));
  paint();
  return liveBox("Pruébalo: mueve las puntuaciones", h("div", { class: "col", style: { gap: "12px" } }, ...sliders), formulaBox, bars,
    h("p", { class: "muted small", style: { margin: 0 } }, "Suma una misma cantidad a las tres y las probabilidades no cambian: solo importa la diferencia entre puntuaciones."));
}

// Gini de un grupo con dos clases
function giniDemo() {
  let a = 8, b = 2;
  const out = h("div");
  const paint = () => {
    const n = a + b || 1;
    const pa = a / n, pb = b / n;
    const g = 1 - pa * pa - pb * pb;
    const hh = -[pa, pb].filter((x) => x > 0).reduce((s, x) => s + x * Math.log2(x), 0);
    clear(out).append(formula([`G = 1 - \\left(${nf(2).format(pa)}^2 + ${nf(2).format(pb)}^2\\right) = ${nf(3).format(g)}`,
      `H = ${nf(3).format(hh)}`]),
    h("p", { class: "muted small", style: { margin: 0 } }, g < 0.05 ? "Casi puro: el árbol ya puede responder aquí." : g > 0.45 ? "Mezcladísimo: hace falta otra pregunta." : "Algo mezclado."));
    fitFormulas(out);
  };
  const sa = slider({ label: "Filas de la clase A en el grupo", min: 0, max: 20, step: 1, value: a, fmt: (v) => String(v), onInput: (v) => { a = v; paint(); } });
  const sb = slider({ label: "Filas de la clase B", min: 0, max: 20, step: 1, value: b, fmt: (v) => String(v), onInput: (v) => { b = v; paint(); } });
  paint();
  return liveBox("Pruébalo: lo mezclado que está un grupo", sa, sb, out);
}

// la validación cruzada en 5 rondas, dibujada
function kfoldView(k = 5) {
  return h("div", { class: "kfold" }, Array.from({ length: k }, (_, r) => h("div", { class: "kf-row" }, h("span", { class: "kf-label" }, `Ronda ${r + 1}`),
    Array.from({ length: k }, (_, c) => h("span", { class: "kf-cell" + (c === r ? " test" : "") }, c === r ? "examen" : "aprende")))));
}

export async function render(el, params, query) {
  const page = h("div", { class: "page inside cq" });
  el.append(page);
  page.append(pageHead({ icon: "cpu", title: "Por dentro del machine learning",
    sub: "Cómo aprende cada algoritmo, con sus fórmulas: las mismas que usa Lince (en app/ml/), sin librerías de machine learning." }));
  const toc = tocNav({ label: "Índice", scroller: el.closest(".main"),
    items: SECTIONS.map(([id, title], i) => ({ text: i ? `${i}. ${title}` : title, target: () => document.getElementById("ml-" + id) })),
    extra: [h("div", { class: "toc-title" }, "Más"),
      h("a", { href: state.project ? projectPath("guide") : "#/ml/guide" }, "Guía de machine learning"),
      state.project ? h("a", { href: projectPath("models") }, "Tus modelos") : h("a", { href: "#/ml" }, "Tus proyectos")] });
  const content = h("div", { class: "in-content" });
  page.append(h("div", { class: "guide-layout" }, toc.el, content));
  const section = (id, lead, ...body) => {
    const n = SECTIONS.findIndex((s) => s[0] === id);
    return h("section", { class: "card in-sec", id: "ml-" + id },
      h("div", { class: "card-head" }, n ? h("span", { class: "sec-num" }, String(n)) : icon("sparkle"), h("h2", null, SECTIONS[n][1])),
      h("div", { class: "card-body col in-body" }, h("p", { class: "lead" }, lead), ...body));
  };

  content.append(
    section("idea", "Aprender, para una máquina, es ajustar unos números (los parámetros) para que sus respuestas se parezcan a las de los ejemplos. Cada algoritmo tiene su forma de hacerlo; todos siguen el mismo camino:",
      ul([h("b", null, "Datos"), ": filas de ejemplo con sus columnas (o imágenes con su clase)."],
        [h("b", null, "Separar"), " una parte para el examen final, que el modelo no ve mientras aprende."],
        [h("b", null, "Preparar"), ": convertir cada fila en una lista de números."],
        [h("b", null, "Aprender"), ": buscar los parámetros que menos se equivocan con las filas de entrenamiento."],
        [h("b", null, "Examinar"), " con las filas escondidas: es lo único que dice si sabrá responder filas nuevas."],
        [h("b", null, "Predecir"), ": con un modelo aprendido, cada fila nueva se prepara igual y se le pasa."]),
      p("Hay dos grandes familias: el ", h("b", null, "aprendizaje supervisado"), " (cada fila trae la respuesta: clasificar o predecir un número) y el ",
        h("b", null, "no supervisado"), " (no hay respuesta: buscar grupos)."),
      codeRef("app/ml/runner.py")),

    section("separar", "Si se examinara al modelo con las mismas filas con las que ha aprendido, uno que se las aprenda de memoria sacaría un 10 sin saber nada. Por eso se esconde una parte (por defecto, el 20 %) para el examen final.",
      p("En clasificación, la separación es ", h("b", null, "estratificada"), ": cada clase va al examen en la misma proporción que tiene en los datos. Y con la ",
        h("b", null, "validación cruzada"), " se repite la idea dentro del entrenamiento: se parte en k trozos y, en cada ronda, aprende con todos menos uno y se examina con ese:"),
      kfoldView(5),
      formula("\\text{nota}_{\\text{validación}} = \\frac{1}{k} \\sum_{i=1}^{k} \\text{nota}_i"),
      p("La media de las k notas es más fiable que un solo examen, y su desviación (el ± que acompaña a la nota) dice cuánto depende de qué filas toquen. Es la nota con la que el modo automático elige."),
      codeRef("app/ml/runner.py: split_holdout, folds_of")),

    section("preparar", "Los algoritmos solo entienden números, así que cada fila se convierte en una lista de números. Todo lo que hace falta (medianas, medias, categorías) se aprende solo con las filas de entrenamiento, se guarda con el modelo y se aplica igual a cada fila nueva.",
      ul([h("b", null, "Vacíos"), ": un número que falta se rellena con la mediana de su columna; una categoría vacía es una categoría más, «(vacío)»."],
        [h("b", null, "Fechas"), ": cada una se parte en año, mes y día de la semana."],
        [h("b", null, "Categorías"), " (codificación one-hot): una columna de 0 y 1 por valor. «isla = Dream» vale 1 si la fila es de Dream y 0 si no. Así ningún valor es «mayor» que otro."]),
      p("Y los números se ", h("b", null, "estandarizan"), ": a cada uno se le resta la media de su columna y se divide por su desviación típica."),
      formula(["z = \\frac{x - \\mu}{\\sigma}", "\\sigma = \\sqrt{\\frac{1}{n} \\sum_{i=1}^{n} (x_i - \\mu)^2}"]),
      legend([["x", "el valor de la columna en una fila (por ejemplo, el peso en gramos)."], ["\\mu", "la media de la columna en el entrenamiento."],
        ["\\sigma", "su desviación típica: lo que suelen separarse los valores de la media."], ["z", "el valor estandarizado: cuántas desviaciones está por encima (o debajo) de la media."]]),
      p("Sin esto, un peso en gramos (miles) aplastaría a una longitud en milímetros (decenas) en cualquier algoritmo que sume o mida distancias. Los árboles no lo necesitan: preguntan «¿peso ≤ 4.000?» y da igual la escala."),
      codeRef("app/ml/prep.py: Preparer")),

    section("baseline", "Antes de aplaudir a un modelo hay que saber cuánto se saca sin aprender nada. La línea base dice siempre lo más común: la clase más frecuente (clasificación) o la media (regresión).",
      formula(["\\hat{y} = \\argmax_k n_k", "\\hat{y} = \\bar{y} = \\frac{1}{n} \\sum_{i=1}^{n} y_i"]),
      p("Si el 70 % de los correos no son spam, decir siempre «no es spam» acierta el 70 %. Un modelo que saque un 72 % apenas ha aprendido nada, aunque «72 %» suene bien. Por eso el modo automático siempre la incluye y la enseña como referencia."),
      codeRef("app/ml/algorithms.py: Baseline")),

    section("linear", "Predice un número sumando cada columna multiplicada por un peso. Aprender es encontrar los pesos con los que la suma se parece lo más posible a las respuestas.",
      formula("\\hat{y} = b + w_1 x_1 + w_2 x_2 + \\cdots + w_d x_d = b + \\sum_{j=1}^{d} w_j x_j"),
      legend([["x_j", "el valor (estandarizado) de la columna j."], ["w_j", "su peso: cuánto sube la predicción si esa columna sube una desviación típica."],
        ["b", "el término independiente: lo que predice para una fila «media»."], ["d", "cuántos números tiene cada fila (las columnas, ya preparadas)."]]),
      p("Los pesos que menos se equivocan se calculan de una vez, con ", h("b", null, "mínimos cuadrados"), ": los que hacen más pequeña la suma de los errores al cuadrado. Con regularización (ridge) se castiga también que los pesos sean grandes:"),
      formula(["\\min_{w} \\sum_{i=1}^{n} (y_i - \\hat{y}_i)^2 + \\lambda n \\lVert w \\rVert^2", "w = (X^T X + \\lambda n I)^{-1} X^T y"]),
      legend([["\\lambda", "la regularización: con 0 es la regresión de siempre; más alta, pesos más pequeños y prudentes."], ["X", "la tabla de números (una fila por ejemplo), con cada columna centrada en su media."]]),
      codeRef("app/ml/algorithms.py: LinearRegression")),

    section("logistic", "Para clasificar, cada clase tiene su propia suma con pesos (su puntuación) y las puntuaciones se convierten en probabilidades con la función softmax.",
      formula(["z_k = b_k + \\sum_{j=1}^{d} w_{jk} x_j", "p_k = \\frac{e^{z_k}}{\\sum_{c=1}^{K} e^{z_c}}"]),
      legend([["z_k", "la puntuación de la clase k."], ["w_{jk}", "el peso de la columna j para la clase k: positivo, empuja hacia ella."], ["p_k", "la probabilidad de la clase k: todas juntas suman 1."], ["K", "el número de clases."]]),
      softmaxDemo(),
      p("Aquí los pesos no salen de una fórmula: se aprenden poco a poco con el ", h("b", null, "descenso por gradiente"),
        ". Se mide lo que se equivoca con la pérdida (entropía cruzada) y, en cada vuelta, se mueve cada peso un poquito en la dirección en la que la pérdida baja:"),
      formula(["L = -\\frac{1}{n} \\sum_{i=1}^{n} \\ln p_{i, y_i}", "W \\gets W - \\eta \\left( \\frac{1}{n} X^T (P - Y) + \\lambda W \\right)"]),
      legend([["L", "la pérdida: si a la clase correcta le da probabilidad 1, suma 0; si le da casi 0, se dispara."], ["\\eta", "la tasa de aprendizaje: lo grande que es cada paso."],
        ["P - Y", "lo que se equivoca en cada fila: la probabilidad que dio menos la correcta (1 para su clase y 0 para las demás)."], ["\\lambda", "la regularización, que castiga los pesos grandes."]]),
      p("Con imágenes, «Píxeles + regresión logística» hace exactamente esto con cada píxel como columna: un peso por píxel y clase, que se puede dibujar como una imagen."),
      codeRef("app/ml/algorithms.py: LogisticRegression")),

    section("tree", "Un árbol hace preguntas de sí o no sobre las columnas («¿aleta ≤ 206 mm?») y, según las respuestas, la fila baja hasta una hoja con la respuesta. Aprender es elegir, en cada caja, la pregunta que mejor separa.",
      p("Para medir lo mezcladas que quedan las clases en un grupo se usa el ", h("b", null, "índice de Gini"), " (o la entropía):"),
      formula(["G = 1 - \\sum_{k=1}^{K} p_k^2", "H = -\\sum_{k=1}^{K} p_k \\log_2 p_k"]),
      legend([["p_k", "la parte del grupo que es de la clase k."], ["G", "0 si el grupo es de una sola clase; más alto cuanto más mezclado."]]),
      giniDemo(),
      p("Para cada columna se prueban todos los cortes posibles (entre cada dos valores seguidos) y se elige el que deja los dos lados menos mezclados, pesando cada lado por sus filas:"),
      formula("\\text{coste} = \\frac{n_{\\text{izq}}}{n} G_{\\text{izq}} + \\frac{n_{\\text{der}}}{n} G_{\\text{der}}"),
      p("Y se repite en cada lado hasta la profundidad máxima, hasta que el grupo es puro o hasta que quedan muy pocas filas. En regresión, en lugar de la mezcla se mide el error cuadrático de cada lado, y la hoja responde la media de sus filas."),
      note("Un árbol muy profundo acaba con una hoja para casi cada fila: se aprende el entrenamiento de memoria (sobreajuste) y falla con filas nuevas. Lo delata una nota de entrenamiento mucho más alta que la del examen."),
      codeRef("app/ml/algorithms.py: _Tree.build, DecisionTree")),

    section("forest", "Muchos árboles distintos que votan. Cada uno aprende con una muestra al azar de las filas (con repetición: «bootstrap») y, en cada pregunta, solo puede mirar unas pocas columnas al azar.",
      formula(["\\hat{p}_k = \\frac{1}{T} \\sum_{t=1}^{T} p_k^{(t)}", "\\hat{y} = \\frac{1}{T} \\sum_{t=1}^{T} \\hat{y}^{(t)}"]),
      legend([["T", "el número de árboles."], ["p_k^{(t)}", "la probabilidad de la clase k según el árbol t (la proporción de esa clase en su hoja)."]]),
      p("Cada árbol por separado se equivoca bastante, pero cada uno se equivoca en cosas distintas: al promediar, los errores se compensan. Por eso suele ser de los que mejor funcionan con tablas sin tocar nada."),
      codeRef("app/ml/algorithms.py: RandomForest")),

    section("knn", "No aprende pesos: guarda las filas de entrenamiento y, para predecir, busca las k más parecidas y las pone de acuerdo (la clase más votada o la media de sus números).",
      formula("d(\\mathbf{a}, \\mathbf{b}) = \\sqrt{\\sum_{j=1}^{d} (a_j - b_j)^2}"),
      legend([["d", "la distancia euclídea entre dos filas (con los números estandarizados)."], ["k", "cuántos vecinos consulta: pocos se fían de casos sueltos; muchos lo suavizan todo."]]),
      p("Con el peso «Más el más cercano», cada vecino vota con ", tex("w = 1/d"), ". Para que sea rápido, las distancias de muchas filas a la vez se calculan con ",
        tex("\\lVert a - b \\rVert^2 = \\lVert a \\rVert^2 + \\lVert b \\rVert^2 - 2\\, a \\cdot b"), ", que son productos de matrices."),
      codeRef("app/ml/algorithms.py: KNN, sq_distances")),

    section("bayes", "Usa el teorema de Bayes: lo probable que es cada clase después de ver la fila. «Naive» (ingenuo) porque supone que las columnas no tienen nada que ver entre sí dada la clase, y así puede multiplicar sus probabilidades.",
      formula("P(c \\mid \\mathbf{x}) \\propto P(c) \\prod_{j=1}^{d} P(x_j \\mid c)"),
      legend([["P(c)", "a priori: la parte de las filas de entrenamiento que son de la clase c."], ["P(x_j \\mid c)", "lo probable que es ese valor de la columna j en la clase c."]]),
      p("Para los números supone una campana de Gauss por clase (con su media y su desviación); para las categorías, cuenta (con el suavizado de Laplace, para que un valor nunca visto con una clase no la anule):"),
      formula(["P(x \\mid c) = \\frac{1}{\\sqrt{2 \\pi \\sigma_c^2}} e^{-\\frac{(x - \\mu_c)^2}{2 \\sigma_c^2}}", "P(v \\mid c) = \\frac{n_{v,c} + \\alpha}{n_c + \\alpha V}"]),
      p("Todo se hace con logaritmos (sumas en vez de productos), que no se quedan en cero con muchos números pequeños."),
      codeRef("app/ml/algorithms.py: NaiveBayes")),

    section("kmeans", "Agrupar sin respuestas: coloca k centros y repite dos pasos hasta que nada cambia. Cada fila se va con su centro más cercano y cada centro se mueve a la media de su grupo.",
      formula(["c_i = \\argmin_{k} \\lVert \\mathbf{x}_i - \\mu_k \\rVert^2", "\\mu_k = \\frac{1}{|C_k|} \\sum_{i \\in C_k} \\mathbf{x}_i"]),
      formula("J = \\sum_{i=1}^{n} \\lVert \\mathbf{x}_i - \\mu_{c_i} \\rVert^2"),
      legend([["c_i", "el grupo de la fila i."], ["\\mu_k", "el centro del grupo k."], ["J", "la inercia: lo lejos que están las filas de su centro (cada vuelta la baja o la deja igual)."]]),
      p("Los primeros centros se eligen con ", h("b", null, "k-means++"), ": uno al azar y los siguientes, con más probabilidad cuanto más lejos estén de los ya elegidos. Se repite varias veces y se queda con la de menor inercia."),
      p("¿Cuántos grupos? La inercia siempre baja con más grupos, así que se usa la ", h("b", null, "silueta"), ": para cada fila, si está más cerca de los de su grupo que de los del grupo vecino."),
      formula("s_i = \\frac{b_i - a_i}{\\max(a_i, b_i)}"),
      legend([["a_i", "la distancia media de la fila i a los de su grupo."], ["b_i", "la distancia media a los del grupo más cercano que no es el suyo."], ["s_i", "de −1 (está en el grupo equivocado) a 1 (grupos bien separados)."]]),
      codeRef("app/ml/algorithms.py: KMeans, kmeans_once, silhouette")),

    section("metricas", "Una nota para cada tarea. Todas se calculan con las filas del examen final (y en la validación cruzada, con el trozo que se deja fuera en cada ronda).",
      h("h3", null, "Clasificar"),
      formula(["\\text{exactitud} = \\frac{\\text{aciertos}}{n}", "\\text{precisión}_k = \\frac{VP_k}{VP_k + FP_k}", "\\text{exhaustividad}_k = \\frac{VP_k}{VP_k + FN_k}", "F_1 = \\frac{2 \\cdot P \\cdot E}{P + E}"]),
      legend([["VP_k", "verdaderos positivos: filas de la clase k que dijo que eran de k."], ["FP_k", "falsos positivos: dijo k y no lo eran."], ["FN_k", "falsos negativos: eran de k y dijo otra cosa."]]),
      p("La ", h("b", null, "exactitud equilibrada"), " es la media de la exhaustividad de cada clase: no se deja engañar cuando una clase es mucho más frecuente. Con dos clases, la ",
        h("b", null, "curva ROC"), " mueve el umbral de probabilidad y dibuja aciertos frente a falsas alarmas; su área (AUC) va de 0,5 (al azar) a 1."),
      h("h3", null, "Predecir un número"),
      formula(["R^2 = 1 - \\frac{\\sum_i (y_i - \\hat{y}_i)^2}{\\sum_i (y_i - \\bar{y})^2}", "RMSE = \\sqrt{\\frac{1}{n} \\sum_i (y_i - \\hat{y}_i)^2}", "MAE = \\frac{1}{n} \\sum_i |y_i - \\hat{y}_i|"]),
      p("R² compara con decir siempre la media: 1 es perfecto, 0 es como la media y puede ser negativo si lo hace peor. RMSE y MAE están en las unidades de lo que se predice (bicis, euros…)."),
      codeRef("app/ml/metrics.py")),

    section("importancia", "¿En qué columnas se fija el modelo? Se baraja una columna (sus valores se cambian de fila al azar, rompiendo su relación con la respuesta) y se mira cuánto empeora la nota.",
      formula("\\text{importancia}_j = \\text{nota} - \\text{nota}_{\\text{columna } j \\text{ barajada}}"),
      p("Se repite tres veces y se hace la media. Funciona con cualquier algoritmo, porque solo necesita sus predicciones. Una columna con importancia cerca de 0 no la usa (o lo que aporta ya lo dice otra columna parecida)."),
      codeRef("app/ml/metrics.py: permutation_importance")),

    section("plano", "Para dibujar los grupos hay que pasar de muchas columnas a dos. El análisis de componentes principales (PCA) busca las dos direcciones en las que más varían los datos y proyecta cada fila sobre ellas.",
      formula("X - \\bar{X} = U \\Sigma V^T \\quad \\Rightarrow \\quad \\text{punto}_i = (\\mathbf{x}_i - \\bar{\\mathbf{x}}) \\, V_{1:2}^T"),
      p("Las dos primeras filas de V (de la descomposición en valores singulares) son esas direcciones. La parte de la variación que recogen se dice junto al dibujo: si es baja, grupos que se ven juntos en el plano pueden estar separados en las columnas que no se ven."),
      codeRef("app/ml/metrics.py: pca2")),

    section("cnn", "Para imágenes, mirar los píxeles de uno en uno no sirve de mucho: la misma forma un poco más a la izquierda cambia todos los píxeles. Una red convolucional aprende pequeños filtros que buscan un dibujo (un borde, una esquina, un color) por toda la imagen.",
      p("La red de Lince: la imagen (normalizada: media 0 y desviación 1) pasa por tres bloques de ", h("b", null, "convolución 3 × 3 + ReLU + max-pooling"),
        " (8, 16 y 32 filtros), un ", h("b", null, "global max pooling"), " y una capa densa con softmax."),
      formula(["(\\mathbf{x} * W)_{ij} = b + \\sum_{u=1}^{3} \\sum_{v=1}^{3} \\sum_{c} x_{i+u,\\, j+v,\\, c} \\, W_{u,v,c}", "\\op{ReLU}(z) = \\max(0, z)"]),
      legend([["W", "un filtro de 3 × 3 (por cada canal de entrada): 9 pesos por canal que la red aprende."], ["\\op{ReLU}", "deja pasar lo positivo y anula lo negativo: «se ha encontrado el dibujo» o «no»."]]),
      p("El ", h("b", null, "max-pooling 2 × 2"), " se queda con el valor más alto de cada cuadradito y reduce la imagen a la mitad; el ", h("b", null, "global max pooling"),
        " se queda con el valor más alto de cada filtro en toda la imagen: «¿aparece este dibujo en alguna parte?». Así da igual dónde esté la forma."),
      p("Se entrena con ", h("b", null, "retropropagación"), " (backpropagation): la regla de la cadena calcula cuánto cambia la pérdida con cada peso, de la última capa a la primera. Y se corrige con ", h("b", null, "Adam"), ", que adapta el paso de cada peso:"),
      formula(["m \\gets \\beta_1 m + (1 - \\beta_1) g", "v \\gets \\beta_2 v + (1 - \\beta_2) g^2", "\\theta \\gets \\theta - \\eta \\frac{\\hat{m}}{\\sqrt{\\hat{v}} + \\epsilon}"]),
      legend([["g", "el gradiente de la pérdida respecto a un peso θ."], ["m, v", "medias móviles del gradiente y de su cuadrado (β₁ = 0,9, β₂ = 0,999); m̂ y v̂, corregidas al principio."], ["\\eta", "la tasa de aprendizaje."]]),
      p("Cada vuelta ve las imágenes ", h("b", null, "aumentadas"), " (un poco movidas, volteadas o con otro brillo): así aprende la forma y no la foto concreta. Y para ver «dónde ha mirado» se calcula la ",
        h("b", null, "saliencia"), ": cuánto cambiaría la puntuación de la clase elegida si cambiara cada píxel."),
      formula("\\text{saliencia}_{ij} = \\max_c \\left| \\frac{\\partial z_k}{\\partial x_{ijc}} \\right|"),
      note("Las líneas base «Píxeles + k vecinos» y «Píxeles + regresión logística» reducen la imagen a 16 × 16 y usan cada píxel como columna. Comparar su nota con la de la red enseña lo que aportan las convoluciones."),
      codeRef("app/ml/cnn.py: ConvNet")),

    section("automatico", "El modo automático (como el ML automatizado de Azure) entrena varios candidatos con la misma separación y la misma validación cruzada y se queda con el de mejor nota media.",
      ul([h("b", null, "Clasificar"), ": línea base, regresión logística, árboles de profundidad 3, 5 y 8, bosque de 50 árboles, k vecinos (k = 5 y 11) y Naive Bayes."],
        [h("b", null, "Predecir un número"), ": línea base, regresión lineal, árboles de profundidad 3, 5 y 8, bosque de 50 árboles y k vecinos (k = 5 y 11)."],
        [h("b", null, "Agrupar"), ": k-medias de 2 a 8 grupos, eligiendo por la silueta."],
        [h("b", null, "Imágenes"), ": píxeles + k vecinos, píxeles + regresión logística y la red convolucional en color y en gris (solo la forma); se elige por el examen."]),
      p("Todos se guardan como modelos, no solo el ganador: así se pueden comparar y ver qué ha aprendido cada uno. En modo personalizado se entrena solo el algoritmo elegido, con los ajustes que pongas."),
      codeRef("app/ml/runner.py: AUTO", "app/ml/cnn.py: AUTO_IMAGES")),
  );
  fitFormulas(content);
  const sec = query && query.get("sec");
  if (sec) {
    const target = document.getElementById("ml-" + (ALIAS[sec] || sec));
    if (target) requestAnimationFrame(() => toc.go(target));
  }
  return { destroy: toc.destroy };
}

// API de un proyecto: qué modelo está publicado, su dirección, la clave y cómo llamarlo desde tu web o tu
// aplicación (lo que en Azure ML es un «punto de conexión en línea»).
import { ml } from "../api.js";
import { h, icon, clear, toast, errorToast, confirmDialog, selectMenu, pageHead, emptyState, codeBlock, codeTabs, copyButton, busy,
  timeAgo, fullDate } from "../ui.js";
import { navigate, projectPath, reloadProject, state } from "../app.js";
import { fmtMetric, metricName, defaultModel, IMG } from "../ml-common.js";

export async function render(el) {
  const p = state.project;
  const page = h("div", { class: "page cq" });
  el.append(page);
  page.append(pageHead({ icon: "plug", title: "API",
    sub: "Publica un modelo y úsalo desde tu web, tu aplicación o una hoja de cálculo: le mandas los datos y te devuelve la predicción." }));
  const models = p.models || [];
  if (!models.length) {
    page.append(h("div", { class: "card" }, emptyState({ icon: "flask", title: "Primero, un modelo", text: "Entrena uno; después podrás publicarlo aquí.",
      action: h("a", { class: "btn primary", href: projectPath("train") }, icon("flask"), "Entrenar") })));
    return null;
  }
  const origin = location.origin;
  const pub = p.publicId || p.id;
  const base = `${origin}/api/ml/${pub}`;
  const publishedId = p.published && p.published.modelId;
  const shown = (publishedId && models.find((x) => x.id === publishedId)) || defaultModel(p);

  // 1. el modelo publicado
  const picker = selectMenu({ label: "Modelo que se publica", value: shown.id,
    options: models.map((x) => ({ value: x.id, label: x.name, sub: `${metricName(x.metric)} ${fmtMetric(x.metric, x.value)}` + (x.best ? " · el mejor" : "") })) });
  const publishBtn = h("button", { class: "btn primary", type: "button" }, icon("globe"), publishedId ? "Publicar este" : "Publicar");
  const unpublishBtn = publishedId ? h("button", { class: "btn", type: "button" }, "Despublicar") : null;
  const syncBtn = () => { publishBtn.disabled = publishedId === picker.value; };
  picker.addEventListener("change", syncBtn);
  syncBtn();
  const publish = (id, btn) => busy(btn, async () => {
    try {
      await ml.publish(p.id, id);
      await reloadProject();
      toast(id ? "Publicado: ya responde en su dirección" : "Ya no hay ningún modelo publicado", "success");
      navigate(projectPath("api"));
    } catch (e) { errorToast(e); }
  });
  publishBtn.addEventListener("click", () => publish(picker.value, publishBtn));
  if (unpublishBtn) unpublishBtn.addEventListener("click", () => publish(null, unpublishBtn));
  page.append(h("div", { class: "card" }, h("div", { class: "card-head" }, icon("globe"), h("h2", null, "Modelo publicado"),
    publishedId ? h("span", { class: "badge live" }, "En línea") : h("span", { class: "badge" }, "Sin publicar")),
  h("div", { class: "card-body col", style: { gap: "12px" } },
    h("p", { class: "muted small", style: { margin: 0 } }, publishedId
      ? ["Responde ", h("b", null, p.published.name), h("span", { title: fullDate(p.published.at) }, ` (publicado ${timeAgo(p.published.at)})`),
        ". Si publicas otro, la dirección sigue siendo la misma: quien la use pasará a usar el nuevo sin cambiar nada."]
      : "Todavía no responde ningún modelo en la dirección de abajo: elige uno y publícalo."),
    h("div", { class: "publish-row" }, picker, publishBtn, unpublishBtn))));

  // 2. la dirección
  page.append(h("div", { class: "card" }, h("div", { class: "card-head" }, icon("code"), h("h2", null, "La dirección")),
    h("div", { class: "card-body col", style: { gap: "10px" } },
      endpoint("POST", `${base}/predict`, "Manda los datos y devuelve la predicción."),
      p.kind === "images" ? null : endpoint("POST", `${base}/batch`,
        "Por lotes: manda un CSV entero y devuelve el mismo CSV con la predicción de cada fila (como en «Probar → Muchas filas a la vez»)."),
      endpoint("GET", `${base}/schema`, "Qué columnas espera el modelo (con su tipo y sus valores posibles)."),
      h("p", { class: "muted small", style: { margin: 0 } }, "Se puede llamar desde cualquier web (permite CORS). Todas las rutas, con ejemplos, en la ",
        h("a", { href: "/docs#grupo-ml-prediccion", target: "_blank", rel: "noopener" }, "referencia de la API"), "."))));

  // 3. la clave
  const keyBox = h("div", { class: "col", style: { gap: "10px" } });
  const paintKey = () => {
    clear(keyBox);
    if (p.apiKey) {
      const input = h("input", { type: "text", readonly: true, value: p.apiKey, class: "share-link", "aria-label": "Clave de API" });
      keyBox.append(h("p", { class: "muted small", style: { margin: 0 } }, "Solo responde a quien mande esta clave en la cabecera ", h("code", null, "X-Api-Key"),
        ". No la pongas en una web pública: cualquiera podría verla en el código."),
      h("div", { class: "row share-row" }, input, copyButton(() => p.apiKey, { label: "Copiar", cls: "btn" })),
      h("div", { class: "row wrap" },
        h("button", { class: "btn", type: "button", onclick: (e) => changeKey("new", e.currentTarget, "La clave anterior dejará de funcionar.") }, icon("refresh"), "Cambiar la clave"),
        h("button", { class: "btn danger", type: "button", onclick: (e) => changeKey("", e.currentTarget, "Cualquiera que sepa la dirección podrá usar el modelo.") }, "Quitar la clave")));
    } else {
      keyBox.append(h("p", { class: "muted small", style: { margin: 0 } }, "Sin clave, cualquiera que sepa la dirección puede usar el modelo publicado. Con clave, solo quien la mande."),
        h("div", null, h("button", { class: "btn", type: "button", onclick: (e) => changeKey("new", e.currentTarget) }, icon("key"), "Crear una clave")));
    }
  };
  async function changeKey(value, btn, warning) {
    if (warning && !(await confirmDialog(warning, { title: value ? "Cambiar la clave" : "Quitar la clave", okLabel: value ? "Cambiar" : "Quitar", danger: !value }))) return;
    await busy(btn, async () => {
      try {
        const updated = await ml.update(p.id, { apiKey: value });
        state.project = updated;
        p.apiKey = updated.apiKey;
        paintKey();
        paintExamples();
        toast(value ? "Clave nueva creada" : "Clave quitada", "success");
      } catch (e) { errorToast(e); }
    });
  }
  page.append(h("div", { class: "card" }, h("div", { class: "card-head" }, icon("key"), h("h2", null, "Clave de API")), h("div", { class: "card-body" }, keyBox)));
  paintKey();

  // 4. ejemplos
  const examples = h("div", { class: "col", style: { gap: "12px" } }, h("div", { class: "muted small" }, "Preparando los ejemplos…"));
  page.append(h("div", { class: "card" }, h("div", { class: "card-head" }, icon("terminal"), h("h2", null, "Cómo llamarlo"),
    h("span", { class: "help" }, publishedId ? "" : "(funcionará cuando publiques un modelo)")), h("div", { class: "card-body" }, examples)));
  let model = null, sample = null;
  async function paintExamples() {
    try {
      if (!model) model = await ml.model(p.id, shown.id);
      const sch = model.schema;
      const headers = p.apiKey ? { "Content-Type": "application/json", "X-Api-Key": p.apiKey } : { "Content-Type": "application/json" };
      clear(examples);
      if (sch.kind === "images") {
        examples.append(h("p", { style: { margin: 0 } }, `Cada imagen va como sus píxeles en color (rojo, verde y azul de cada uno) a ${IMG} × ${IMG}: `,
          `${IMG * IMG * 3} bytes en base64. Los ejemplos reducen la foto a ese tamaño antes de mandarla.`),
        codeTabs(imageExamples(`${base}/predict`, p.apiKey)),
        h("div", { class: "chart-title" }, "Lo que devuelve"),
        codeBlock(JSON.stringify({ modelId: model.id, model: model.report.name, predictions: [{ prediction: sch.classes[0], confidence: 0.94,
          probabilities: Object.fromEntries(sch.classes.map((c, i) => [c, i ? +(0.06 / (sch.classes.length - 1)).toFixed(3) : 0.94])) }] }, null, 2), { json: true, lang: "JSON" }));
        return;
      }
      const row = Object.fromEntries(sch.columns.map((c) => [c.name, c.kind === "number" ? +(+c.example).toFixed(4)
        : c.kind === "category" ? (c.values[0] ?? "") : c.kind === "date" ? (c.example || "2024-05-01") : ""]));
      const body = { rows: [row] };
      const json = JSON.stringify(body, null, 2);
      examples.append(h("p", { style: { margin: 0 } }, "Manda una o varias filas (hasta 1000) con el valor de cada columna. ",
        sch.task === "clustering" ? "Devuelve el grupo de cada una." : `Devuelve «${sch.target}» para cada una.`,
        " Añade ", h("code", null, '"explain": true'), " para recibir también el porqué."),
      codeTabs([
        { label: "curl", code: `curl -X POST "${base}/predict" \\\n  -H "Content-Type: application/json" \\\n${p.apiKey ? `  -H "X-Api-Key: ${p.apiKey}" \\\n` : ""}  -d '${JSON.stringify(body)}'` },
        { label: "JavaScript", code: `const respuesta = await fetch("${base}/predict", {\n  method: "POST",\n  headers: ${JSON.stringify(headers)},\n  body: JSON.stringify(${json.replace(/\n/g, "\n  ")}),\n});\nconst datos = await respuesta.json();\nconsole.log(datos.predictions[0].prediction);` },
        { label: "Python", code: `import requests\n\nrespuesta = requests.post(\n    "${base}/predict",\n    json=${json.replace(/\n/g, "\n    ")},\n${p.apiKey ? `    headers={"X-Api-Key": "${p.apiKey}"},\n` : ""})\nprint(respuesta.json()["predictions"][0]["prediction"])` },
      ]));
      if (!sample) {
        const res = await ml.predict(p.id, model.id, body);
        sample = res;
      }
      examples.append(h("div", { class: "chart-title" }, "Lo que devuelve (con la fila del ejemplo)"),
        codeBlock(JSON.stringify(sample, null, 2), { json: true, lang: "JSON" }));
    } catch (e) {
      clear(examples).append(h("div", { class: "notice danger" }, icon("alert"), e.message));
    }
  }
  paintExamples();

  // 5. si vienes de Azure
  page.append(h("div", { class: "card" }, h("div", { class: "card-head" }, icon("book"), h("h2", null, "Si vienes de Azure Machine Learning")),
    h("div", { class: "card-body" }, h("div", { class: "table-wrap" }, h("table", { class: "table azure-map" },
      h("thead", null, h("tr", null, h("th", null, "En Azure"), h("th", null, "Aquí"))),
      h("tbody", null, [
        ["Área de trabajo", "El proyecto"],
        ["Recurso de datos (tabla MLTable o carpeta)", "Datos: el CSV o las imágenes por clases"],
        ["Trabajo de ML automatizado", "Entrenar en modo «Automático»"],
        ["Script de entrenamiento personalizado", "Entrenar «Eligiendo tú» (y su script, en la pestaña «Código» del modelo)"],
        ["Proceso (clúster de cálculo)", "El propio servidor de Lince: no hay que crear nada ni pagar por minutos"],
        ["Modelo registrado", "Cada modelo de la página Modelos"],
        ["Punto de conexión en línea (endpoint)", "Publicar un modelo: la dirección de arriba"],
        ["Punto de conexión por lotes", "Probar → «Muchas filas a la vez» (un CSV entero), o la dirección …/batch"],
        ["Clave del punto de conexión", "La clave de API (cabecera X-Api-Key)"],
      ].map(([a, b]) => h("tr", null, h("td", null, a), h("td", null, b)))))))));
  return null;
}

function endpoint(method, url, text) {
  return h("div", { class: "col", style: { gap: "4px" } },
    h("div", { class: "endpoint" }, h("span", { class: "http-method" + (method === "GET" ? " get" : "") }, method), h("span", { class: "url" }, url),
      copyButton(url, { label: "", cls: "btn ghost sm icon-only copy" })),
    h("div", { class: "muted small" }, text));
}

function imageExamples(url, key) {
  const js = `// reduce una imagen (un <img>, <canvas> o <video>) a ${IMG} × ${IMG} y manda sus píxeles RGB
function pixeles(imagen) {
  const lienzo = document.createElement("canvas");
  lienzo.width = lienzo.height = ${IMG};
  const ctx = lienzo.getContext("2d");
  const lado = Math.min(imagen.width, imagen.height);
  ctx.drawImage(imagen, (imagen.width - lado) / 2, (imagen.height - lado) / 2, lado, lado, 0, 0, ${IMG}, ${IMG});
  const rgba = ctx.getImageData(0, 0, ${IMG}, ${IMG}).data;
  let binario = "";
  for (let i = 0; i < rgba.length; i += 4) binario += String.fromCharCode(rgba[i], rgba[i + 1], rgba[i + 2]);
  return btoa(binario);
}

const respuesta = await fetch("${url}", {
  method: "POST",
  headers: { "Content-Type": "application/json"${key ? `, "X-Api-Key": "${key}"` : ""} },
  body: JSON.stringify({ images: [pixeles(document.querySelector("img"))] }),
});
console.log((await respuesta.json()).predictions[0]);`;
  const py = `# pip install requests pillow numpy
import base64
import numpy as np
import requests
from PIL import Image, ImageOps

foto = ImageOps.fit(Image.open("foto.jpg").convert("RGB"), (${IMG}, ${IMG}))  # recorta el centro y reduce
pixeles = base64.b64encode(np.asarray(foto, dtype=np.uint8).tobytes()).decode()

respuesta = requests.post("${url}", json={"images": [pixeles]}${key ? `, headers={"X-Api-Key": "${key}"}` : ""})
print(respuesta.json()["predictions"][0])`;
  return [{ label: "JavaScript", code: js }, { label: "Python", code: py }];
}

// Integraciones: widget web, API REST, compatibilidad Dialogflow y webhook.
import { h, icon, clear, codeBlock, codeTabs, switchInput, pageHead, segmented, isDark } from "../ui.js";
import { agentPath, state } from "../app.js";

const THEMES = [
  { key: "auto", icon: "contrast", label: "Automático" },
  { key: "light", icon: "sun", label: "Claro" },
  { key: "dark", icon: "moon", label: "Oscuro" },
];
const THEME_HELP = {
  auto: "Claro u oscuro según el sistema de cada visitante. Aquí se ve como la consola.",
  light: "Siempre claro, aunque el visitante use el modo oscuro.",
  dark: "Siempre oscuro, para webs con fondo oscuro.",
};

// Maqueta del widget que cambia al momento con el color, el título, la posición y el tema
function widgetPreview() {
  const title = h("b", null);
  const bubble = h("span", { class: "wp-bubble" }, icon("message"));
  const panel = h("div", { class: "wp-panel" },
    h("div", { class: "wp-head" }, title, icon("x")),
    h("div", { class: "wp-body" },
      h("div", { class: "wp-msg" }, "¡Hola! ¿En qué puedo ayudarte?"),
      h("div", { class: "wp-quick" }, h("span", null, "Ver la carta"), h("span", null, "Hacer un pedido")),
      h("div", { class: "wp-msg user" }, "Quiero una pizza")),
    h("div", { class: "wp-input" }, h("span", null, "Escribe un mensaje…"), h("span", { class: "wp-send" }, icon("send"))));
  const box = h("div", { class: "widget-preview", "aria-label": "Vista previa del widget" },
    h("div", { class: "wp-page" }, h("i", { style: { width: "46%" } }), h("i", { style: { width: "72%" } }), h("i", { style: { width: "60%" } }),
      h("i", { style: { width: "38%" } })),
    panel, bubble);
  box.update = (opts) => {
    box.style.setProperty("--c", /^#[0-9a-f]{3,8}$/i.test(opts.color) ? opts.color : "#4f46e5");
    box.classList.toggle("left", opts.position === "left");
    // «automático» se enseña como esté ahora la consola (claro u oscuro)
    box.classList.toggle("dark", opts.theme === "dark" || (opts.theme === "auto" && isDark()));
    title.textContent = opts.title || "Asistente";
    panel.querySelector(".wp-body").firstChild.classList.toggle("hidden", !opts.welcome);
  };
  return box;
}

export async function render(el) {
  const agent = state.agent;
  const origin = location.origin;
  // dirección pública: en un servidor con cuentas, «<espacio>.<agente>»; en uno normal, el id
  const pub = agent.publicId || agent.id;
  const key = agent.settings.apiKey;
  const opts = { title: agent.name, color: "#4f46e5", welcome: true, position: "right", theme: "auto" };
  const widgetBox = h("div");
  const preview = widgetPreview();
  const themeHelp = h("div", { class: "hint" });
  const demo = h("a", { class: "btn", target: "_blank", rel: "noopener" }, icon("external"), "Abrir chat de demostración");
  const drawWidget = () => {
    const attrs = [`src="${origin}/widget.js"`, `data-agent="${pub}"`, `data-title="${opts.title.replace(/"/g, "&quot;")}"`,
      `data-color="${opts.color}"`];
    if (opts.theme !== "light") attrs.push(`data-theme="${opts.theme}"`);
    if (!opts.welcome) attrs.push('data-welcome="false"');
    if (opts.position === "left") attrs.push('data-position="left"');
    if (key) attrs.push(`data-key="${key}"`);
    clear(widgetBox).append(codeBlock(`<script ${attrs.join("\n        ")}></script>`, { lang: "HTML" }));
    preview.update(opts);
    themeHelp.textContent = THEME_HELP[opts.theme];
    // la demostración abre el chat con lo elegido aquí (y la clave, si el agente la pide)
    demo.href = "/chat?" + new URLSearchParams({ agent: pub, title: opts.title, color: opts.color, theme: opts.theme,
      ...(key ? { key } : {}) });
  };
  const title = h("input", { type: "text", value: opts.title, "aria-label": "Título", oninput: () => { opts.title = title.value; drawWidget(); } });
  const color = h("input", { type: "color", value: opts.color, "aria-label": "Color", oninput: () => { opts.color = color.value; drawWidget(); } });
  const pos = h("select", { "aria-label": "Posición", onchange: () => { opts.position = pos.value; drawWidget(); } },
    h("option", { value: "right" }, "Abajo a la derecha"), h("option", { value: "left" }, "Abajo a la izquierda"));
  const theme = segmented({ items: THEMES.map((t) => ({ key: t.key, label: [icon(t.icon), t.label] })), active: opts.theme,
    label: "Tema del chat", onChange: (k) => { opts.theme = k; drawWidget(); } });
  theme.style.marginBottom = "0";
  drawWidget();
  // si cambia el tema de la consola, la vista previa en «automático» lo sigue
  const follow = () => preview.update(opts);
  const themeObs = new MutationObserver(follow);
  themeObs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  media.addEventListener("change", follow);

  const detectBody = { sessionId: "usuario-123", text: "quiero una pizza barbacoa familiar" };
  const curl = `curl -X POST ${origin}/api/agents/${pub}/detect \\
  -H "Content-Type: application/json" \\${key ? `\n  -H "X-Api-Key: ${key}" \\` : ""}
  -d '${JSON.stringify(detectBody)}'`;
  const js = `const res = await fetch("${origin}/api/agents/${pub}/detect", {
  method: "POST",
  headers: { "Content-Type": "application/json"${key ? `, "X-Api-Key": "${key}"` : ""} },
  body: JSON.stringify({ sessionId: "usuario-123", text: "hola" }),
});
const data = await res.json();
console.log(data.fulfillmentText, data.intent, data.parameters);`;
  const py = `import requests

r = requests.post("${origin}/api/agents/${pub}/detect",
                  json={"sessionId": "usuario-123", "text": "hola"}${key ? `,\n                  headers={"X-Api-Key": "${key}"}` : ""})
data = r.json()
print(data["fulfillmentText"], data["intent"], data["parameters"])`;
  const response = `{
  "sessionId": "usuario-123",
  "queryText": "quiero una pizza barbacoa familiar",
  "intent": { "id": "…", "name": "pedido.pizza", "isFallback": false },
  "confidence": 0.97,
  "action": "pedido.crear",
  "parameters": { "cantidad": 1, "pizza": "barbacoa", "tamano": "familiar" },
  "allRequiredParamsPresent": true,
  "fulfillmentText": "¡Marchando! 🍕 1 × barbacoa (familiar)…",
  "messages": [ { "type": "text", "text": "…" }, { "type": "quickReplies", "items": ["A domicilio", "Para recoger"] } ],
  "outputContexts": [ { "name": "pedido", "lifespan": 5, "parameters": { … } } ],
  "endConversation": false
}`;
  const df = `POST ${origin}/v2/projects/${pub}/agent/sessions/usuario-123:detectIntent
{
  "queryInput": { "text": { "text": "hola", "languageCode": "${agent.language}" } }
}`;
  const flask = `# pip install flask
from flask import Flask, request, jsonify

app = Flask(__name__)

@app.post("/webhook")
def webhook():
    q = request.get_json()["queryResult"]
    accion = q["action"]            # p. ej. "pedido.estado"
    params = q["parameters"]
    if accion == "pedido.estado":
        return jsonify({"fulfillmentText": "Tu pedido llega en 10 minutos."})
    return jsonify({})               # {} = usar la respuesta configurada

app.run(port=5000)`;
  const express = `// npm install express
const express = require("express");
const app = express();
app.use(express.json());

app.post("/webhook", (req, res) => {
  const { action, parameters } = req.body.queryResult;
  if (action === "pedido.estado") {
    return res.json({ fulfillmentText: "Tu pedido llega en 10 minutos." });
  }
  res.json({});
});

app.listen(5000);`;

  el.append(h("div", { class: "page" },
    pageHead({ icon: "plug", title: "Integraciones", sub: "Cómo conectar este agente con tu web, tu app o tu propio código." }),

    h("div", { class: "card" },
      h("div", { class: "card-head" }, icon("message"), h("h2", null, "Chat para tu página web")),
      h("div", { class: "card-body col", style: { gap: "14px" } },
        h("p", { class: "muted", style: { margin: 0 } }, "Pega esta línea antes de ", h("code", null, "</body>"), " en cualquier página. Aparecerá una burbuja de chat."),
        h("div", { class: "widget-config" },
          h("div", { class: "col", style: { gap: "12px" } },
            h("label", { class: "field" }, "Título", title),
            h("div", { class: "row", style: { gap: "12px", alignItems: "flex-end" } },
              h("label", { class: "field" }, "Color", color),
              h("label", { class: "field grow" }, "Posición", pos)),
            h("div", { class: "field" }, h("span", null, "Tema"), theme, themeHelp),
            switchInput("Saludar al abrir (evento WELCOME)", opts.welcome, (v) => { opts.welcome = v; drawWidget(); })),
          preview),
        widgetBox,
        h("div", { class: "row wrap" },
          demo,
          h("span", { class: "muted small" }, "Página completa con el chat, para probarlo o compartirlo.")),
        location.hostname === "localhost" || location.hostname === "127.0.0.1"
          ? h("div", { class: "notice warning" }, icon("info"), h("div", null, "Ahora el servidor solo es accesible desde este ordenador. Para usarlo en una web pública, despliégalo en un servidor (ver README) o arráncalo con ",
            h("code", null, "python -m app --host 0.0.0.0"), " para tu red local."))
          : null)),

    h("div", { class: "card" },
      h("div", { class: "card-head" }, icon("code"), h("h2", null, "API REST"),
        h("span", { class: "spacer" }), h("a", { class: "btn sm", href: "/docs", target: "_blank", rel: "noopener" }, icon("book"), "Referencia de la API")),
      h("div", { class: "card-body col", style: { gap: "12px" } },
        h("p", { class: "muted", style: { margin: 0 } }, "Envía cada mensaje del usuario con un ", h("code", null, "sessionId"),
          " propio de cada conversación (así se recuerdan los contextos y las preguntas pendientes)."),
        codeTabs([{ label: "curl", code: curl }, { label: "JavaScript", code: js }, { label: "Python", code: py }]),
        h("div", { class: "section-title", style: { margin: "6px 0 0" } }, "Respuesta"),
        codeBlock(response, { lang: "JSON", json: true }),
        h("p", { class: "muted small", style: { margin: 0 } }, "Para lanzar un evento en vez de texto: ", h("code", null, '{"sessionId": "…", "event": "WELCOME"}'),
          ". Para empezar de cero: ", h("code", null, `POST /api/agents/${pub}/sessions/{sessionId}/reset`), "."))),

    h("div", { class: "card" },
      h("div", { class: "card-head" }, icon("layers"), h("h2", null, "Compatible con Dialogflow")),
      h("div", { class: "card-body col", style: { gap: "12px" } },
        h("p", { class: "muted", style: { margin: 0 } }, "Si tu aplicación ya usaba la API v2 de Dialogflow ES, puedes apuntarla aquí: mismo formato de petición y de respuesta (",
          h("code", null, "queryResult"), ", ", h("code", null, "fulfillmentMessages"), ", ", h("code", null, "outputContexts"), "…)."),
        codeBlock(df, { lang: "HTTP" }))),

    h("div", { class: "card" },
      h("div", { class: "card-head" }, icon("zap"), h("h2", null, "Webhook (fulfillment)")),
      h("div", { class: "card-body col", style: { gap: "12px" } },
        h("p", { class: "muted", style: { margin: 0 } }, "Para respuestas dinámicas (consultar un pedido, una base de datos…). Configura la URL en ",
          h("a", { href: agentPath("settings") }, "Ajustes"), " y activa «Llamar al webhook» en cada intención. Recibe el mismo JSON que enviaría Dialogflow ES y puede devolver ",
          h("code", null, "fulfillmentText"), ", ", h("code", null, "fulfillmentMessages"), ", ", h("code", null, "outputContexts"), " o ", h("code", null, "followupEventInput"), "."),
        codeTabs([{ label: "Python (Flask)", code: flask }, { label: "Node.js (Express)", code: express }])))));
  return { destroy: () => { themeObs.disconnect(); media.removeEventListener("change", follow); } };
}

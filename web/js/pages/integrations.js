// Integraciones: widget web, API REST, compatibilidad Dialogflow y webhook.
import { h, icon, clear, codeBlock, switchInput } from "../ui.js";
import { agentPath, state } from "../app.js";

export async function render(el) {
  const agent = state.agent;
  const origin = location.origin;
  const key = agent.settings.apiKey;
  const opts = { title: agent.name, color: "#4361ee", welcome: true, position: "right" };
  const widgetBox = h("div");
  const drawWidget = () => {
    const attrs = [`src="${origin}/widget.js"`, `data-agent="${agent.id}"`, `data-title="${opts.title.replace(/"/g, "&quot;")}"`,
      `data-color="${opts.color}"`];
    if (!opts.welcome) attrs.push('data-welcome="false"');
    if (opts.position === "left") attrs.push('data-position="left"');
    if (key) attrs.push(`data-key="${key}"`);
    clear(widgetBox).append(codeBlock(`<script ${attrs.join("\n        ")}></script>`));
  };
  const title = h("input", { type: "text", value: opts.title, "aria-label": "Título", oninput: () => { opts.title = title.value; drawWidget(); } });
  const color = h("input", { type: "color", value: opts.color, "aria-label": "Color", style: { width: "48px", height: "34px", padding: "2px" },
    oninput: () => { opts.color = color.value; drawWidget(); } });
  const pos = h("select", { "aria-label": "Posición", onchange: () => { opts.position = pos.value; drawWidget(); } },
    h("option", { value: "right" }, "Abajo a la derecha"), h("option", { value: "left" }, "Abajo a la izquierda"));
  drawWidget();

  const detectBody = { sessionId: "usuario-123", text: "quiero una pizza barbacoa familiar" };
  const curl = `curl -X POST ${origin}/api/agents/${agent.id}/detect \\
  -H "Content-Type: application/json" \\${key ? `\n  -H "X-Api-Key: ${key}" \\` : ""}
  -d '${JSON.stringify(detectBody)}'`;
  const js = `const res = await fetch("${origin}/api/agents/${agent.id}/detect", {
  method: "POST",
  headers: { "Content-Type": "application/json"${key ? `, "X-Api-Key": "${key}"` : ""} },
  body: JSON.stringify({ sessionId: "usuario-123", text: "hola" }),
});
const data = await res.json();
console.log(data.fulfillmentText, data.intent, data.parameters);`;
  const py = `import requests

r = requests.post("${origin}/api/agents/${agent.id}/detect",
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
  const df = `POST ${origin}/v2/projects/${agent.id}/agent/sessions/usuario-123:detectIntent
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
    h("div", { class: "page-head" }, h("div", { class: "grow" }, h("h1", null, "Integraciones"),
      h("div", { class: "sub" }, "Cómo conectar este agente con tu web, tu app o tu propio código."))),

    h("div", { class: "card" },
      h("div", { class: "card-head" }, icon("chat"), h("h2", null, "Chat para tu página web")),
      h("div", { class: "card-body col" },
        h("p", { class: "muted", style: { margin: 0 } }, "Pega esta línea antes de ", h("code", null, "</body>"), " en cualquier página. Aparecerá una burbuja de chat."),
        h("div", { class: "row wrap" },
          h("label", { class: "field grow" }, "Título", title),
          h("label", { class: "field" }, "Color", color),
          h("label", { class: "field" }, "Posición", pos)),
        switchInput("Saludar al abrir (evento WELCOME)", opts.welcome, (v) => { opts.welcome = v; drawWidget(); }),
        widgetBox,
        h("div", { class: "row" },
          h("a", { class: "btn", href: `/chat?agent=${encodeURIComponent(agent.id)}`, target: "_blank", rel: "noopener" }, icon("external"), "Abrir chat de demostración"),
          h("span", { class: "muted small" }, "Página completa con el chat, para probarlo o compartirlo.")),
        location.hostname === "localhost" || location.hostname === "127.0.0.1"
          ? h("div", { class: "notice warning" }, icon("info"), h("div", null, "Ahora el servidor solo es accesible desde este ordenador. Para usarlo en una web pública, despliégalo en un servidor (ver README) o arráncalo con ",
            h("code", null, "python -m app --host 0.0.0.0"), " para tu red local."))
          : null)),

    h("div", { class: "card" },
      h("div", { class: "card-head" }, icon("plug"), h("h2", null, "API REST"),
        h("span", { class: "spacer" }), h("a", { class: "btn sm", href: "/docs", target: "_blank", rel: "noopener" }, icon("external"), "Documentación interactiva")),
      h("div", { class: "card-body col" },
        h("p", { class: "muted", style: { margin: 0 } }, "Envía cada mensaje del usuario con un ", h("code", null, "sessionId"),
          " propio de cada conversación (así se recuerdan los contextos y las preguntas pendientes)."),
        h("b", null, "curl"), codeBlock(curl),
        h("b", null, "JavaScript"), codeBlock(js),
        h("b", null, "Python"), codeBlock(py),
        h("b", null, "Respuesta"), codeBlock(response),
        h("p", { class: "muted small", style: { margin: 0 } }, "Para lanzar un evento en vez de texto: ", h("code", null, '{"sessionId": "…", "event": "WELCOME"}'),
          ". Para empezar de cero: ", h("code", null, `POST /api/agents/${agent.id}/sessions/{sessionId}/reset`), "."))),

    h("div", { class: "card" },
      h("div", { class: "card-head" }, icon("layers"), h("h2", null, "Compatible con Dialogflow")),
      h("div", { class: "card-body col" },
        h("p", { class: "muted", style: { margin: 0 } }, "Si tu aplicación ya usaba la API v2 de Dialogflow ES, puedes apuntarla aquí: mismo formato de petición y de respuesta (",
          h("code", null, "queryResult"), ", ", h("code", null, "fulfillmentMessages"), ", ", h("code", null, "outputContexts"), "…)."),
        codeBlock(df))),

    h("div", { class: "card" },
      h("div", { class: "card-head" }, icon("zap"), h("h2", null, "Webhook (fulfillment)")),
      h("div", { class: "card-body col" },
        h("p", { class: "muted", style: { margin: 0 } }, "Para respuestas dinámicas (consultar un pedido, una base de datos…). Configura la URL en ",
          h("a", { href: agentPath("settings") }, "Ajustes"), " y activa «Llamar al webhook» en cada intención. Recibe el mismo JSON que enviaría Dialogflow ES y puede devolver ",
          h("code", null, "fulfillmentText"), ", ", h("code", null, "fulfillmentMessages"), ", ", h("code", null, "outputContexts"), " o ", h("code", null, "followupEventInput"), "."),
        h("b", null, "Python (Flask)"), codeBlock(flask),
        h("b", null, "Node.js (Express)"), codeBlock(express)))));
  return null;
}

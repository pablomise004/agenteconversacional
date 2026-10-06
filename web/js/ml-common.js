// Piezas comunes de las páginas de machine learning: nombres y formatos, el estado de un entrenamiento,
// imágenes (reducirlas a 64 × 64 en el navegador) y la cámara.
import { ml } from "./api.js";
import { h, icon, clear, toast } from "./ui.js";
import { nf } from "./charts.js";

// lo que necesita el formulario de entrenar (algoritmos, métricas, ejemplos): se pide una vez
let infoPromise = null;
export function mlInfo() {
  if (!infoPromise) infoPromise = ml.info().catch((e) => { infoPromise = null; throw e; });
  return infoPromise;
}

// tipos de columna
export const KINDS = {
  number: { label: "Número", icon: "hash", text: "Medidas, precios, edades: se puede comparar y hacer cuentas con él." },
  category: { label: "Categoría", icon: "tag", text: "Uno de unos pocos valores que se repiten: una isla, un color, sí o no." },
  date: { label: "Fecha", icon: "clock", text: "Se parte en año, mes y día de la semana para poder aprender de ella." },
  text: { label: "Texto libre", icon: "text", text: "Casi todos distintos (nombres, comentarios): no se usa para aprender." },
};
export function kindIcon(kind) {
  const k = KINDS[kind] || KINDS.text;
  return h("span", { class: "kind-ic " + kind, title: k.label }, icon(k.icon));
}

// tareas
export const TASKS = {
  classification: { label: "Clasificar", icon: "tag", short: "clasificación",
    text: "Predecir una categoría: la especie de un pingüino, si un correo es spam…" },
  regression: { label: "Predecir un número", icon: "hash", short: "regresión",
    text: "Predecir una cantidad: cuántas bicis se alquilarán, el precio de una casa…" },
  clustering: { label: "Agrupar", icon: "dots", short: "agrupación",
    text: "Sin respuesta que copiar: busca grupos de filas parecidas entre sí." },
  images: { label: "Clasificar imágenes", icon: "image", short: "imágenes", text: "Distinguir imágenes por clases." },
};

// métricas: las de 0 a 1 que se leen como porcentaje
const PCT = new Set(["accuracy", "balanced_accuracy", "f1_macro", "precision_macro", "recall_macro"]);
const METRIC_NAMES = {
  accuracy: "Exactitud", balanced_accuracy: "Exactitud equilibrada", f1_macro: "F1 (media de las clases)",
  r2: "R²", rmse: "Error cuadrático medio (RMSE)", mae: "Error absoluto medio (MAE)", silhouette: "Silueta",
};
// qué significa cada una, en una frase
export const METRIC_HELP = {
  accuracy: "Qué parte de las filas del examen acierta.",
  balanced_accuracy: "La exactitud de cada clase por separado, y la media: no se deja engañar si una clase es mucho más frecuente.",
  f1_macro: "Mezcla la precisión (cuando dice «A», ¿acierta?) y la exhaustividad (¿encuentra todas las «A»?) de cada clase.",
  r2: "Qué parte de la variación de los datos explica el modelo: 1 es perfecto; 0, lo mismo que decir siempre la media.",
  rmse: "Lo que se equivoca de media, en las unidades de lo que se predice (los errores grandes pesan más).",
  mae: "Lo que se equivoca de media, en las unidades de lo que se predice.",
  silhouette: "Si cada fila está más cerca de los de su grupo que de los del grupo vecino: de −1 a 1, mejor cuanto más alto.",
};
export const metricName = (key) => METRIC_NAMES[key] || key;
// «k vecinos más cercanos (k = 5)» sin partir «k = 5» al final de una línea (en las tablas, la columna es estrecha)
export const keepTogether = (name) => String(name).replace(/ = /g, " = ").replace(/\((\d+) /g, "($1 ")
  .replace(/ (\d+)\)/g, " $1)");
export const higherIsBetter = (key) => key !== "rmse" && key !== "mae";
export const isPct = (key) => PCT.has(key);

// R² y silueta siempre con tres decimales: en una columna, «0,8» junto a «0,897» parecía menos preciso
const three = new Intl.NumberFormat("es-ES", { minimumFractionDigits: 3, maximumFractionDigits: 3 });

export function fmtMetric(key, v) {
  if (v == null || !isFinite(v)) return "—";
  if (PCT.has(key)) return nf(1).format(v * 100) + "\u00a0%";  // sin partir la línea entre el número y el %
  if (key === "r2" || key === "silhouette") return three.format(v);
  return fmtNum(v);
}

export function fmtNum(v, digits) {
  if (v == null || !isFinite(v)) return "—";
  if (digits != null) return nf(digits).format(v);
  const a = Math.abs(v);
  return nf(a >= 1000 ? 0 : a >= 100 ? 1 : a >= 1 ? 2 : 3).format(v);
}

// Cómo se lee la nota: bien, regular o mal (con icono y texto, no solo color)
export function verdict(key, v, baseline) {
  if (v == null) return null;
  let good, ok;
  if (key === "silhouette") { good = v >= 0.5; ok = v >= 0.25; }
  else if (key === "r2") { good = v >= 0.75; ok = v >= 0.4; }
  else if (PCT.has(key)) {
    const base = baseline ?? 0;
    good = v >= Math.max(0.85, base + 0.1);
    ok = v > base + 0.05;
  } else return null;
  const [cls, mark, text] = good ? ["good", "✓", "Funciona bien"] : ok ? ["warn", "~", "Regular: se puede mejorar"]
    : ["critical", "✗", "Flojo: apenas aprende"];
  return h("span", { class: "verdict" }, h("span", { class: "status-icon " + cls }, mark), text);
}

// estado de un entrenamiento
const STATUS = {
  queued: ["En cola", ""], running: ["Entrenando", "primary"], done: ["Terminado", "success"],
  failed: ["Ha fallado", "danger"], cancelled: ["Cancelado", ""], interrupted: ["Interrumpido", "warning"],
};
export function statusBadge(status) {
  const [label, cls] = STATUS[status] || [status, ""];
  return h("span", { class: "badge status-badge " + cls }, status === "running" || status === "queued"
    ? h("span", { class: "spinner" }) : status === "done" ? icon("check") : null, label);
}
export const isLive = (status) => status === "queued" || status === "running";

export function fmtDuration(seconds) {
  if (seconds == null || !isFinite(seconds)) return "";
  if (seconds < 1) return "menos de 1 s";
  if (seconds < 60) return nf(seconds < 10 ? 1 : 0).format(seconds) + " s";
  const m = Math.floor(seconds / 60), s = Math.round(seconds % 60);
  return `${m} min${s ? " " + s + " s" : ""}`;
}

// colores de los proyectos por tipo (los avatares de las tarjetas)
export const KIND_COLORS = {
  table: { "--av1": "#5b5cf6", "--av2": "#2a78d6" },
  images: { "--av1": "#eb6834", "--av2": "#c2410c" },
};
export const projectIcon = (p) => (p.example === "pinguinos" ? "bird" : p.example === "bicis" ? "bike"
  : p.kind === "images" ? "image" : "table");

export function kindTile(p, cls = "") {
  return h("span", { class: "kind-tile " + cls, style: KIND_COLORS[p.kind] || KIND_COLORS.table }, icon(projectIcon(p)));
}

// colores de las clases de imágenes: tonos de la marca, solo para distinguir las tarjetas
const CLASS_COLORS = [["#5b5cf6", "#9645ee"], ["#eb6834", "#d97706"], ["#1baf7a", "#0e7490"], ["#2a78d6", "#0ea5e9"],
  ["#db2777", "#9645ee"], ["#65a30d", "#1baf7a"]];
export const classColor = (i) => ({ "--av1": CLASS_COLORS[i % CLASS_COLORS.length][0], "--av2": CLASS_COLORS[i % CLASS_COLORS.length][1] });

// ------------------------------------------------------------------ imágenes
export const IMG = 64;

function toBase64(bytes) {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/**
 * Recorta el centro (cuadrado) de una imagen, un vídeo o un lienzo y lo reduce a 64 × 64 en dos pasos
 * (así no salen dientes de sierra). Devuelve los píxeles RGB en base64 (lo que espera la API) y una
 * miniatura PNG para enseñarla.
 */
export function sampleFrom(source, width, height) {
  const side = Math.min(width, height);
  const sx = (width - side) / 2, sy = (height - side) / 2;
  const mid = document.createElement("canvas");
  const midSize = Math.min(side, IMG * 4);
  mid.width = mid.height = midSize;
  const mctx = mid.getContext("2d");
  mctx.fillStyle = "#fff";  // las transparencias, sobre blanco
  mctx.fillRect(0, 0, midSize, midSize);
  mctx.imageSmoothingQuality = "high";
  mctx.drawImage(source, sx, sy, side, side, 0, 0, midSize, midSize);
  const out = document.createElement("canvas");
  out.width = out.height = IMG;
  const ctx = out.getContext("2d", { willReadFrequently: true });
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(mid, 0, 0, IMG, IMG);
  const rgba = ctx.getImageData(0, 0, IMG, IMG).data;
  const rgb = new Uint8Array(IMG * IMG * 3);
  for (let i = 0, j = 0; i < rgba.length; i += 4) { rgb[j++] = rgba[i]; rgb[j++] = rgba[i + 1]; rgb[j++] = rgba[i + 2]; }
  return { b64: toBase64(rgb), thumb: out.toDataURL("image/png") };
}

/** Un fichero de imagen (JPG, PNG, WebP…) reducido a 64 × 64. */
export async function sampleFromFile(file) {
  if (window.createImageBitmap) {
    try {
      const bmp = await createImageBitmap(file);
      const out = sampleFrom(bmp, bmp.width, bmp.height);
      bmp.close && bmp.close();
      return out;
    } catch (e) { /* algunos formatos solo los abre <img> */ }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const im = new Image();
      im.onload = () => resolve(im);
      im.onerror = () => reject(new Error(`«${file.name}» no es una imagen que se pueda abrir`));
      im.src = url;
    });
    return sampleFrom(img, img.naturalWidth, img.naturalHeight);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Varios ficheros a la vez; los que no son imágenes se saltan (y se cuenta). */
export async function samplesFromFiles(files, onProgress) {
  const out = [];
  let skipped = 0, i = 0;
  for (const f of files) {
    i++;
    if (f.type && !f.type.startsWith("image/")) { skipped++; continue; }
    try { out.push(await sampleFromFile(f)); } catch (e) { skipped++; }
    if (onProgress) onProgress(i, files.length);
  }
  if (skipped) toast(`${skipped} ${skipped === 1 ? "fichero no era una imagen" : "ficheros no eran imágenes"} y se ${skipped === 1 ? "ha" : "han"} saltado`, "info", 3500);
  return out;
}

/**
 * La cámara del ordenador o del móvil: vista previa cuadrada (en espejo, como un espejo de verdad) y
 * botones para capturar una foto o muchas seguidas mientras se mantiene pulsado.
 * onCapture(sample) recibe cada foto ya reducida. Devuelve { el, stop }.
 */
export function webcam({ onCapture, holdLabel = "Mantén pulsado para grabar", single = false }) {
  const video = h("video", { autoplay: true, muted: true, playsinline: true });
  const count = h("span", { class: "cam-count" }, "0 fotos");
  const view = h("div", { class: "cam-view" }, video, h("span", { class: "cam-rec" }), single ? null : count);
  const msg = h("div", { class: "cam-msg" }, "Pidiendo permiso para usar la cámara…");
  let stream = null, timer = 0, taken = 0;
  const shoot = () => {
    if (!video.videoWidth) return;
    const sample = sampleFrom(video, video.videoWidth, video.videoHeight);
    taken++;
    count.textContent = `${taken} ${taken === 1 ? "foto" : "fotos"}`;
    view.classList.remove("flash");
    void view.offsetWidth;
    view.classList.add("flash");
    onCapture(sample);
  };
  const stopHold = () => {
    clearInterval(timer);
    timer = 0;
    view.classList.remove("recording");
    hold.classList.remove("active");
  };
  const snap = h("button", { class: "btn" + (single ? " primary" : ""), type: "button", disabled: true, onclick: shoot },
    icon("camera"), single ? "Hacer la foto" : "Una foto");
  const hold = h("button", { class: "btn primary hold", type: "button", disabled: true }, icon("play"), holdLabel);
  hold.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    hold.setPointerCapture && hold.setPointerCapture(e.pointerId);
    shoot();
    view.classList.add("recording");
    hold.classList.add("active");
    timer = setInterval(shoot, 150);
  });
  ["pointerup", "pointercancel", "lostpointercapture"].forEach((t) => hold.addEventListener(t, stopHold));
  hold.addEventListener("keydown", (e) => { if ((e.key === " " || e.key === "Enter") && !timer) { e.preventDefault(); shoot(); } });
  const el = h("div", { class: "cam" }, view, msg, h("div", { class: "cam-actions" }, snap, single ? null : hold));
  function stop() {
    stopHold();
    if (stream) stream.getTracks().forEach((t) => t.stop());
    stream = null;
  }
  (async () => {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      msg.textContent = "Este navegador no deja usar la cámara aquí: solo funciona en una dirección https o en localhost.";
      return;
    }
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 640 }, height: { ideal: 640 }, facingMode: "user" }, audio: false });
      if (!el.isConnected) { stop(); return; }
      video.srcObject = stream;
      await video.play().catch(() => {});
      clear(msg).append(single ? "Pon delante lo que quieras que reconozca." : "Cada foto se recorta al cuadrado que ves. Muévelo un poco entre foto y foto: así aprende mejor.");
      snap.disabled = false;
      hold.disabled = false;
    } catch (e) {
      msg.textContent = e && e.name === "NotAllowedError"
        ? "No hay permiso para usar la cámara. Puedes darlo en el candado de la barra de direcciones."
        : "No se ha podido abrir la cámara: " + (e.message || e.name);
    }
  })();
  return { el, stop, shoot };
}

/** Elegir ficheros (con un <input type=file> escondido). */
export function pickFiles({ accept = "", multiple = false } = {}) {
  return new Promise((resolve) => {
    const input = h("input", { type: "file", accept, multiple, style: { display: "none" } });
    input.addEventListener("change", () => { resolve([...input.files]); input.remove(); });
    input.addEventListener("cancel", () => { resolve([]); input.remove(); });
    document.body.append(input);
    input.click();
  });
}

/** Zona para arrastrar y soltar ficheros (o hacer clic para elegirlos). */
export function dropZone({ title, text, accept = "", multiple = false, onFiles, compact = false, iconName = "upload" }) {
  const zone = h("div", { class: "drop-zone" + (compact ? " compact" : ""), tabindex: "0", role: "button", "aria-label": title },
    h("span", { class: "dz-icon" }, icon(iconName)), h("div", null, h("b", null, title), text ? h("p", null, text) : null));
  const open = async () => { const files = await pickFiles({ accept, multiple }); if (files.length) onFiles(files); };
  zone.addEventListener("click", open);
  zone.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); } });
  zone.addEventListener("dragover", (e) => { e.preventDefault(); zone.classList.add("over"); });
  zone.addEventListener("dragleave", (e) => { if (!zone.contains(e.relatedTarget)) zone.classList.remove("over"); });
  zone.addEventListener("drop", (e) => {
    e.preventDefault();
    zone.classList.remove("over");
    const files = [...(e.dataTransfer ? e.dataTransfer.files : [])];
    if (files.length) onFiles(multiple ? files : files.slice(0, 1));
  });
  return zone;
}

/** El modelo con el que se prueba por defecto: el publicado, si no el mejor, si no el más nuevo. */
export function defaultModel(project) {
  const models = project.models || [];
  const pub = project.published && models.find((m) => m.id === project.published.modelId);
  return pub || (project.best && models.find((m) => m.id === project.best.modelId)) || models.find((m) => m.best) || models[0] || null;
}

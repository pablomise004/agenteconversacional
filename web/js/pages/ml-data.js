// Datos de un proyecto: la tabla (CSV) con el perfil de cada columna, o las imágenes de cada clase.
import { ml } from "../api.js";
import { h, icon, clear, toast, errorToast, confirmDialog, promptDialog, selectMenu, pageHead, emptyState, timeAgo,
  fullDate, downloadFile, stagger, busy } from "../ui.js";
import { barList, nf } from "../charts.js";
import { histogram } from "../ml-charts.js";
import { navigate, projectPath, reloadProject, state } from "../app.js";
import { KINDS, kindIcon, dropZone, pickFiles, samplesFromFiles, webcam, classColor, mlInfo, fmtNum } from "../ml-common.js";

const MISSING = new Set(["", "na", "n/a", "nan", "null", "none", "?", "-", "#n/a", "#¡valor!", "#value!"]);
const isMissing = (v) => v == null || MISSING.has(String(v).trim().toLowerCase());
const DELIMITERS = { ",": "comas", ";": "punto y coma", "\t": "tabuladores", "|": "barras" };

export async function render(el) {
  const p = state.project;
  const page = h("div", { class: "page cq" });
  el.append(page);
  return p.kind === "images" ? renderImages(page, p) : renderTable(page, p);
}

// ------------------------------------------------------------------ tabla
async function uploadCsv(p, file, zone) {
  if (zone) zone.classList.add("busy");
  try {
    if (file.size > 20 * 1024 * 1024) throw new Error("El fichero es demasiado grande (más de 20 MB)");
    await ml.upload(p.id, file);
    await reloadProject();
    toast(`«${file.name}» subido`, "success");
    navigate(projectPath("data"));
  } catch (e) {
    errorToast(e);
  } finally {
    if (zone) zone.classList.remove("busy");
  }
}

function csvHelp() {
  return h("div", { class: "notice info" }, icon("info"), h("div", null,
    h("b", null, "¿Qué es un CSV? "),
    "Una tabla guardada como texto: la primera fila con el nombre de cada columna y una fila por cada ejemplo. Excel, Google ",
    "Sheets o LibreOffice lo guardan con «Guardar como → CSV». Vale separado por comas, por punto y coma o por tabuladores, ",
    "y con coma o punto decimal: se detecta solo."));
}

function renderTable(page, p) {
  const upload = (files) => uploadCsv(p, files[0], null);
  const pickCsv = async () => { const f = await pickFiles({ accept: ".csv,.tsv,.txt,text/csv" }); if (f.length) upload(f); };
  if (!p.data || !p.profile) {
    const zone = dropZone({ title: "Arrastra aquí tu CSV o haz clic para elegirlo", accept: ".csv,.tsv,.txt,text/csv",
      text: "Hasta 20 MB. Cada fila es un ejemplo y cada columna, un dato de ese ejemplo (una de ellas será la que quieres predecir).",
      onFiles: (files) => uploadCsv(p, files[0], zone) });
    page.append(pageHead({ icon: "table", title: "Datos", sub: "Empieza subiendo la tabla con la que aprenderá el modelo." }),
      zone, h("div", { style: { height: "16px" } }), csvHelp(),
      h("p", { class: "muted small", style: { marginTop: "14px" } }, "¿Aún no tienes datos? En ",
        h("a", { href: "#/ml" }, "Machine learning"), " hay ejemplos listos para practicar (pingüinos, alquiler de bicis…)."));
    return null;
  }
  const prof = p.profile;
  const d = p.data;
  page.append(pageHead({
    icon: "table", title: "Datos",
    sub: "Revisa que cada columna tenga el tipo correcto: así sabe cómo aprender de ella.",
    actions: [
      h("button", { class: "btn", type: "button", onclick: async () => {
        try {
          const res = await ml.csv(p.id);
          downloadFile(`${p.id}.csv`, await res.text(), "text/csv");
        } catch (e) { errorToast(e); }
      } }, icon("download"), "Descargar"),
      h("button", { class: "btn", type: "button", onclick: pickCsv, title: "Sustituye la tabla (los modelos ya entrenados se quedan)" }, icon("upload"), "Subir otro CSV"),
      h("a", { class: "btn primary", href: projectPath("train") }, "Entrenar", icon("arrowRight")),
    ],
  }));
  const missing = prof.columns.reduce((a, c) => a + c.missing, 0);
  const cells = prof.rows * prof.columns.length;
  page.append(h("div", { class: "data-facts", style: { marginBottom: "18px" } },
    h("span", null, icon("table"), h("b", null, nf(0).format(prof.rows)), " filas"),
    h("span", null, icon("layers"), h("b", null, String(prof.columns.length)), " columnas"),
    h("span", { title: "Casillas sin valor" }, icon("alert"), h("b", null, nf(0).format(missing)), ` vacías (${nf(1).format(cells ? (missing / cells) * 100 : 0)} %)`),
    d.file ? h("span", { title: fullDate(d.uploadedAt) }, icon("upload"), d.file, " · ", timeAgo(d.uploadedAt)) : null,
    h("span", null, icon("code"), `separado por ${DELIMITERS[prof.delimiter] || prof.delimiter}, decimales con ${prof.decimal === "," ? "coma" : "punto"}`)));

  // las columnas
  const cardsBox = h("div", { class: "col-cards" });
  const kindsHelp = h("div", { class: "kinds-help" }, Object.entries(KINDS).map(([k, v]) =>
    h("div", null, kindIcon(k), h("div", null, h("b", null, v.label), v.text))));
  page.append(h("div", { class: "section-head" }, h("h2", null, icon("layers"), "Columnas", h("span", { class: "badge" }, String(prof.columns.length))),
    h("p", null, "Se adivina el tipo de cada una; si se equivoca, cámbialo. Una columna de números que en realidad son códigos (un año, un código postal) va mejor como categoría.")),
  h("div", { class: "card", style: { padding: "14px 16px", marginBottom: "14px" } }, kindsHelp), cardsBox);

  const preview = h("div", { class: "card data-preview", style: { marginTop: "26px" } });
  const paintColumns = (profile) => {
    clear(cardsBox).append(...profile.columns.map((c) => columnCard(p, c, async (kind) => {
      try {
        const updated = await ml.update(p.id, { types: { [c.name]: kind } });
        state.project = updated;
        toast(`«${c.name}» ahora es ${KINDS[kind].label.toLowerCase()}`, "success");
        paintColumns(updated.profile);
        loadPreview(preview, p, updated.profile);
      } catch (e) { errorToast(e); paintColumns(state.project.profile); }
    })));
    stagger(cardsBox);
  };
  paintColumns(prof);
  page.append(h("div", { class: "section-head", style: { marginTop: "30px" } }, h("h2", null, icon("eye"), "Vista previa"),
    h("p", null, "Las filas tal como están en el fichero.")), preview);
  preview.style.marginTop = "0";
  loadPreview(preview, p, prof);

  // soltar un CSV encima de la página también lo sube
  page.addEventListener("dragover", (e) => { if (e.dataTransfer && [...e.dataTransfer.types].includes("Files")) e.preventDefault(); });
  page.addEventListener("drop", (e) => {
    const f = e.dataTransfer && e.dataTransfer.files[0];
    if (!f) return;
    e.preventDefault();
    upload([f]);
  });
  return null;
}

const KIND_OPTIONS = Object.entries(KINDS).map(([value, k]) => ({ value, label: k.label }));

function columnCard(p, c, onKind) {
  const menu = selectMenu({ label: `Tipo de «${c.name}»`, value: c.kind, options: KIND_OPTIONS });
  menu.addEventListener("change", () => { if (menu.value !== c.kind) onKind(menu.value); });
  const facts = [];
  if (c.kind === "number" && c.min != null) {
    facts.push(h("span", null, "de ", h("b", null, fmtNum(c.min)), " a ", h("b", null, fmtNum(c.max))),
      h("span", null, "media ", h("b", null, fmtNum(c.mean))));
  } else if (c.kind === "date" && c.min) {
    facts.push(h("span", null, "del ", h("b", null, c.min), " al ", h("b", null, c.max)));
  } else {
    facts.push(h("span", null, h("b", null, nf(0).format(c.unique)), c.unique === 1 ? " valor" : " valores distintos"));
  }
  if (c.kind === "number") facts.push(h("span", null, h("b", null, nf(0).format(c.unique)), " distintos"));
  facts.push(c.missing ? h("span", { style: { color: "var(--warning)" } }, h("b", { style: { color: "inherit" } }, nf(0).format(c.missing)), " vacíos")
    : h("span", null, "sin vacíos"));
  let chart = null;
  if (c.kind === "number" || c.kind === "date") chart = histogram(c, { label: `Cómo se reparten los valores de ${c.name}` });
  else if (c.top && c.top.length) {
    const items = c.top.slice(0, 5).map((t) => ({ label: t.value, value: t.count, tip: `${t.count} filas` }));
    chart = h("div", { class: "col-top" }, barList({ items, format: (v) => nf(0).format(v) + " filas", labelWidth: 96 }),
      c.unique > 5 ? h("div", { class: "col-note" }, `y ${nf(0).format(c.unique - 5)} valores más`) : null);
  }
  const unused = c.isId || c.kind === "text";
  return h("div", { class: "card col-card" + (unused ? " unused" : ""), dataset: { column: c.name } },
    h("div", { class: "col-head" }, kindIcon(c.kind), h("span", { class: "col-name", title: c.name }, c.name)),
    h("div", { class: "col-type" }, h("span", { class: "faint small" }, "Tipo"), menu),
    h("div", { class: "col-facts" }, facts),
    c.isId ? h("div", { class: "col-note" }, icon("info"), " Parece un identificador (cada fila tiene uno distinto): no se usa para aprender.")
      : c.kind === "text" ? h("div", { class: "col-note" }, "Texto libre: no se usa para aprender. Ejemplos: ", c.examples.slice(0, 2).map((x) => `«${x}»`).join(", "))
        : null,
    chart ? h("div", { class: "col-chart" }, chart) : null);
}

async function loadPreview(card, p, profile) {
  clear(card).append(h("div", { class: "muted small", style: { padding: "18px" } }, "Cargando filas…"));
  const kinds = Object.fromEntries(profile.columns.map((c) => [c.name, c.kind]));
  let rows = [], total = 0, columns = [];
  const tbody = h("tbody");
  const foot = h("div", { class: "table-foot" });
  const addRows = (chunk, offset) => {
    chunk.forEach((r, i) => tbody.append(h("tr", null, h("td", { class: "idx num" }, String(offset + i + 1)),
      r.map((v, j) => h("td", { class: kinds[columns[j]] === "number" ? "num" : null, title: String(v || "") },
        isMissing(v) ? h("span", { class: "cell-missing" }, "vacío") : v)))));
  };
  const more = h("button", { class: "btn sm", type: "button" }, icon("down"), "Ver 50 más");
  const paintFoot = () => {
    clear(foot).append(h("span", null, `Mostrando ${nf(0).format(rows.length)} de ${nf(0).format(total)} filas`), h("span", { class: "spacer" }),
      rows.length < total ? more : null);
  };
  more.addEventListener("click", () => busy(more, async () => {
    try {
      const res = await ml.rows(p.id, rows.length, 50);
      addRows(res.rows, rows.length);
      rows = rows.concat(res.rows);
      paintFoot();
    } catch (e) { errorToast(e); }
  }));
  try {
    const res = await ml.rows(p.id, 0, 50);
    rows = res.rows;
    total = res.total;
    columns = res.columns;
  } catch (e) {
    clear(card).append(h("div", { class: "notice danger", style: { margin: "14px" } }, icon("alert"), e.message));
    return;
  }
  addRows(rows, 0);
  const table = h("table", { class: "table" },
    h("thead", null, h("tr", null, h("th", { class: "num", scope: "col" }, "#"),
      columns.map((c) => h("th", { scope: "col", class: kinds[c] === "number" ? "num" : null }, kindIcon(kinds[c] || "text"), c)))),
    tbody);
  paintFoot();
  clear(card).append(h("div", { class: "table-wrap scroll", style: { border: 0, borderRadius: "var(--radius) var(--radius) 0 0" } }, table), foot);
}

// ---------------------------------------------------------------- imágenes
async function renderImages(page, p) {
  const info = await mlInfo().catch(() => null);
  const limits = info ? info.limits : { images: 1500, classes: 20 };
  let data;
  try {
    data = await ml.images(p.id);
  } catch (e) {
    page.append(h("div", { class: "notice danger" }, icon("alert"), e.message));
    return null;
  }
  const classes = data.classes.map((c) => ({ ...c, images: [...c.images] }));
  const sub = h("span");
  const paintSub = () => {
    const n = classes.reduce((a, c) => a + c.images.length, 0);
    const k = classes.filter((c) => c.images.length).length;
    sub.textContent = n ? `${nf(0).format(n)} imágenes en ${k} ${k === 1 ? "clase" : "clases"}. Cuantas más y más variadas, mejor aprende.`
      : "Crea una clase por cada cosa que quieras distinguir y añade fotos de cada una.";
  };
  paintSub();
  page.append(pageHead({
    icon: "image", title: "Imágenes", titleNode: null, sub,
    actions: [
      h("button", { class: "btn", type: "button", title: "Un ZIP con una carpeta por clase (lo que espera el script de PyTorch)",
        onclick: async () => {
          try {
            const res = await ml.imagesZip(p.id);
            if (!res.ok) throw new Error("No se ha podido descargar");
            downloadFile(`${p.id}-imagenes.zip`, await res.blob(), "application/zip");
          } catch (e) { errorToast(e); }
        } }, icon("download"), "Descargar ZIP"),
      h("a", { class: "btn primary", href: projectPath("train") }, "Entrenar", icon("arrowRight")),
    ],
  }));
  page.append(h("div", { class: "notice info", style: { marginBottom: "18px" } }, icon("info"), h("div", null,
    h("b", null, "Consejos: "), "al menos 2 clases y unas 20 fotos de cada una. Que cambien el fondo, la luz y la posición: si todas las ",
    "fotos de una clase tienen el mismo fondo, el modelo puede aprenderse el fondo en vez del objeto. Las fotos se recortan al centro ",
    `y se reducen a ${limits.imageSize || 64} × ${limits.imageSize || 64} píxeles en tu navegador.`)));

  const grid = h("div", { class: "img-classes" });
  page.append(grid);
  let camera = null;  // { stop, card }: solo una cámara abierta a la vez
  const closeCamera = () => { if (camera) { camera.close(); camera = null; } };

  const newClassCard = h("button", { class: "card img-class new-class", type: "button", onclick: async () => {
    const name = await promptDialog("Nueva clase", { label: "Nombre de la clase", placeholder: "Por ejemplo: gato",
      hint: "Lo que dirá el modelo cuando reconozca una imagen de esta clase.", okLabel: "Crear clase" });
    if (!name) return;
    if (classes.some((c) => c.name.toLowerCase() === name.toLowerCase())) { toast("Ya hay una clase con ese nombre", "error"); return; }
    if (classes.length >= limits.classes) { toast(`Como mucho ${limits.classes} clases`, "error"); return; }
    const c = { name, count: 0, images: [] };
    classes.push(c);
    const card = classCard(c, classes.length - 1);
    grid.insertBefore(card, newClassCard);
    card.querySelector(".class-actions .btn").focus();
  } }, h("span", { class: "plus" }, icon("plus")), "Nueva clase");

  function classCard(c, index) {
    const thumbs = h("div", { class: "thumbs" });
    const countBadge = h("span", { class: "badge" });
    const nameEl = h("span", { class: "class-name", title: c.name }, c.name);
    const status = h("div", { class: "upload-progress", hidden: true });
    const empty = h("div", { class: "class-empty" }, "Sin imágenes todavía: súbelas o usa la cámara.");
    const camBox = h("div", { hidden: true });
    const paint = () => {
      countBadge.textContent = `${c.images.length} ${c.images.length === 1 ? "imagen" : "imágenes"}`;
      empty.hidden = c.images.length > 0;
      paintSub();
    };
    const thumb = (img, isNew) => {
      const t = h("div", { class: "thumb" + (isNew ? " new" : "") },
        h("img", { src: img.thumb, alt: `${c.name}`, loading: "lazy" }),
        h("button", { type: "button", "aria-label": "Quitar esta imagen", title: "Quitar", onclick: async () => {
          try {
            await ml.deleteImage(p.id, img.id);
            c.images = c.images.filter((x) => x.id !== img.id);
            t.remove();
            paint();
            reloadProject().catch(() => {});
          } catch (e) { errorToast(e); }
        } }, icon("x")));
      return t;
    };
    c.images.forEach((img, i) => { const t = thumb(img); t.style.setProperty("--i", Math.min(i, 30)); thumbs.append(t); });

    // subir en tandas (la API acepta hasta 200 por petición; de 40 en 40 se ve avanzar)
    let queue = [], sending = false;
    async function flush() {
      if (sending || !queue.length) return;
      sending = true;
      try {
        while (queue.length) {
          const batch = queue.splice(0, 40);
          status.hidden = false;
          clear(status).append(h("span", { class: "spinner" }), `Guardando ${batch.length + queue.length} ${batch.length + queue.length === 1 ? "imagen" : "imágenes"}…`);
          const res = await ml.addImages(p.id, c.name, batch.map((s) => s.b64));
          for (const img of res.added) {
            c.images.push(img);
            thumbs.append(thumb(img, true));
          }
          thumbs.scrollTop = thumbs.scrollHeight;
          paint();
        }
        reloadProject().catch(() => {});
      } catch (e) {
        errorToast(e);
        queue = [];
      } finally {
        sending = false;
        status.hidden = true;
      }
    }
    const addSamples = (samples) => { queue.push(...samples); flush(); };
    const fromFiles = async (files) => {
      status.hidden = false;
      clear(status).append(h("span", { class: "spinner" }), "Preparando las imágenes…");
      const samples = await samplesFromFiles(files, (i, n) => { status.lastChild.textContent = `Preparando las imágenes… ${i} de ${n}`; });
      status.hidden = true;
      if (samples.length) addSamples(samples);
    };
    const zone = dropZone({ title: "Arrastra fotos aquí", text: "o haz clic para elegirlas (JPG, PNG, WebP…)", accept: "image/*",
      multiple: true, compact: true, iconName: "image", onFiles: fromFiles });
    const camBtn = h("button", { class: "btn", type: "button" }, icon("camera"), "Usar la cámara");
    camBtn.addEventListener("click", () => {
      if (camera && camera.card === card) { closeCamera(); return; }
      closeCamera();
      let pending = [], timer = 0;
      const cam = webcam({ onCapture: (sample) => {
        pending.push(sample);
        clearTimeout(timer);
        timer = setTimeout(() => { addSamples(pending); pending = []; }, pending.length >= 20 ? 0 : 500);
      } });
      clear(camBox).append(cam.el);
      camBox.hidden = false;
      clear(camBtn).append(icon("x"), "Cerrar la cámara");
      camera = {
        card,
        close: () => {
          cam.stop();
          if (pending.length) { addSamples(pending); pending = []; }
          clear(camBox);
          camBox.hidden = true;
          clear(camBtn).append(icon("camera"), "Usar la cámara");
        },
      };
    });
    const card = h("div", { class: "card img-class", dataset: { label: c.name }, style: { "--i": index } },
      h("div", { class: "card-head" }, h("span", { class: "class-dot", style: classColor(index) }), nameEl, countBadge,
        h("span", { class: "spacer" }),
        h("button", { class: "btn ghost sm icon-only", type: "button", "aria-label": "Cambiar el nombre", title: "Cambiar el nombre",
          onclick: async () => {
            const name = await promptDialog("Cambiar el nombre", { label: "Nombre de la clase", value: c.name, okLabel: "Guardar" });
            if (!name || name === c.name) return;
            try {
              if (c.images.length) await ml.renameClass(p.id, c.name, name);
              c.name = name;
              nameEl.textContent = name;
              nameEl.title = name;
              card.dataset.label = name;
              reloadProject().catch(() => {});
            } catch (e) { errorToast(e); }
          } }, icon("edit")),
        h("button", { class: "btn ghost sm icon-only", type: "button", "aria-label": "Borrar la clase", title: "Borrar la clase",
          onclick: async () => {
            if (c.images.length && !(await confirmDialog(`Se borrará la clase «${c.name}» con sus ${c.images.length} imágenes.`,
              { title: "Borrar la clase", okLabel: "Borrar", danger: true }))) return;
            try {
              if (c.images.length) await ml.deleteClass(p.id, c.name);
              if (camera && camera.card === card) closeCamera();
              classes.splice(classes.indexOf(c), 1);
              card.remove();
              paintSub();
              reloadProject().catch(() => {});
            } catch (e) { errorToast(e); }
          } }, icon("trash"))),
      h("div", { class: "card-body" }, empty, thumbs, status, camBox,
        h("div", { class: "class-actions" }, camBtn), zone));
    paint();
    return card;
  }

  classes.forEach((c, i) => grid.append(classCard(c, i)));
  grid.append(newClassCard);
  if (!classes.length) {
    // proyecto nuevo: dos clases vacías para empezar
    for (const name of ["Clase 1", "Clase 2"]) {
      const c = { name, count: 0, images: [] };
      classes.push(c);
      grid.insertBefore(classCard(c, classes.length - 1), newClassCard);
    }
    grid.prepend(h("div", { style: { gridColumn: "1 / -1" } }, emptyState({ icon: "image", title: "Empieza con dos clases",
      text: "Cambia sus nombres (el lápiz) por lo que quieres distinguir —por ejemplo «con gafas» y «sin gafas»— y añade fotos a cada una." })));
  }
  return { destroy: closeCamera };
}

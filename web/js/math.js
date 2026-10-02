// Fórmulas matemáticas en MathML, que dibuja el propio navegador (sin librerías ni CDN), a partir
// de una notación tipo TeX: tex("p_k = \\frac{e^{z_k}}{\\sum_j e^{z_j}}", { display: true }).
// Crea los nodos uno a uno (nunca innerHTML). Admite lo que usan las páginas de la consola:
//   x^2  x_{ij}  \frac{a}{b}  \sqrt{x}  \sum_{j=1}^{K}  \max_k  \text{texto}  \op{sim} (palabra en
//   redonda)  \mathbf{x}  \hat{p}  \left( … \right)  \cases{a & si … \\ b & si …}  \quad  \,
//   letras griegas, ≤ ≥ · × → ∈ ‖ … y los números con coma decimal (0,65).

const NS = "http://www.w3.org/1998/Math/MathML";

function m(tag, attrs, ...kids) {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs || {})) if (v != null) el.setAttribute(k, String(v));
  for (const k of kids.flat()) if (k != null) el.append(k instanceof Node ? k : document.createTextNode(String(k)));
  return el;
}

const IDENT = {
  alpha: "α", beta: "β", gamma: "γ", delta: "δ", epsilon: "ε", eta: "η", theta: "θ", lambda: "λ",
  mu: "μ", pi: "π", sigma: "σ", tau: "τ", phi: "φ", omega: "ω", Delta: "Δ", Sigma: "Σ", Omega: "Ω",
  infty: "∞", partial: "∂", nabla: "∇", ldots: "…", cdots: "⋯", ell: "ℓ", emptyset: "∅",
};
const OPS = {
  cdot: "·", times: "×", le: "≤", ge: "≥", ne: "≠", approx: "≈", to: "→", gets: "←", leftarrow: "←",
  Rightarrow: "⇒", in: "∈", notin: "∉", oplus: "⊕", pm: "±", propto: "∝", mid: "∣", lVert: "‖",
  rVert: "‖", "|": "‖", sum: "∑", prod: "∏", langle: "⟨", rangle: "⟩", "{": "{", "}": "}", cup: "∪",
  cap: "∩", setminus: "∖", subset: "⊂", forall: "∀", lfloor: "⌊", rfloor: "⌋", circ: "∘", mapsto: "↦",
};
const FUNCS = { ln: "ln", log: "log", exp: "exp", cos: "cos", sin: "sin", max: "max", min: "min",
  argmax: "arg max", argmin: "arg min", lim: "lim", sign: "sign" };
const LIMITS = new Set(["∑", "∏", "max", "min", "arg max", "arg min", "lim"]);
const ACCENTS = { hat: "^", bar: "¯", tilde: "~", vec: "→", dot: "˙" };
const SPACES = { quad: "1em", qquad: "2em", ",": "0.17em", ":": "0.22em", ";": "0.28em", " ": "0.25em" };
const MINUS = "−";

// letra en negrita matemática (𝐱, 𝐖): MathML Core no admite mathvariant="bold"
const bold = (ch) => {
  const c = ch.codePointAt(0);
  if (c >= 97 && c <= 122) return String.fromCodePoint(0x1d41a + c - 97);
  if (c >= 65 && c <= 90) return String.fromCodePoint(0x1d400 + c - 65);
  return ch;
};

function parse(src, display) {
  let i = 0;
  const skip = () => { while (i < src.length && /\s/.test(src[i])) i++; };
  const row = (items) => (items.length === 1 ? items[0] : m("mrow", null, items));

  // lo que hay entre llaves, tal cual
  function raw() {
    skip();
    if (src[i] !== "{") return src[i++] || "";
    let depth = 0;
    const start = ++i;
    while (i < src.length && (src[i] !== "}" || depth)) {
      if (src[i] === "{") depth++;
      else if (src[i] === "}") depth--;
      i++;
    }
    const out = src.slice(start, i);
    i++;
    return out;
  }
  // argumento de un comando: {grupo} o un solo símbolo
  function arg() {
    skip();
    if (src[i] === "{") return row(parse(raw(), display));
    return atom();
  }

  function command() {
    let name;
    if (/[a-zA-Z]/.test(src[i])) {
      const st = i;
      while (i < src.length && /[a-zA-Z]/.test(src[i])) i++;
      name = src.slice(st, i);
    } else name = src[i++];
    if (name in SPACES) return m("mspace", { width: SPACES[name] });
    if (name === "!") return null;
    if (name === "frac") { const a = arg(); return m("mfrac", null, a, arg()); }
    if (name === "sqrt") return m("msqrt", null, arg());
    if (name === "text") {  // los espacios de los bordes se perderían en el mtext: van como mspace
      const t = raw();
      const sp = () => m("mspace", { width: SPACES[" "] });
      return m("mrow", null, /^\s/.test(t) ? sp() : null, m("mtext", null, t.trim()), /\s$/.test(t) && t.trim() ? sp() : null);
    }
    if (name === "op" || name === "mathrm" || name === "operatorname") {
      const word = raw();
      return m("mi", word.length === 1 ? { mathvariant: "normal" } : null, word);
    }
    if (name === "mathbf") return m("mi", null, [...raw()].map(bold).join(""));
    if (name in ACCENTS) return m("mover", { accent: "true" }, arg(), m("mo", null, ACCENTS[name]));
    if (name === "left" || name === "right") {  // los paréntesis de MathML ya se estiran solos
      skip();
      if (src[i] === ".") { i++; return null; }
      return src[i] === "\\" ? (i++, command()) : m("mo", null, src[i++]);
    }
    if (name === "cases") {
      const rows = raw().split("\\\\").map((r) => m("mtr", null, r.split("&").map((cell) =>
        m("mtd", null, row(parse(cell, display))))));
      return m("mrow", null, m("mo", { stretchy: "true" }, "{"), m("mtable", { columnalign: "left" }, rows));
    }
    if (name in FUNCS) return m("mi", null, FUNCS[name]);
    if (name in IDENT) return m("mi", null, IDENT[name]);
    if (name in OPS) return m("mo", null, OPS[name]);
    return m("mtext", null, "\\" + name);  // desconocido: se ve tal cual
  }

  function atom() {
    skip();
    const c = src[i];
    if (c === undefined) return null;
    if (c === "{") return row(parse(raw(), display));
    if (c === "\\") { i++; return command(); }
    if (/[0-9]/.test(c)) {  // número, con coma o punto decimal: 0,65
      const st = i;
      while (i < src.length && (/[0-9]/.test(src[i]) || (/[.,]/.test(src[i]) && /[0-9]/.test(src[i + 1] || "")))) i++;
      return m("mn", null, src.slice(st, i));
    }
    i++;
    if (/[a-zA-Z]/.test(c)) return m("mi", null, c);
    if (c === "'") return m("mo", null, "′");
    return m("mo", null, c === "-" ? MINUS : c);
  }

  const out = [];
  while (true) {
    skip();
    if (i >= src.length) break;
    let base = atom();
    if (base === null) continue;
    // índices: x_i, x^2, x_i^2 (en ∑ y max van debajo y encima si la fórmula va aparte)
    let sub = null, sup = null;
    for (;;) {
      skip();
      if (src[i] === "_" && !sub) { i++; sub = arg(); } else if (src[i] === "^" && !sup) { i++; sup = arg(); } else break;
    }
    if (sub || sup) {
      const limits = display && LIMITS.has(base.textContent);
      if (sub && sup) base = m(limits ? "munderover" : "msubsup", null, base, sub, sup);
      else if (sub) base = m(limits ? "munder" : "msub", null, base, sub);
      else base = m(limits ? "mover" : "msup", null, base, sup);
    }
    out.push(base);
  }
  return out;
}

/** Fórmula en MathML. display: en su propia línea (con los límites de ∑ y max debajo). */
export function tex(src, { display = false, label = null } = {}) {
  const items = parse(src, display);
  return m("math", { display: display ? "block" : null, "aria-label": label },
    items.length === 1 ? items[0] : m("mrow", null, items));
}

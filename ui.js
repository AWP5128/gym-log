// Helpers for building and wiring screens. The first group builds HTML text (no browser needed,
// so it can be tested). The second group works on the page.

// ---------- HTML text ----------
export const esc = (s) =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// <option> tags for a list of values. fmt turns a value into its label.
export const optionsHtml = (values, selected, fmt = String) =>
  values.map((v) => '<option value="' + v + '"' + (v === selected ? " selected" : "") + ">" + fmt(v) + "</option>").join("");

export const selectHtml = (id, inner, cls = "") =>
  "<select" + (cls ? ' class="' + cls + '"' : "") + ' id="' + id + '">' + inner + "</select>";

export const field = (id, label, control) => '<label for="' + id + '">' + label + "</label>" + control;

export const numField = (id, label, value, placeholder = "") =>
  field(
    id,
    label,
    '<input class="field" id="' + id + '" type="number" inputmode="decimal" step="any" min="0" value="' +
      (value ?? "") + '" placeholder="' + placeholder + '">'
  );

export const cols = (a, b) => '<div class="two"><div>' + a + "</div><div>" + b + "</div></div>";
export const box = (title, inner) => '<div class="panel"><strong>' + title + "</strong>" + inner + "</div>";
export const muted = (html, extra = "") => '<div class="muted' + (extra ? " " + extra : "") + '">' + html + "</div>";
export const ghostBtn = (id, html, style = "") =>
  '<button class="ghost" id="' + id + '"' + (style ? ' style="' + style + '"' : "") + ">" + html + "</button>";
export const backBtn = (label = "Back") => ghostBtn("back", "&larr; " + label, "margin-top:0");

// ---------- The page ----------
export const $ = (id) => document.getElementById(id);

// Sets the click action of each button that is on the page. The ids can share a suffix, e.g. a panel number.
export function wire(handlers, suffix = "") {
  for (const [id, onclick] of Object.entries(handlers)) {
    const el = $(id + suffix);
    if (el) el.onclick = onclick;
  }
}

// Adds a big button to the list with the given id for each [html, onclick] row.
export function addItems(id, rows) {
  $(id).append(...rows.map(([html, onclick]) => {
    const b = document.createElement("button");
    b.className = "item";
    b.innerHTML = html;
    b.onclick = onclick;
    return b;
  }));
}

// Adds a row of choice buttons for each [label, active, onclick] row.
export function addChoices(id, rows) {
  $(id).append(...rows.map(([label, active, onclick]) => {
    const b = document.createElement("button");
    b.textContent = label;
    if (active) b.className = "active";
    b.onclick = onclick;
    return b;
  }));
}

// Hands a file to the phone's share sheet (Save to Files, Drive, email...) or downloads it
// where sharing is not possible. Returns "shared", "downloaded" or "cancelled".
export async function sendFile(name, text) {
  for (const type of ["application/json", "text/plain"]) {
    const file = new File([text], name, { type });
    try {
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: name });
        return "shared";
      }
    } catch (err) {
      if (err && err.name === "AbortError") return "cancelled";
    }
  }
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  return "downloaded";
}
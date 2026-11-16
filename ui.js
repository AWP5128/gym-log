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

// ---------- Forms described as data ----------
// A form is a list of fields, shown from a draft object d (the draft holds what has been typed or chosen).
//   { key, label, type: "text" | "number" | "select" | "choice" | "note" | "textarea", placeholder?, rows?,
//     options?: [[value, label], ...] or (d) => [...]     for select and choice
//     show?: (d) => boolean                              leave the field out when false
//     text?: string or (d) => string                     the words of a note (small: false for normal size)
//     isActive?: (d, value) => boolean                   which choice is lit (default: d[key] === value)
//     onChange?: (d, value) => void                      extra changes when it is picked or typed
//     redraw?: true                                      show the screen again after a select or choice changes }
// Two layout types hold other fields: { type: "group", title, fields } is a titled box and
// { type: "pair", fields: [a, b] } puts two fields side by side. Both can have show.
// formHtml builds the text (so it can be tested); bindForm wires the page: it keeps d up to date and calls redraw().
const optionsOf = (f, d) => (typeof f.options === "function" ? f.options(d) : f.options || []);
const visible = (fields, d) => fields.filter((f) => !f.show || f.show(d));
// The fields that hold a value, with groups and pairs opened up.
const leaves = (fields, d) => visible(fields, d).flatMap((f) => (f.type === "group" || f.type === "pair" ? leaves(f.fields, d) : [f]));

export function formHtml(fields, d, prefix = "fm_") {
  return visible(fields, d).map((f) => {
    const id = prefix + f.key;
    const value = d[f.key] ?? "";
    if (f.type === "group") return box(esc(f.title), formHtml(f.fields, d, prefix));
    if (f.type === "pair") { const [a, b] = f.fields; return cols(formHtml([a], d, prefix), formHtml([b], d, prefix)); }
    if (f.type === "note") return muted(esc(typeof f.text === "function" ? f.text(d) : f.text), f.small === false ? "" : "small");
    if (f.type === "number") return numField(id, esc(f.label), value, f.placeholder || "");
    if (f.type === "textarea") return field(id, esc(f.label), '<textarea class="field" id="' + id + '" rows="' + (f.rows || 3) + '">' + esc(value) + "</textarea>");
    if (f.type === "select") {
      const inner = optionsOf(f, d).map(([v, label]) => '<option value="' + esc(v) + '"' + (String(v) === String(d[f.key] ?? "") ? " selected" : "") + ">" + esc(label) + "</option>").join("");
      return field(id, esc(f.label), selectHtml(id, inner, "field"));
    }
    if (f.type === "choice") return "<label>" + esc(f.label) + '</label><div class="choices" id="' + id + '"></div>';
    return field(id, esc(f.label), '<input class="field" id="' + id + '" type="text"' + (f.placeholder ? ' placeholder="' + esc(f.placeholder) + '"' : "") + ' value="' + esc(value) + '">');
  }).join("");
}

export function bindForm(fields, d, redraw, prefix = "fm_") {
  for (const f of leaves(fields, d)) {
    const id = prefix + f.key;
    const changed = (v) => { d[f.key] = v; f.onChange?.(d, v); if (f.redraw) redraw(); };
    if (f.type === "text" || f.type === "number" || f.type === "textarea") $(id).oninput = (ev) => changed(ev.target.value);
    else if (f.type === "select") $(id).onchange = (ev) => changed(ev.target.value);
    else if (f.type === "choice") {
      addChoices(id, optionsOf(f, d).map(([v, label]) => [label, f.isActive ? f.isActive(d, v) : d[f.key] === v, () => { changed(v); if (!f.redraw) redraw(); }]));
    }
  }
}

// ---------- Lists and chips described as data ----------
// blocks() gives one screen a small kit. Each helper returns the html of a block AND remembers how to wire it, so the
// holder id is written once and a block cannot be wired without being on the page. Call bind() after app.innerHTML is set.
//   items(id, rows)                  big buttons: rows are [html, onclick]
//   chips(id, rows, cls, style)      choice buttons: rows are [label, active, onclick]; cls and style are for the holder
//   cards(id, rows)                  a name with a small line under it and chip buttons beside it:
//                                    rows are { title, sub (html), actions: [[label, onclick], ...] }
export function blocks() {
  const todo = [];
  return {
    items(id, rows) {
      todo.push(() => addItems(id, rows));
      return '<div id="' + id + '"></div>';
    },
    chips(id, rows, cls = "choices", style = "") {
      todo.push(() => addChoices(id, rows));
      return '<div class="' + cls + '" id="' + id + '"' + (style ? ' style="' + style + '"' : "") + "></div>";
    },
    cards(id, rows) {
      todo.push(() => rows.forEach((r, i) => r.actions.forEach(([, onclick], n) => { $(id + "_" + i + "_" + n).onclick = onclick; })));
      return rows.map((r, i) =>
        '<div class="cardhead" style="margin-top:10px"><div>' + esc(r.title) +
        '<small style="display:block;color:#aaa;font-size:0.9rem">' + r.sub + "</small></div>" +
        '<span style="white-space:nowrap">' + r.actions.map(([label], n) => '<button class="chip" id="' + id + "_" + i + "_" + n + '">' + label + "</button>").join(" ") + "</span></div>"
      ).join("");
    },
    bind() { todo.splice(0).forEach((f) => f()); },
  };
}

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
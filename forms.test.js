import test from "node:test";
import assert from "node:assert/strict";
import { formHtml } from "./ui.js";

const fields = [
  { key: "name", label: "Name", type: "text", placeholder: "e.g. X" },
  { key: "type", label: "Type", type: "select", options: [["a", "Alpha"], ["b", "Beta & Co"]] },
  { key: "extra", label: "Extra", type: "select", show: (d) => d.type === "b", options: () => [["1", "One"]] },
  { type: "note", show: (d) => d.type === "a", text: (d) => "Note for " + d.name },
  { key: "watts", label: "Watts", type: "choice", options: [[true, "Yes"], [false, "No"]] },
  { key: "notes", label: "Notes", type: "textarea", rows: 4 },
];

test("formHtml builds the visible fields from the draft, escaped, with prefixed ids", () => {
  const html = formHtml(fields, { name: 'A "quoted" <b>', type: "a" }, "f_");
  assert.ok(html.includes('id="f_name"') && html.includes('placeholder="e.g. X"'));
  assert.ok(html.includes("A &quot;quoted&quot; &lt;b&gt;"));
  assert.ok(html.includes('<option value="a" selected>Alpha</option>'));
  assert.ok(html.includes("Beta &amp; Co"));
  assert.ok(!html.includes('id="f_extra"'));            // hidden while the type is not b
  assert.ok(html.includes("Note for A &quot;quoted&quot; &lt;b&gt;"));
  assert.ok(html.includes('<div class="choices" id="f_watts"></div>'));
  assert.ok(html.includes('rows="4"'));
});

test("a field that is shown only for one choice appears when it is picked", () => {
  const html = formHtml(fields, { type: "b" }, "f_");
  assert.ok(html.includes('id="f_extra"'));
  assert.ok(!html.includes("Note for"));
});

test("a group is a titled box, a pair puts two fields side by side, a number field is a number box", () => {
  const f = [
    { type: "group", title: "Target <time>", fields: [
      { type: "pair", fields: [{ key: "m", label: "Minutes", type: "number" }, { key: "s", label: "Seconds", type: "number", placeholder: "0" }] },
      { type: "note", small: false, text: "Shown on the card." },
    ] },
    { type: "group", title: "Hidden box", show: () => false, fields: [{ key: "z", label: "Z", type: "text" }] },
  ];
  const html = formHtml(f, { m: 25, s: "" }, "f_");
  assert.ok(html.startsWith('<div class="panel"><strong>Target &lt;time&gt;</strong>'));
  assert.ok(html.includes('<div class="two"><div><label for="f_m">Minutes</label>'));
  assert.ok(html.includes('id="f_m" type="number"') && html.includes('value="25"'));
  assert.ok(html.includes('id="f_s"') && html.includes('placeholder="0"'));
  assert.ok(html.includes('<div class="muted">Shown on the card.</div>'));   // small: false leaves the small class off
  assert.ok(!html.includes("Hidden box") && !html.includes('id="f_z"'));
});

test("a select with no value yet lights its blank option", () => {
  const f = [{ key: "from", label: "From", type: "select", options: [["", "None"], ["a", "A"]] }];
  assert.ok(formHtml(f, {}, "g_").includes('<option value="" selected>None</option>'));
  assert.ok(formHtml(f, { from: "a" }, "g_").includes('<option value="a" selected>A</option>'));
});

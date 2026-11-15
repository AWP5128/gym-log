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

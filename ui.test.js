import test from "node:test";
import assert from "node:assert/strict";
import {
  esc, optionsHtml, selectHtml, field, numField, cols, box, muted, ghostBtn, backBtn,
} from "./ui.js";

test("esc makes text safe for a page and copes with empty values", () => {
  assert.equal(esc('<b>"A" & B</b>'), "&lt;b&gt;&quot;A&quot; &amp; B&lt;/b&gt;");
  assert.equal(esc(null), "");
  assert.equal(esc(undefined), "");
  assert.equal(esc(5), "5");
});

test("optionsHtml marks the chosen value and uses the label format", () => {
  assert.equal(
    optionsHtml([10, 20], 20, (w) => w + " lb"),
    '<option value="10">10 lb</option><option value="20" selected>20 lb</option>'
  );
  assert.equal(optionsHtml([1], null), '<option value="1">1</option>');
  assert.equal(optionsHtml([], 1), "");
});

test("selectHtml and field build a labelled select", () => {
  assert.equal(selectHtml("a", "<option></option>"), '<select id="a"><option></option></select>');
  assert.equal(selectHtml("a", "", "field"), '<select class="field" id="a"></select>');
  assert.equal(field("a", "Name", "<x>"), '<label for="a">Name</label><x>');
});

test("numField shows a number, or nothing for null and undefined", () => {
  assert.ok(numField("f", "Reps", 5, "default 5").includes('value="5" placeholder="default 5"'));
  assert.ok(numField("f", "Reps", null).includes('value="" placeholder=""'));
  assert.ok(numField("f", "Reps", undefined).includes('value=""'));
  assert.ok(numField("f", "Reps", 0).includes('value="0"'));
});

test("layout helpers wrap their content", () => {
  assert.equal(cols("a", "b"), '<div class="two"><div>a</div><div>b</div></div>');
  assert.equal(box("T", "x"), '<div class="panel"><strong>T</strong>x</div>');
  assert.equal(muted("hi"), '<div class="muted">hi</div>');
  assert.equal(muted("hi", "small"), '<div class="muted small">hi</div>');
});

test("buttons carry their id, text and optional style", () => {
  assert.equal(ghostBtn("x", "Go"), '<button class="ghost" id="x">Go</button>');
  assert.equal(ghostBtn("x", "Go", "margin-top:0"), '<button class="ghost" id="x" style="margin-top:0">Go</button>');
  assert.equal(backBtn(), '<button class="ghost" id="back" style="margin-top:0">&larr; Back</button>');
  assert.equal(backBtn("Back without saving"), '<button class="ghost" id="back" style="margin-top:0">&larr; Back without saving</button>');
});
import test from "node:test";
import assert from "node:assert/strict";

// A tiny pretend page, enough for addItems, addChoices and the cards.
const els = {};
const make = () => ({ children: [], className: "", innerHTML: "", textContent: "", onclick: null, append(...c) { this.children.push(...c); } });
globalThis.document = { getElementById: (id) => (els[id] ??= make()), createElement: () => make() };
const { blocks } = await import("./ui.js");

test("items and chips give the holder html and are wired only by bind", () => {
  const b = blocks();
  const html = b.items("list", [["<b>A</b>", () => "a"], ["B", () => "b"]]) + b.chips("kinds", [["One", true, () => 1], ["Two", false, () => 2]], "choices sm fit", "margin-top:12px");
  assert.equal(html, '<div id="list"></div><div class="choices sm fit" id="kinds" style="margin-top:12px"></div>');
  assert.equal((els.list?.children ?? []).length, 0);   // nothing is wired before bind
  b.bind();
  assert.equal(els.list.children.length, 2);
  assert.equal(els.list.children[0].innerHTML, "<b>A</b>");
  assert.equal(els.list.children[1].onclick(), "b");
  assert.deepEqual(els.kinds.children.map((c) => [c.textContent, c.className]), [["One", "active"], ["Two", ""]]);
  b.bind();   // a second bind does nothing
  assert.equal(els.list.children.length, 2);
});

test("a plain holder has no style attribute and the default class", () => {
  assert.equal(blocks().chips("c", []), '<div class="choices" id="c"></div>');
});

test("cards show an escaped title, the small line as html and numbered chip buttons that call their actions", () => {
  const b = blocks();
  const html = b.cards("eq", [
    { title: "A <b>", sub: "lb &middot; stack saved", actions: [["Edit", () => "edit0"], ["Hide", () => "hide0"]] },
    { title: "B", sub: "kg", actions: [["Restore", () => "rest1"]] },
  ]);
  assert.ok(html.includes("A &lt;b&gt;") && html.includes("lb &middot; stack saved"));
  assert.ok(html.includes('id="eq_0_0">Edit</button> <button class="chip" id="eq_0_1">Hide</button>'));
  assert.ok(html.includes('id="eq_1_0">Restore</button>'));
  b.bind();
  assert.equal(els.eq_0_1.onclick(), "hide0");
  assert.equal(els.eq_1_0.onclick(), "rest1");
});

test("each screen has its own kit, so one screen cannot wire another's blocks", () => {
  const a = blocks(), b = blocks();
  a.items("only_a", [["x", () => 1]]);
  b.bind();
  assert.equal(els.only_a, undefined);
});

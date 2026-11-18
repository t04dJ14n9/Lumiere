import test from "node:test";
import assert from "node:assert/strict";
import {
  parseHostFrame,
  parsePageFrame,
  safeExternalHref,
} from "../../src/protocol";

function uiFrame(data: unknown): string {
  return JSON.stringify({ ch: "ui", data });
}

function nestedGroups(depth: number): unknown {
  let groups: unknown = [[{ label: "Leaf" }]];
  for (let index = 0; index < depth; index++) {
    groups = [[{ label: `Level ${index}`, submenu: groups }]];
  }
  return groups;
}

test("external links keep http, https and mailto, and drop schemes that run code or read files", () => {
  assert.equal(
    safeExternalHref("https://example.com/a b"),
    "https://example.com/a%20b",
  );
  assert.equal(safeExternalHref("mailto:a@b.c"), "mailto:a@b.c");
  assert.equal(safeExternalHref("vscode://file/x"), "vscode://file/x");
  for (const href of [
    "javascript:alert(1)",
    "data:text/html,hi",
    "file:///etc/passwd",
    "command:workbench.action.files.openFile",
    "not a url",
  ]) {
    assert.equal(safeExternalHref(href), undefined, href);
  }
});

test("a host frame is rpc or a well-formed ui request, and anything else is ignored", () => {
  assert.deepEqual(parseHostFrame('{"ch":"rpc","data":{"n":1}}'), {
    ch: "rpc",
    data: { n: 1 },
  });
  assert.deepEqual(
    parseHostFrame(
      '{"ch":"ui","data":{"type":"toast","kind":"info","message":"hi"}}',
    ),
    { ch: "ui", data: { type: "toast", kind: "info", message: "hi" } },
  );
  assert.deepEqual(
    parseHostFrame(
      '{"ch":"ui","data":{"type":"open","path":"a.md","fragment":""}}',
    ),
    { ch: "ui", data: { type: "open", path: "a.md", fragment: "" } },
  );
  for (const text of [
    "{",
    "null",
    "[]",
    '{"ch":"ui"}',
    '{"ch":"nope","data":{}}',
    '{"ch":"ui","data":{"type":"toast"}}',
    '{"ch":"ui","data":{"type":"menu","id":1}}',
    '{"ch":"ui","data":{"type":"nope"}}',
  ]) {
    assert.equal(parseHostFrame(text), undefined, text);
  }
});

test("inherited object-prototype names as ui request types are dropped", () => {
  for (const type of [
    "constructor",
    "toString",
    "toLocaleString",
    "valueOf",
    "hasOwnProperty",
    "isPrototypeOf",
    "propertyIsEnumerable",
    "__proto__",
    "__defineGetter__",
    "__defineSetter__",
    "__lookupGetter__",
    "__lookupSetter__",
  ]) {
    const text = JSON.stringify({ ch: "ui", data: { type } });
    assert.equal(parseHostFrame(text), undefined, type);
  }
});

test("every well-formed host-to-page request keeps its fields", () => {
  const actions = Array.from({ length: 256 }, (_, index) => `A${index}`);
  const items = [{ label: "a", description: "d", detail: "e" }];
  const groups = nestedGroups(4);
  const cases: Array<[string, unknown]> = [
    ["toast", { type: "toast", kind: "info", message: "hi" }],
    ["clipboard", { type: "clipboard", text: "x".repeat(4_000_001) }],
    ["ask", { type: "ask", id: 1, message: "m", actions }],
    ["pick", { type: "pick", id: 1, placeholder: "p", items }],
    ["pickItems", { type: "pickItems", id: 1, items }],
    ["pickMany", { type: "pickMany", id: 1, placeholder: "p", items }],
    ["input", { type: "input", id: 1, prompt: "p", value: "v", error: "e" }],
    ["menu", { type: "menu", id: 1, x: 1, y: 2, groups }],
    ["open", { type: "open", path: "a.md", fragment: "" }],
    ["external", { type: "external", href: "https://example.com" }],
  ];
  for (const [name, data] of cases) {
    assert.deepEqual(parseHostFrame(uiFrame(data)), { ch: "ui", data }, name);
  }
});

test("unbounded host-to-page fields are dropped", () => {
  const long = "x".repeat(64 * 1024 + 1);
  const many = Array.from({ length: 257 }, () => "Yes");
  const rows = Array.from({ length: 257 }, () => ({ label: "a" }));
  const ask = (actions: unknown) =>
    uiFrame({ type: "ask", id: 1, message: "m", actions });
  const pick = (items: unknown) =>
    uiFrame({ type: "pick", id: 1, placeholder: "p", items });
  const pickMany = (items: unknown) =>
    uiFrame({ type: "pickMany", id: 1, placeholder: "p", items });
  const menu = (groups: unknown) =>
    uiFrame({ type: "menu", id: 1, x: 0, y: 0, groups });
  const rejects: Array<[string, string]> = [
    ["clipboard text", uiFrame({ type: "clipboard", text: 42 })],
    ["ask actions", ask(many)],
    ["ask action", ask([long])],
    ["pick description", pick([{ label: "a", description: long }])],
    ["pick detail", pick([{ label: "a", detail: long }])],
    ["pick rows", pick(rows)],
    ["pickMany detail", pickMany([{ label: "a", detail: long }])],
    ["pickMany rows", pickMany(rows)],
    ["menu label", menu([[{ label: long }]])],
    ["menu depth", menu(nestedGroups(100))],
  ];
  for (const [name, text] of rejects) {
    assert.equal(parseHostFrame(text), undefined, name);
  }
});

test("a page's answer is text, a row, a list of rows or nothing", () => {
  const answer = (value: unknown) =>
    parsePageFrame(
      JSON.stringify({ ch: "ui", data: { type: "answer", id: 7, value } }),
    );
  for (const value of ["Download", 0, 3, null, [], [0, 2, 5]]) {
    assert.deepEqual(
      answer(value),
      { ch: "ui", data: { type: "answer", id: 7, value } },
      JSON.stringify(value),
    );
  }
  const tooMany = Array.from({ length: 257 }, (_, index) => index);
  for (const value of [[-1], [1.5], ["1"], [null], [[1]], tooMany, {}, true]) {
    assert.equal(answer(value), undefined, JSON.stringify(value));
  }
});

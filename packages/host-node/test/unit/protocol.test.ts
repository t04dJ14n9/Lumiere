import test from "node:test";
import assert from "node:assert/strict";
import { parseHostFrame, safeExternalHref } from "../../src/protocol";

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

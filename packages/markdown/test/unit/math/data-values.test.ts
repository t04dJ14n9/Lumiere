import test from "node:test";
import assert from "node:assert/strict";
import { createRenderer } from "../../../src/markdown/html";
import {
  decodeDataValue,
  encodeDataValue,
} from "../../../src/markdown/html/helpers";
import {
  primeMathJaxForTest,
  mathWebview,
} from "../../../src/plugins/math/webview";
import type { RenderPass } from "../../../src/plugins/render/api";
import { fixture } from "../features/fixture";

const { renderMarkdown } = createRenderer();

// A lone surrogate is not valid UTF-16, but an editor can hold one (half of
// a pasted emoji, say); encodeURIComponent throws on it.
test("math and fences with a lone surrogate still render", () => {
  for (const source of ["$a\uD800b$", "$$\n\uDC00\n$$", "```js\n\uD800\n```"]) {
    let html = "";
    assert.doesNotThrow(() => {
      html = renderMarkdown(source);
    }, JSON.stringify(source));
    assert.match(html, /data-(math|source)="[^"]*%EF%BF%BD/u);
  }
});

function mathNode(encoded: string) {
  return { dataset: { math: encoded, display: "false" }, textContent: "" };
}

// Raw HTML in a note keeps its data-* attributes through the sanitizer, so
// a malformed escape reaches the decoder; it must not stop the other blocks.
test("a malformed data-math value does not stop the pass's other math", async () => {
  const typeset: string[] = [];
  primeMathJaxForTest({
    ensureBrowser: async () => {},
    setUserMacros: () => {},
    typesetSync: (expression) => {
      typeset.push(expression);
      return undefined;
    },
    typeset: () => new Promise<string>(() => {}),
  });
  const f = fixture();
  try {
    f.root.plugin(mathWebview);
    await f.root.settled();
    const nodes = [mathNode("%E0%A4%A"), mathNode("x%5E2")];
    const pass = {
      source: "",
      container: { querySelectorAll: () => nodes },
      sourceLine: 0,
      ancestry: [],
      renderKey: "math",
      measure() {},
      async dispose() {},
      onDispose() {},
    } as unknown as RenderPass;
    await f.root.serial("render/postProcess", pass);
    assert.deepEqual(typeset, ["%E0%A4%A", "x^2"]);
  } finally {
    await f.root.dispose();
    primeMathJaxForTest(undefined);
  }
});

test("data values round-trip, and a malformed one reads as written", () => {
  for (const text of ["x^2 % 100", "😀 字", "a\nb"]) {
    assert.equal(decodeDataValue(encodeDataValue(text)), text);
  }
  assert.equal(decodeDataValue(encodeDataValue("a\uD800")), "a�");
  assert.equal(decodeDataValue("%E0%A4%A"), "%E0%A4%A");
});

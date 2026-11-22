import test, { mock } from "node:test";
import assert from "node:assert/strict";
import { createRenderer } from "../../../src/markdown/html";
import { rememberedIndexOf } from "../../../src/markdown/html/helpers";
const { renderMarkdown } = createRenderer();

/** How many times `run` searches some text for `needle`. */
function searchesFor(needle: string, run: () => void): number {
  const indexOf = mock.method(String.prototype, "indexOf");
  try {
    run();
  } finally {
    indexOf.mock.restore();
  }
  return indexOf.mock.calls.filter((call) => call.arguments[0] === needle)
    .length;
}

test("a run of [[ with no ]] after it is searched once, not once per bracket", () => {
  // The operation count, not a time: a search from every bracket reads the
  // rest of the text each time, which is quadratic and cheap enough per
  // character not to show against the render's linear cost below ~100k.
  assert.equal(
    searchesFor("]]", () => renderMarkdown("[[".repeat(500))),
    1,
  );
  assert.equal(
    searchesFor("]]", () => renderMarkdown("[[a\n".repeat(500))),
    1,
  );
});

test("a remembered search serves only the positions it covers", () => {
  const text = "ab]]cd]]ef";
  const closerFrom = rememberedIndexOf("]]");
  const state = { src: text };
  const froms = [0, 1, 2, 3, 4, 6, 8, 0];
  let answers: number[] = [];
  const searches = searchesFor("]]", () => {
    answers = froms.map((from) => closerFrom(state, from));
  });
  assert.deepEqual(
    answers,
    froms.map((from) => text.indexOf("]]", from)),
  );
  // Searched at 0 (which answers 0, 1 and 2), at 3 (3, 4 and 6), at 8, and
  // again at 0, which is before what is remembered.
  assert.equal(searches, 4);
});

test("a remembered search is not shared with another text", () => {
  const closerFrom = rememberedIndexOf("]]");
  assert.equal(closerFrom({ src: "a]]" }, 0), 1);
  assert.equal(closerFrom({ src: "abc" }, 0), -1);
});

test("wiki links render as before around brackets and newlines", () => {
  const link = (target: string) =>
    `<a class="internal-link" data-wiki="true" data-href="${target}" href="${target}">${target}</a>`;
  assert.equal(renderMarkdown("[[a]]"), `<p>${link("a")}</p>\n`);
  // A closer on a later line does not make a link, but a pair that fits on
  // one line after the newline does.
  assert.equal(
    renderMarkdown("[[a\nb]] [[c]]", { strictLineBreaks: true }),
    `<p>[[a\nb]] ${link("c")}</p>\n`,
  );
  assert.equal(
    renderMarkdown("[[x [[y]] [[z]]"),
    `<p>${link("x [[y")} ${link("z")}</p>\n`,
  );
  assert.equal(
    renderMarkdown("[[open [[and no closer"),
    "<p>[[open [[and no closer</p>\n",
  );
});

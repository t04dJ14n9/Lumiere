import assert from "node:assert/strict";
import { test } from "node:test";
import {
  encodeTextFragment,
  decodeTextFragment,
  formatPdfDeepLink,
  parsePdfDeepLinkFragment,
} from "../../src/shared/text-fragment";

test("encodeTextFragment percent-encodes Chrome reserved characters", () => {
  assert.equal(encodeTextFragment("a-b,c&d"), ":~:text=a%2Db%2Cc%26d");
});

test("formatPdfDeepLink with text uses page then text fragment", () => {
  assert.equal(
    formatPdfDeepLink("papers/a.pdf", { page: 3, text: "hello" }),
    "papers/a.pdf#page=3#:~:text=hello",
  );
});

test("formatPdfDeepLink without text is page only", () => {
  assert.equal(
    formatPdfDeepLink("papers/a.pdf", { page: 3 }),
    "papers/a.pdf#page=3",
  );
});

test("formatPdfDeepLink never emits hl-/selection=/search=", () => {
  const href = formatPdfDeepLink("p.pdf", { page: 1, text: "x" });
  assert.doesNotMatch(href, /#hl-|selection=|search=/u);
});

test("parsePdfDeepLinkFragment reads page and text across double hash", () => {
  const parsed = parsePdfDeepLinkFragment("page=2#:~:text=Scaled%20dot");
  assert.deepEqual(parsed, {
    page: 2,
    textFragment: { textStart: "Scaled dot" },
  });
});

test("decodeTextFragment rejects empty text", () => {
  assert.equal(decodeTextFragment(":~:text="), undefined);
});

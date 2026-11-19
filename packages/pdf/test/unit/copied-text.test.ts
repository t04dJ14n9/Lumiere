import assert from "node:assert/strict";
import { test } from "node:test";
import { copiedText } from "../../src/shared/selection";

test("Cmd/Ctrl+C keeps the selection's lines and paragraphs", () => {
  // PDFium separates lines with \r\n; a blank line ends a paragraph.
  assert.equal(
    copiedText("Scaled dot-product \r\nattention.\r\n\r\nWe compute  \r\nit."),
    "Scaled dot-product\nattention.\n\nWe compute\nit.",
  );
  assert.equal(copiedText("  one line \n"), "one line");
  assert.equal(copiedText(" \r\n\t"), "");
});

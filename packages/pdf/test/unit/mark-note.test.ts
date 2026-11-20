import assert from "node:assert/strict";
import test from "node:test";
import {
  isNoteLink,
  renderNote,
  showsNoteBadge,
} from "../../src/shared/mark-note";

test("a note renders as Markdown", () => {
  const html = renderNote("**Key** point:\n\n- one\n- `two`")!;
  assert.match(html, /<strong>Key<\/strong> point:/u);
  assert.match(html, /<li>one<\/li>/u);
  assert.match(html, /<code>two<\/code>/u);
});

test("a single line break in a note is kept, as typed", () => {
  assert.match(renderNote("first\nsecond")!, /first<br>\s*second/u);
});

test("an empty or blank note has nothing to show", () => {
  assert.equal(renderNote(""), undefined);
  assert.equal(renderNote(" \n\t"), undefined);
});

// The note comes from the annotation file or from the PDF itself, which
// anyone may have written: it must never run or load anything.
test("HTML in a note stays text", () => {
  const html = renderNote('<img src=x onerror="alert(1)"><script>x</script>')!;
  assert.doesNotMatch(html, /<img|<script/u);
  assert.match(html, /&lt;img/u);
});

test("an image in a note is not loaded", () => {
  const html = renderNote("![tracker](https://example.com/t.png)")!;
  assert.doesNotMatch(html, /<img/u);
});

test("only web and mail links become links", () => {
  const html = renderNote(
    "[web](https://example.com/a) [mail](mailto:a@example.com) [js](javascript:alert(1)) [file](file:///etc/passwd) [cmd](command:workbench.action.quit) [rel](notes.md)",
  )!;
  assert.match(html, /<a href="https:\/\/example.com\/a"[^>]*>web<\/a>/u);
  assert.match(html, /<a href="mailto:a@example.com"[^>]*>mail<\/a>/u);
  assert.doesNotMatch(html, /href="(?:javascript|file|command):/u);
  assert.doesNotMatch(html, /href="notes.md"/u);
});

test("a bare web address becomes a link", () => {
  assert.match(
    renderNote("see https://example.com/x")!,
    /<a href="https:\/\/example.com\/x"/u,
  );
});

test("isNoteLink accepts web and mail links only", () => {
  assert.ok(isNoteLink("https://example.com"));
  assert.ok(isNoteLink("HTTP://example.com/a?b#c"));
  assert.ok(isNoteLink("mailto:a@example.com"));
  for (const bad of [
    "javascript:alert(1)",
    "file:///etc/passwd",
    "command:workbench.action.quit",
    "vscode://file/x",
    "notes.md",
    "//example.com",
    "",
    42,
    undefined,
    `https://example.com/${"a".repeat(4096)}`,
  ]) {
    assert.equal(isNoteLink(bad), false, String(bad).slice(0, 40));
  }
});

test("a text mark with a note shows the note icon; others draw their own or have none", () => {
  for (const subtype of ["highlight", "underline", "strikeout", "squiggly"]) {
    assert.equal(
      showsNoteBadge({ subtype, contents: "a note" }),
      true,
      subtype,
    );
  }
  assert.equal(
    showsNoteBadge({ subtype: "highlight", contents: " \n" }),
    false,
  );
  assert.equal(showsNoteBadge({ subtype: "highlight" }), false);
  // A sticky note (text) already draws its icon; a link's text is not a note.
  assert.equal(showsNoteBadge({ subtype: "text", contents: "a note" }), false);
  assert.equal(showsNoteBadge({ subtype: "link", contents: "a note" }), false);
});

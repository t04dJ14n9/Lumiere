import test from "node:test";
import assert from "node:assert/strict";
import { canPreview, isPreviewHover } from "./controller";
test("page previews load only internal targets and fragments", () => {
  for (const href of ["Note", "../Folder/Note.md#Heading", "#^block"]) {
    assert.equal(canPreview(href), true);
  }
  for (const href of [
    "",
    "https://example.com",
    "//example.com",
    "data:text/html,x",
    "vscode://extension/path",
  ]) {
    assert.equal(canPreview(href), false);
  }
});

test("hover previews need Mod on every editor surface, as Obsidian's editor source", () => {
  assert.equal(isPreviewHover({ metaKey: false, ctrlKey: false }), false);
  assert.equal(isPreviewHover({ metaKey: true, ctrlKey: false }), true);
  assert.equal(isPreviewHover({ metaKey: false, ctrlKey: true }), true);
});

test("note previews retain source offsets and disable embedded task edits", async () => {
  const { notePreview } = await import("./content");
  const source = "# First\nA\n\n# Second\n- [ ] task\n";
  const preview = notePreview(source, "Note#Second", "file:///vault/Note.md");
  assert.equal(preview.context.sourceLine, 3);
  assert.equal(preview.context.documentText, source);
  assert.equal(preview.context.documentUri, "file:///vault/Note.md");
  assert.equal(preview.context.taskLineCount, 0);
  assert.deepEqual(preview.context.ancestry, ["file:///vault/Note.md#Second"]);
  assert.match(preview.text, /# Second\n- \[ \] task/);
  assert.throws(
    () => notePreview(source, "Note#missing", "Note"),
    /Section not found/,
  );
});

test("a preview of a long note renders a bounded beginning, never cut inside a code block", async () => {
  const { notePreview, PREVIEW_LIMIT } = await import("./content");
  const paragraph = "Some prose that goes on for a while. ".repeat(10) + "\n\n";
  const fence = "```js\n" + "let x = 1;\n".repeat(400) + "```\n\n";
  const long = paragraph.repeat(30) + fence + paragraph.repeat(400);
  const preview = notePreview(long, "Note", "file:///vault/Note.md");
  assert.ok(
    preview.text.length <= PREVIEW_LIMIT + 10,
    `${preview.text.length}`,
  );
  assert.ok(preview.text.endsWith("\n\n…"));
  assert.ok(long.startsWith(preview.text.slice(0, -3)));
  // The cut fell inside the code block: it comes before the block instead.
  assert.ok(!preview.text.includes("```"));
  // A heading's section is bounded the same way; a short one is whole.
  const section = notePreview(`# Big\n${long}`, "Note#Big", "Note");
  assert.ok(section.text.length <= PREVIEW_LIMIT + 10);
  const short = "# A\ntext\n";
  assert.equal(notePreview(short, "Note", "Note").text, short);
});

test("preview labels decode valid escapes and preserve malformed targets", async () => {
  const { previewLabel } = await import("./popup");
  assert.equal(previewLabel("My%20Note#Heading"), "My Note#Heading");
  assert.equal(previewLabel("%E0%A4%A"), "%E0%A4%A");
});

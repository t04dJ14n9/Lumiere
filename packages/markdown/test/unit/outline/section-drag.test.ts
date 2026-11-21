import test from "node:test";
import assert from "node:assert/strict";
import type { EditorPanel } from "../../../src/plugins/editor/api";
import { sectionMover } from "../../../src/plugins/outline/section-drag";
import {
  OutlineSource,
  type SectionDrop,
} from "../../../src/plugins/outline/tree";
import type { HostDocument, TextEdit } from "../../../src/shared/host";

const URI = "memory:///A.md";

function note(text: string) {
  const applied: TextEdit[][] = [];
  const informs: string[] = [];
  const document = {
    uri: URI,
    getText: () => text,
  } as HostDocument;
  const drops = sectionMover({
    editors: { all: () => [{ document } as EditorPanel] },
    hostDocuments: {
      apply: async (target, edits) => {
        assert.equal(target, document);
        applied.push([...edits]);
        return true;
      },
    },
    dialogs: { inform: (message) => void informs.push(message) },
  });
  return {
    applied,
    informs,
    drops,
    move: drops.move,
    edit: (value: string) => {
      text = value;
    },
  };
}

/**
 * The outline wired to the real mover, over a note that another writer can
 * replace: `refresh` is the outline rebuilding from the note's new text.
 */
function outline(text: string) {
  const fixture = note(text);
  const source = new OutlineSource(fixture.drops);
  source.set(URI, text);
  return {
    ...fixture,
    source,
    refresh: (value: string, uri = URI) => {
      fixture.edit(value);
      source.set(uri, value);
    },
  };
}

/** What the note becomes under the one edit that was applied to it. */
function afterEdit(text: string, applied: TextEdit[][]): string {
  assert.equal(applied.length, 1);
  assert.equal(applied[0]!.length, 1);
  const [edit] = applied[0]!;
  return text.slice(0, edit!.from) + edit!.insert + text.slice(edit!.to);
}

test("a dropped row moves its section in the note's document, as one edit", async () => {
  const text = "# A\na\n\n# B\nb\n";
  const { applied, move } = note(text);
  await move({ uri: URI, text, heading: 7, beforeHeading: 0 });
  assert.equal(applied.length, 1);
  const [edit] = applied[0]!;
  assert.equal(
    text.slice(0, edit!.from) + edit!.insert + text.slice(edit!.to),
    "# B\nb\n\n# A\na\n\n",
  );
});

test("a CRLF note's file offsets become the editor's line-feed offsets", async () => {
  const text = "# A\r\na\r\n\r\n# B\r\nb\r\n";
  const { applied, move } = note(text);
  await move({
    uri: URI,
    text,
    heading: text.indexOf("# B"),
    beforeHeading: 0,
  });
  const editorText = text.replaceAll("\r\n", "\n");
  const [edit] = applied[0]!;
  assert.equal(
    editorText.slice(0, edit!.from) + edit!.insert + editorText.slice(edit!.to),
    "# B\nb\n\n# A\na\n\n",
  );
});

test("a note edited since the rows were built is not moved", async () => {
  const text = "# A\na\n\n# B\nb\n";
  const { applied, informs, move, edit } = note(text);
  edit(`x${text}`);
  await move({ uri: URI, text, heading: 7, beforeHeading: 0 });
  assert.deepEqual(applied, []);
  assert.equal(informs.length, 1);
});

test("a drop that changes nothing, or on a closed note, applies no edit", async () => {
  const text = "# A\na\n\n# B\nb\n";
  const { applied, move } = note(text);
  await move({ uri: URI, text, heading: 0, beforeHeading: 7 });
  await move({ uri: "memory:///Other.md", text, heading: 7, beforeHeading: 0 });
  assert.deepEqual(applied, []);
});

test("the outline turns a row dropped on another into a move before that heading", async () => {
  const drops: SectionDrop[] = [];
  const source = new OutlineSource({
    move: async (drop) => {
      drops.push(drop);
    },
    refuseStale: () => {},
  });
  const text = "# A\n## A1\n# B\n";
  source.set(URI, text);
  const [a, b] = source.roots();
  const [a1] = source.children(a!);
  await source.drop(b!, a);
  await source.drop(a1!, undefined);
  await source.drop(a!, { id: "missing", label: "Gone" });
  assert.deepEqual(drops, [
    { uri: URI, text, heading: text.indexOf("# B"), beforeHeading: 0 },
    {
      uri: URI,
      text,
      heading: text.indexOf("## A1"),
      beforeHeading: undefined,
    },
  ]);
});

const BEFORE = "# A\na\n\n# B\nb\n";
const AFTER_PREPEND = "# X\nx\n\n# A\na\n\n# B\nb\n";

test("a row dropped after the outline refreshed to another text moves nothing", async () => {
  // B was grabbed as id "1"; X is prepended and the refresh makes "1" A.
  const { applied, informs, source, refresh } = outline(BEFORE);
  const [, b] = source.roots();
  refresh(AFTER_PREPEND);
  await source.drop(b!, undefined);
  assert.deepEqual(applied, []);
  assert.deepEqual(informs, [
    "The note changed while the heading was dragged. Try again.",
  ]);
});

test("a row dropped on a row from before the refresh moves nothing", async () => {
  const { applied, informs, source, refresh } = outline(BEFORE);
  const [a] = source.roots();
  refresh(AFTER_PREPEND);
  const b = source.roots()[2]!;
  await source.drop(b, a);
  assert.deepEqual(applied, []);
  assert.equal(informs.length, 1);
});

test("a row kept across a visit to another note moves nothing", async () => {
  const { applied, informs, source, refresh } = outline(BEFORE);
  const [, b] = source.roots();
  refresh("# Other\n", "memory:///Other.md");
  refresh(BEFORE);
  await source.drop(b!, undefined);
  assert.deepEqual(applied, []);
  assert.equal(informs.length, 1);
});

test("an equal-length edit above does not pass a duplicate heading off as the dragged one", async () => {
  // The second "# N" (offset 7, id "1") is dragged. Prepending seven
  // characters puts the first "# N" at offset 7 with id "1": by label and
  // offset alone the row would pass for it.
  const text = "# N\na\n\n# N\nb\n";
  const { applied, informs, source, refresh } = outline(text);
  const [, second] = source.roots();
  refresh(`# X\nx\n\n${text}`);
  await source.drop(second!, undefined);
  assert.deepEqual(applied, []);
  assert.equal(informs.length, 1);
});

test("a refresh that leaves the note as it was keeps a dragged row valid", async () => {
  const { applied, informs, source, refresh } = outline(BEFORE);
  const [a, b] = source.roots();
  refresh(BEFORE);
  await source.drop(b!, a);
  assert.equal(afterEdit(BEFORE, applied), "# B\nb\n\n# A\na\n\n");
  assert.deepEqual(informs, []);
});

test("a row dropped on another moves the right section in one edit", async () => {
  const { applied, informs, source } = outline(AFTER_PREPEND);
  const [, a, b] = source.roots();
  await source.drop(b!, a);
  assert.equal(
    afterEdit(AFTER_PREPEND, applied),
    "# X\nx\n\n# B\nb\n\n# A\na\n\n",
  );
  assert.deepEqual(informs, []);
});

test("the last section dropped below the last row stays where it is", async () => {
  const { applied, informs, source } = outline(BEFORE);
  const [, b] = source.roots();
  await source.drop(b!, undefined);
  assert.deepEqual(applied, []);
  assert.deepEqual(informs, []);
});

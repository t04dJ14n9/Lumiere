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
  const move = sectionMover({
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
    move,
    edit: (value: string) => {
      text = value;
    },
  };
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
  const source = new OutlineSource(async (drop) => {
    drops.push(drop);
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

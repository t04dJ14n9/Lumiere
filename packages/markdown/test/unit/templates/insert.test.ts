import assert from "node:assert/strict";
import test from "node:test";
import type { EditorPanel } from "../../../src/plugins/editor/api";
import type { TextEdit } from "../../../src/shared/host";
import { insertAtSelection } from "../../../src/plugins/templates/insert";
import { SourceCoordinates } from "../../../src/shared/document/coordinates";
import { fakeDocument } from "../../support/vscode-fake";

function panelWith(options: {
  text: string;
  eol?: "\n" | "\r\n";
  selection: { from: number; to: number; version: number };
  version?: number;
}) {
  const calls: { method: string; params: unknown }[] = [];
  const order: string[] = [];
  const panel = {
    document: fakeDocument({
      getText: () => options.text,
      eol: options.eol ?? "\n",
    }),
    session: {
      version: options.version ?? options.selection.version,
      flush: async () => {
        order.push("flush");
      },
      withAction: <T>(action: () => Promise<T>) => {
        order.push("action");
        return action();
      },
    },
    rpc: {
      call: async (_protocol: unknown, method: string, params: unknown) => {
        calls.push({ method, params });
        return method === "captureSelection"
          ? { ...options.selection, text: "" }
          : true;
      },
    },
  } as unknown as EditorPanel;
  return { panel, calls, order };
}

test("inserts at the caret after flushing, then reveals the end of the text", async () => {
  const { panel, calls, order } = panelWith({
    text: "ab",
    selection: { from: 1, to: 1, version: 4 },
  });
  const edits: TextEdit[][] = [];
  const isInserted = await insertAtSelection(
    { apply: async (_document, next) => (edits.push([...next]), true) },
    panel,
    "X\r\nY",
  );
  assert.equal(isInserted, true);
  assert.deepEqual(order, ["action", "flush"]);
  assert.deepEqual(edits, [[{ from: 1, to: 1, insert: "X\nY" }]]);
  assert.deepEqual(calls.at(-1), {
    method: "reveal",
    params: { from: 4, to: 4, focus: true, version: 4 },
  });
});

test("replaces the selected text in a CRLF note, where apply maps editor offsets onto the source", async () => {
  // Editor text "one\ntwo\nthree"; "two" is 4–7 there and 5–8 in the source.
  const text = "one\r\ntwo\r\nthree";
  const { panel } = panelWith({
    text,
    eol: "\r\n",
    selection: { from: 4, to: 7, version: 2 },
  });
  let result = text;
  await insertAtSelection(
    {
      // As the hosts do: edits arrive in editor offsets and land on the source.
      apply: async (_document, edits) => {
        const coordinates = new SourceCoordinates(result);
        for (const edit of [...edits].reverse()) {
          result =
            result.slice(0, coordinates.toSource(edit.from)) +
            edit.insert +
            result.slice(coordinates.toSource(edit.to));
        }
        return true;
      },
    },
    panel,
    "a\nb",
  );
  assert.equal(result, "one\r\na\r\nb\r\nthree");
});

test("a selection from an older version is refused without editing", async () => {
  const { panel } = panelWith({
    text: "ab",
    selection: { from: 0, to: 0, version: 1 },
    version: 2,
  });
  let isApplied = false;
  await assert.rejects(
    insertAtSelection(
      {
        apply: async () => {
          isApplied = true;
          return true;
        },
      },
      panel,
      "x",
    ),
    /changed while inserting/,
  );
  assert.equal(isApplied, false);
});

test("a refused edit reports false and does not move the caret", async () => {
  const { panel, calls } = panelWith({
    text: "ab",
    selection: { from: 0, to: 0, version: 1 },
  });
  assert.equal(
    await insertAtSelection({ apply: async () => false }, panel, "x"),
    false,
  );
  assert.ok(!calls.some((call) => call.method === "reveal"));
});

test("Insert Template merges properties into a CRLF note and inserts the body at the caret", async () => {
  const { insertTemplate } =
    await import("../../../src/plugins/templates/insert");
  const text = "---\r\nstatus: done\r\n---\r\nBody";
  // Editor offsets: "---\nstatus: done\n---\nBody" with the caret at the end.
  const { panel, calls } = panelWith({
    text,
    eol: "\r\n",
    selection: { from: 25, to: 25, version: 1 },
  });
  let result = text;
  const outcome = await insertTemplate(
    {
      apply: async (_document, edits) => {
        const coordinates = new SourceCoordinates(result);
        for (const edit of [...edits].reverse()) {
          result =
            result.slice(0, coordinates.toSource(edit.from)) +
            edit.insert +
            result.slice(coordinates.toSource(edit.to));
        }
        return true;
      },
    },
    panel,
    "---\nstatus: draft\ntags: [a]\n---\n\nNew",
  );
  assert.deepEqual(outcome, { isInserted: true, isMerged: true });
  assert.equal(
    result,
    "---\r\nstatus: done\r\ntags:\r\n  - a\r\n---\r\nBody\r\nNew",
  );
  const editorText = result.replace(/\r\n/g, "\n");
  assert.deepEqual(calls.at(-1), {
    method: "reveal",
    params: {
      from: editorText.length,
      to: editorText.length,
      focus: true,
      version: 1,
    },
  });
});

import test from "node:test";
import assert from "node:assert/strict";
import {
  rewriteCanvas,
  rewriteCanvasHeading,
} from "../../../src/plugins/linkUpdates/canvas";
import type { RewriteContext } from "../../../src/plugins/linkUpdates/rewrite";
import type { RenamedHeading } from "../../../src/plugins/linkUpdates/heading-rename";
import { memoryVaults } from "../views/fakes";

function context(
  paths: string[],
  renames: Record<string, string>,
): RewriteContext {
  const { index } = memoryVaults(
    Object.fromEntries(paths.map((path) => [path, ""])),
  );
  const map = new Map(Object.entries(renames));
  return {
    renames: map,
    resolve: (linkpath, source, syntax) =>
      index.resolveLink(linkpath, source, syntax)?.path,
    pathsAfter: paths.map((path) => map.get(path) ?? path),
    format: "shortest",
  };
}

const paths = ["Old.md", "pic.png", "boards/Board.canvas"];

test("a canvas keeps its indentation, key order and other nodes", () => {
  const text =
    '{\n  "nodes": [\n    {"id": "a", "type": "file", "file": "pic.png", "width": 400},\n    {"id": "b", "type": "link", "url": "https://x"}\n  ],\n  "edges": []\n}\n';
  const result = rewriteCanvas(
    text,
    "boards/Board.canvas",
    context(paths, { "pic.png": "assets/pic.png" }),
  );
  assert.equal(
    result,
    JSON.stringify(
      {
        nodes: [
          { id: "a", type: "file", file: "assets/pic.png", width: 400 },
          { id: "b", type: "link", url: "https://x" },
        ],
        edges: [],
      },
      null,
      "  ",
    ) + "\n",
  );
});

test("a canvas with nothing to change, or that is not a canvas, is left alone", () => {
  const ctx = context(paths, { "Old.md": "New.md" });
  assert.equal(
    rewriteCanvas(
      '{"nodes":[{"type":"text","text":"[[Other]]"}]}',
      "boards/Board.canvas",
      ctx,
    ),
    undefined,
  );
  assert.equal(
    rewriteCanvas("not json", "boards/Board.canvas", ctx),
    undefined,
  );
  assert.equal(rewriteCanvas("[]", "boards/Board.canvas", ctx), undefined);
});

test("text node links resolve from the canvas and keep their form", () => {
  const result = rewriteCanvas(
    '{"nodes":[{"type":"text","text":"# Title\\n![[Old#Part|alias]] [o](../Old.md)"}]}',
    "boards/Board.canvas",
    context(paths, { "Old.md": "Archive/Renamed.md" }),
  );
  assert.equal(
    result,
    '{"nodes":[{"type":"text","text":"# Title\\n![[Renamed#Part|alias]] [o](Renamed.md)"}]}',
  );
});

const renamedOld: RenamedHeading = {
  path: "Note.md",
  text: "# Old\n",
  heading: { from: 0, name: "Old", nameFrom: 2, nameTo: 5 },
  name: "New",
  subpath: "New",
};
const toNote = (linkpath: string) =>
  linkpath === "Note" ? "Note.md" : undefined;

test("a canvas's heading links and file-node subpaths follow a heading rename, with its form kept", () => {
  const board = `${JSON.stringify(
    {
      nodes: [
        { id: "1", type: "text", text: "see [[Note#Old]]" },
        { id: "2", type: "file", file: "Note.md", subpath: "#Old" },
      ],
    },
    null,
    2,
  )}\n`;
  const expected = `${JSON.stringify(
    {
      nodes: [
        { id: "1", type: "text", text: "see [[Note#New]]" },
        { id: "2", type: "file", file: "Note.md", subpath: "#New" },
      ],
    },
    null,
    2,
  )}\n`;
  assert.equal(
    rewriteCanvasHeading(board, "boards/Board.canvas", renamedOld, toNote),
    expected,
  );
});

test("a canvas with no link to the renamed heading, or another note's heading, is left alone", () => {
  const board = `${JSON.stringify(
    {
      nodes: [
        { id: "1", type: "text", text: "see [[Note#Other]]" },
        { id: "2", type: "file", file: "Other.md", subpath: "#Old" },
        { id: "3", type: "file", file: "Note.md", subpath: "#Old#Deep" },
      ],
    },
    null,
    2,
  )}\n`;
  assert.equal(
    rewriteCanvasHeading(board, "boards/Board.canvas", renamedOld, toNote),
    undefined,
  );
});

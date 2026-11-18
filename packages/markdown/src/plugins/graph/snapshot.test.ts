import test from "node:test";
import assert from "node:assert/strict";
import { metadata } from "../../markdown/metadata";
import { presentSnapshot } from "./snapshot";
import type { GraphNote } from "./project";
import type { GraphScope } from "./scope";

const scope: GraphScope = {
  id: "vault",
  name: "vault",
  vaultRoot: "file:///vault",
};

function note(path: string, body: string): GraphNote {
  return { path, metadata: metadata(body) };
}

test("a graph snapshot keeps untyped notes and refuses an oversized payload", () => {
  const description = "d".repeat(4000);
  const notes: GraphNote[] = [
    note("notes/metrics/topic.md", "---\ntype: metric\ntitle: Topic\n---\n"),
  ];
  for (let index = 0; index < 400; index += 1) {
    notes.push(
      note(`notes/n${index}.md`, `---\ndescription: ${description}\n---\n`),
    );
  }
  const snapshot = presentSnapshot({
    scope,
    notes,
    resolve: () => ({ status: "missing" }),
    completeness: "ready",
    generation: 1,
    mode: "global",
    depth: 2,
    colorBy: "type",
    filters: {
      types: [],
      tags: [],
      folders: [],
      text: "",
      showOrphans: true,
    },
    maxNodes: 2000,
    maxEdges: 20000,
  });
  assert.equal(snapshot.accepted, false);
  assert.equal(snapshot.nodes.length, 0);
  assert.match(snapshot.reason ?? "", /too large/);
  assert.ok(snapshot.facets.types.includes("metric"));
});

test("paths that cannot fit the protocol are left out of the drawing", () => {
  const snapshot = presentSnapshot({
    scope,
    notes: [
      note("notes/ok.md", "---\ntype: metric\n---\n"),
      note(`notes/${"p".repeat(1100)}.md`, "---\ntype: metric\n---\n"),
    ],
    resolve: () => ({ status: "missing" }),
    completeness: "indexing",
    generation: 2,
    mode: "global",
    depth: 2,
    colorBy: "type",
    filters: {
      types: [],
      tags: [],
      folders: [],
      text: "",
      showOrphans: true,
    },
    maxNodes: 2000,
    maxEdges: 20000,
  });
  assert.deepEqual(
    snapshot.nodes.map((node) => node.path),
    ["notes/ok.md"],
  );
  assert.equal(snapshot.completeness, "indexing");
});

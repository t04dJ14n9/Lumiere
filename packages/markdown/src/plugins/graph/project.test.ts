import test from "node:test";
import assert from "node:assert/strict";
import { metadata } from "../../markdown/metadata";
import { admit, isCurrentGeneration } from "./admission";
import {
  emptyFilters,
  filterGraph,
  folderMatches,
  localGraph,
} from "./filters";
import { buildNoteGraph } from "./project";
import type { GraphNote, ResolvedTarget } from "./project";

const files = new Set([
  "wiki/metrics/topic.md",
  "wiki/index.md",
  "wiki/notes/plain.md",
  "wiki/assets/figure.png",
]);

/** A leading `/` is the vault root, as in Obsidian. */
function resolve(linktext: string): ResolvedTarget {
  if (!linktext.startsWith("/")) {
    return { status: "missing" };
  }
  const path = linktext.slice(1);
  return files.has(path) ? { status: "file", path } : { status: "missing" };
}

function notes(): GraphNote[] {
  return [
    {
      path: "wiki/metrics/topic.md",
      metadata: metadata(
        "---\ntype: metric\ntitle: Topic\ndescription: A margin\ntags: [alpha]\n---\nSee [index](/wiki/index.md), [gone](/wiki/missing.md), [self](/wiki/metrics/topic.md) and [pic](/wiki/assets/figure.png).",
      ),
    },
    {
      path: "wiki/notes/plain.md",
      metadata: metadata(
        "See [topic](/wiki/metrics/topic.md) twice [again](/wiki/metrics/topic.md).",
      ),
    },
    {
      path: "wiki/notes/back.md",
      metadata: metadata(
        "---\ntype: note\n---\nSee [plain](/wiki/notes/plain.md).",
      ),
    },
    {
      path: "wiki/index.md",
      metadata: metadata("---\ntype: meta\n---\n"),
    },
    {
      path: "wiki/log.md",
      metadata: metadata("log"),
    },
    { path: "wiki/notes/alone.md" },
  ];
}

const graphOf = () =>
  buildNoteGraph({ notes: notes(), resolve: (linktext) => resolve(linktext) });

test("every note is a node, and link targets are classified", () => {
  const graph = graphOf();
  const paths = graph.nodes.map((node) => node.path);
  assert.ok(paths.includes("wiki/notes/plain.md"));
  assert.ok(paths.includes("wiki/index.md"));
  assert.ok(paths.includes("wiki/log.md"));
  const topic = graph.nodes.find(
    (node) => node.path === "wiki/metrics/topic.md",
  );
  assert.equal(topic?.title, "Topic");
  assert.equal(topic?.type, "metric");
  assert.equal(topic?.indexing, false);
  assert.equal(topic?.unresolved, 1);
  assert.equal(topic?.assets, 1);
  assert.equal(
    graph.edges.some(
      (edge) => edge.source === topic?.id && edge.target === topic?.id,
    ),
    false,
  );
  assert.ok(
    graph.edges.some(
      (edge) =>
        edge.source === "wiki/metrics/topic.md" &&
        edge.target === "wiki/index.md",
    ),
  );
  const toTopic = graph.edges.find(
    (edge) =>
      edge.source === "wiki/notes/plain.md" &&
      edge.target === "wiki/metrics/topic.md",
  );
  assert.equal(toTopic?.count, 2);
  assert.equal(topic?.degree, 2);
});

test("orphans are decided before filters, and an excluded focus is not retargeted", () => {
  const graph = graphOf();
  const alone = graph.nodes.find((node) => node.id === "wiki/notes/alone.md");
  assert.equal(alone?.orphan, true);
  assert.equal(alone?.indexing, true);
  const filtered = filterGraph(graph, {
    ...emptyFilters(),
    types: ["metric"],
  });
  assert.deepEqual(
    filtered.nodes.map((node) => node.id),
    ["wiki/metrics/topic.md"],
  );
  const local = localGraph(filtered, "wiki/notes/plain.md", 2);
  assert.equal(local.focusExcluded, true);
  assert.equal(local.graph.nodes.length, 0);
});

test("orphans show by default and the toggle hides them, as Obsidian's showOrphans", () => {
  const graph = graphOf();
  const ids = (showOrphans: boolean) =>
    filterGraph(graph, { ...emptyFilters(), showOrphans }).nodes.map(
      (node) => node.id,
    );
  assert.equal(emptyFilters().showOrphans, true);
  assert.ok(ids(true).includes("wiki/notes/alone.md"));
  assert.ok(!ids(false).includes("wiki/notes/alone.md"));
  assert.ok(ids(false).includes("wiki/metrics/topic.md"));
});

test("folder prefixes match path segments", () => {
  assert.equal(folderMatches("wiki/notes", "wiki"), true);
  assert.equal(folderMatches("wiki-old/notes", "wiki"), false);
});

test("admission refuses over-cap graphs and stale generations are ignored", () => {
  const nodes = Array.from({ length: 3 }, (_, index) => ({
    id: String(index),
  }));
  assert.equal(
    admit(nodes, [], { maxNodes: 2000, maxEdges: 20000 }).accepted,
    true,
  );
  const refused = admit(nodes, [], { maxNodes: 2, maxEdges: 20000 });
  assert.equal(refused.accepted, false);
  assert.equal(refused.nodeCount, 3);
  assert.equal(isCurrentGeneration(4, 4), false);
  assert.equal(isCurrentGeneration(4, 5), true);
});

test("frontmatter wikilinks count as note edges like Obsidian", () => {
  const graph = buildNoteGraph({
    notes: [
      {
        path: "notes/from.md",
        metadata: metadata('---\nup: "[[plain]]"\n---\nNo body link.'),
      },
      {
        path: "notes/plain.md",
        metadata: metadata("plain body"),
      },
    ],
    resolve: (linktext) =>
      linktext === "plain"
        ? { status: "file", path: "notes/plain.md" }
        : { status: "missing" },
  });
  const edge = graph.edges.find(
    (item) =>
      item.source === "notes/from.md" && item.target === "notes/plain.md",
  );
  assert.ok(edge);
  assert.equal(edge?.count, 1);
  const from = graph.nodes.find((node) => node.id === "notes/from.md");
  assert.equal(from?.degree, 1);
  assert.equal(from?.orphan, false);
});

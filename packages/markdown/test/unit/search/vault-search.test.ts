import test from "node:test";
import assert from "node:assert/strict";
import { SearchResultsTree } from "../../../src/plugins/search/results-tree";
import type { SearchEvaluator } from "../../../src/plugins/search/runner";
import { VaultSearch } from "../../../src/plugins/search/vault-search";
import { OPEN_RESULT_COMMAND } from "../../../src/plugins/search/view-ids";
import { MemoryVaultIndex } from "../../../src/plugins/vault/memory-index";
import type { Vault } from "../../../src/plugins/vault/api";
import type { TreeHandle } from "../../../src/shared/host";
import type { SearchDocument } from "../../../src/markdown/search/evaluate";
import { parseSearch } from "../../../src/markdown/search/query";
import { searchVerdict } from "../../../src/workers/search-worker";

const ROOT = "file:///vault";

function vaultOf(notes: Record<string, string>): Vault {
  const index = new MemoryVaultIndex({
    root: ROOT,
    folderNote: "",
    linkFormat: "shortest",
  });
  for (const path of Object.keys(notes)) {
    index.upsertFile({ path, uri: `${ROOT}/${path}`, mtime: 0, size: 1 });
  }
  return { index, settled: async () => {}, pathOf: () => undefined };
}

/** The search worker's answers, without the worker. */
function evaluator(query: string): SearchEvaluator {
  return {
    ready: Promise.resolve(),
    includesFiles: false,
    requiresText: true,
    requiresMetadata: false,
    stopped: false,
    matches: async (document: SearchDocument) =>
      searchVerdict(parseSearch(query), document),
    dispose: async () => {},
  };
}

function setUp(notes: Record<string, string>) {
  const vault = vaultOf(notes);
  const results = new SearchResultsTree();
  const messages: (string | undefined)[] = [];
  const shown: boolean[] = [];
  const tree = {
    refresh() {},
    setMessage: (message: string | undefined) => void messages.push(message),
  } as unknown as TreeHandle;
  let current: Vault | undefined = vault;
  const search = new VaultSearch({
    tree,
    results,
    vault: async () => current,
    read: async (uri) => notes[uri.slice(ROOT.length + 1)] ?? "",
    workers: {} as never,
    showsResults: (isShown) => void shown.push(isShown),
    evaluator,
  });
  return {
    search,
    results,
    messages,
    shown,
    notes,
    closeVault: () => {
      current = undefined;
    },
  };
}

test("a query lists each matching note with its match lines, opening at each", async () => {
  const { search, results, messages, shown } = setUp({
    "Projects/Plan.md": "# Plan\nmeeting on Monday\nnothing\nmeeting again",
    "Other.md": "no hits here",
    "Notes.md": "The meeting",
  });
  await search.search("meeting");
  const rows = results.roots();
  assert.deepEqual(
    rows.map((row) => [row.label, row.description, row.expanded]),
    [
      ["Notes", "1", true],
      ["Plan", "Projects · 2", true],
    ],
  );
  assert.deepEqual(rows[1]!.command, {
    id: OPEN_RESULT_COMMAND,
    args: [`${ROOT}/Projects/Plan.md`],
  });
  const lines = results.children(rows[1]!);
  assert.deepEqual(
    lines.map((line) => [line.label, line.command?.args]),
    [
      ["meeting on Monday", [`${ROOT}/Projects/Plan.md`, 7]],
      ["meeting again", [`${ROOT}/Projects/Plan.md`, 33]],
    ],
  );
  assert.deepEqual(messages, [
    "Searching for “meeting”…",
    "2 files match “meeting”.",
  ]);
  assert.deepEqual(shown, [true]);
  assert.equal(search.lastQuery, "meeting");
});

test("Obsidian's operators work as in query blocks, and no match says so", async () => {
  const { search, results, messages, shown } = setUp({
    "A.md": "alpha beta",
    "B.md": "alpha",
  });
  await search.search("alpha -beta");
  assert.deepEqual(
    results.roots().map((row) => row.label),
    ["B"],
  );
  await search.search("gamma");
  assert.equal(results.isEmpty, true);
  assert.equal(messages.at(-1), "No notes match “gamma”.");
  assert.deepEqual(shown, [true, false]);
});

test("a refresh runs the last query again over the notes as they are now", async () => {
  const { search, results, notes } = setUp({ "A.md": "one", "B.md": "two" });
  await search.refresh();
  assert.equal(results.isEmpty, true);
  await search.search("one");
  assert.deepEqual(
    results.roots().map((row) => row.label),
    ["A"],
  );
  notes["B.md"] = "one too";
  await search.refresh();
  assert.deepEqual(
    results.roots().map((row) => row.label),
    ["A", "B"],
  );
});

test("clearing empties the view and forgets the query", async () => {
  const { search, results, messages, shown } = setUp({ "A.md": "one" });
  await search.search("one");
  search.clear();
  assert.equal(results.isEmpty, true);
  assert.equal(messages.at(-1), undefined);
  assert.equal(shown.at(-1), false);
  assert.equal(search.lastQuery, "");
});

test("with no vault the view says what to open", async () => {
  const { search, messages, closeVault } = setUp({ "A.md": "one" });
  closeVault();
  await search.search("one");
  assert.equal(messages.at(-1), "Open a note or a folder to search its vault.");
});

test("a newer query wins over one still running", async () => {
  const { search, results } = setUp({ "A.md": "one", "B.md": "two" });
  const first = search.search("one");
  const second = search.search("two");
  await Promise.all([first, second]);
  assert.deepEqual(
    results.roots().map((row) => row.label),
    ["B"],
  );
});

import test from "node:test";
import assert from "node:assert/strict";
import { EditorState } from "@codemirror/state";
import { createRoot } from "@workshop/core";
import { markdownLanguageSupport } from "../../../src/markdown/dialect";
import { linkTrigger } from "../../../src/markdown/link-trigger";
import { linkSuggestion } from "../../../src/plugins/links/suggestions";
import {
  allowsSuggestions,
  completionEdit,
} from "../../../src/plugins/suggest/completion";
import { destinationFile } from "../../../src/plugins/suggest/destination";
import { suggestHost } from "../../../src/plugins/suggest/host";
import { protocol } from "../../../src/plugins/suggest/protocol";
import { SuggestionIndex } from "../../../src/plugins/suggest/sources";
import { provideHostServices } from "../../../src/shared/host";
import type { PanelShell } from "../../../src/shared/host";
import { fakeDocument, fakeHost } from "../../support/vscode-fake";
import { rpcPair } from "../../support/rpc-pair";
import { memoryVaults, uriOf } from "../views/fakes";

// The layout of a vault whose every project folder has the same four notes:
// the name of a note says little, and the folder names hold spaces.
const SOURCE = "wiki/projects/Project Alpha Notes/overview.md";
const OWN_PROGRESS = "wiki/projects/Project Alpha Notes/progress.md";
const OTHER_PROGRESS = "wiki/projects/Another Project/progress.md";
const notes: Record<string, string> = {
  [SOURCE]: "# Overview\n\n[progress](progress.md)\n",
  [OWN_PROGRESS]:
    "# Progress\n\n## Entries\n\n### First thing\n\n### Second (draft) thing\n",
  "wiki/projects/Project Alpha Notes/decisions.md": "# Decisions\n",
  "wiki/projects/Another Project/overview.md": "# Overview\n",
  [OTHER_PROGRESS]: "# Progress\n\n## Entries\n\n### Other thing\n",
  "wiki/resources/notes/Git Internals.md":
    "---\naliases: [Git]\n---\n# Git Internals\n\n## Objects\n\nA body ^obj\n\n[[Missing]]\n",
  "papers/paper.pdf": "",
};

function vault(extra: Record<string, string> = {}) {
  return memoryVaults({ ...notes, ...extra }).index;
}

/** What the editor asks the host for, and the host's answer, for a caret at the end of `before`. */
function suggest(
  before: string,
  options: { index?: ReturnType<typeof vault>; wikilinks?: boolean } = {},
) {
  const trigger = linkTrigger(before);
  assert.ok(trigger, before);
  const index = new SuggestionIndex(options.index ?? vault());
  return index.query(SOURCE, trigger, options.wikilinks ?? false);
}

const labels = (items: { label: string }[]) => items.map((item) => item.label);
const inserts = (items: { insert: string }[]) =>
  items.map((item) => item.insert);

test("a path names the file beside the note first, then the vault root's, as following the link does", () => {
  const index = vault({ "progress.md": "# Root\n", "Home.md": "# Home\n" });
  const find = (written: string, source = SOURCE) =>
    destinationFile(index, written, source)?.path;
  // Another note's progress.md, and the root's, are not the one beside it.
  assert.equal(find("progress.md"), OWN_PROGRESS);
  assert.equal(find("./progress.md"), OWN_PROGRESS);
  assert.equal(find("progress.md", "Home.md"), "progress.md");
  assert.equal(find("../Another Project/progress.md"), OTHER_PROGRESS);
  assert.equal(find("/progress.md"), "progress.md");
  assert.equal(
    find("/wiki/projects/Another Project/progress.md"),
    OTHER_PROGRESS,
  );
  // A path with folders is looked for from the vault root first.
  assert.equal(
    find("wiki/projects/Another Project/progress.md"),
    OTHER_PROGRESS,
  );
  assert.equal(find("Project Alpha Notes/progress.md"), OWN_PROGRESS);
  // Without the extension the vault resolves the name: an exact path from the
  // root first, else the nearest folder.
  assert.equal(find("progress"), "progress.md");
  assert.equal(
    destinationFile(vault(), "progress", SOURCE)?.path,
    OWN_PROGRESS,
  );
  assert.equal(find("nothing.md"), undefined);
  assert.equal(find("../../../../../nothing.md"), undefined);
});

test("[progress](progress.md#Entries offers that note's headings, not another progress.md's", () => {
  const items = suggest("[progress](progress.md#Entries");
  assert.deepEqual(items, [
    {
      label: "Entries",
      detail: `H2 · ${OWN_PROGRESS}`,
      insert: "Entries",
    },
  ]);
  assert.deepEqual(labels(suggest("[progress](progress.md#")), [
    "Progress",
    "Entries",
    "First thing",
    "Second (draft) thing",
  ]);
  // The other project's note is reached by its own path.
  assert.deepEqual(
    labels(suggest("[progress](../Another%20Project/progress.md#")),
    ["Progress", "Entries", "Other thing"],
  );
  assert.deepEqual(
    labels(
      suggest("[progress](/wiki/projects/Another%20Project/progress.md#Ot"),
    ),
    ["Other thing"],
  );
});

test("a heading is inserted in the encoding a converted [[Note#Heading]] gets", () => {
  const [item] = suggest("[x](progress.md#Second");
  assert.equal(item?.insert, "Second%20%28draft%29%20thing");
  // The same text a wikilink converted to a Markdown link carries.
  const [converted] = suggest("[[progress.md#Second", { wikilinks: false });
  assert.equal(
    converted?.insert,
    "[Second (draft) thing](progress.md#Second%20%28draft%29%20thing)",
  );
  // Typed encoded, it is read decoded.
  assert.deepEqual(labels(suggest("[x](progress.md#Second%20%28dr")), [
    "Second (draft) thing",
  ]);
});

test("typed inside a link's parentheses, only the destination is inserted, whatever Use Wikilinks says", () => {
  for (const wikilinks of [true, false]) {
    assert.deepEqual(
      inserts(suggest("[x](progress", { wikilinks }).slice(0, 2)),
      // Equal scores keep the vault's order, as in `[[`.
      ["../Another%20Project/progress.md", "progress.md"],
      String(wikilinks),
    );
    assert.deepEqual(
      inserts(suggest("[x](#Ov", { wikilinks })),
      ["Overview"],
      String(wikilinks),
    );
  }
  // The label stays what the list shows; nothing is a whole link.
  const [item] = suggest("[x](Git%20Int");
  assert.equal(item?.label, "Git Internals");
  assert.equal(item?.insert, "../../resources/notes/Git%20Internals.md");
  assert.equal(item?.replaceLink, undefined);
});

test("a path is written beside the note, up a folder, or from the vault root after a typed /", () => {
  assert.deepEqual(inserts(suggest("[x](Git%20Int")), [
    "../../resources/notes/Git%20Internals.md",
  ]);
  assert.deepEqual(inserts(suggest("[x](../../Git%20Int")), [
    "../../resources/notes/Git%20Internals.md",
  ]);
  assert.deepEqual(inserts(suggest("[x](/wiki/resources/Git")), [
    "/wiki/resources/notes/Git%20Internals.md",
  ]);
  // A root note of the same name makes a sibling's bare name read from the root.
  const rooted = vault({ "progress.md": "# Root\n" });
  assert.equal(
    suggest("[x](progress", { index: rooted }).find(
      (item) => item.detail === OWN_PROGRESS,
    )?.insert,
    "./progress.md",
  );
});

test("an alias and an unresolved link are offered as the note they name", () => {
  assert.deepEqual(labels(suggest("[x](Git").slice(0, 2)), [
    "Git",
    "Git Internals",
  ]);
  assert.equal(suggest("[x](Miss")[0]?.insert, "Missing.md");
});

test("blocks of the file, and of this note, are offered after #^", () => {
  assert.deepEqual(
    suggest("[x](../../resources/notes/Git%20Internals.md#^ob"),
    [
      {
        label: "obj",
        detail: "A body · wiki/resources/notes/Git Internals.md",
        insert: "obj",
      },
    ],
  );
  const own = vault({
    [SOURCE]: "# Overview\n\nBody ^mine\n",
  });
  assert.deepEqual(inserts(suggest("[x](#^", { index: own })), ["mine"]);
});

test("a PDF's bookmarks are offered after paper.pdf#, as the page", async () => {
  const trigger = linkTrigger("[x](../../../papers/paper.pdf#Meth")!;
  const index = new SuggestionIndex(vault(), undefined, async () => [
    { title: "Introduction", page: 1, depth: 0 },
    { title: "Methods", page: 5, depth: 1 },
  ]);
  await index.prepare(SOURCE, trigger);
  assert.deepEqual(inserts(index.query(SOURCE, trigger, false)), ["page=5"]);
});

test("nothing is offered for a file that is not there", () => {
  assert.deepEqual(suggest("[x](nothing.md#"), []);
  assert.deepEqual(suggest("[x](../../../../../nothing.md#"), []);
});

test("typing .md after a note's name still offers the note", () => {
  const index = vault();
  for (const before of ["[[progress.", "[[progress.m", "[[progress.md"]) {
    assert.deepEqual(
      inserts(suggest(before, { index, wikilinks: true }).slice(0, 2)),
      [
        "wiki/projects/Another Project/progress",
        "wiki/projects/Project Alpha Notes/progress",
      ],
      before,
    );
  }
  assert.deepEqual(inserts(suggest("[x](progress.md", { index }).slice(0, 2)), [
    "../Another%20Project/progress.md",
    "progress.md",
  ]);
});

test("only a query holding a . reaches a note's extension", () => {
  const index = vault({ "Alpha.md": "# A\n", "Beta.md": "# B\n" });
  const [alpha, beta] = [index.file("Alpha.md")!, index.file("Beta.md")!];
  const names = (query: string) =>
    new SuggestionIndex(index)
      .query("Beta.md", { kind: "link", query }, true)
      .map((item) => item.insert);
  assert.ok(names("Alpha.m").includes(alpha.basename));
  assert.ok(!names("Alpha.m").includes(beta.basename));
  // `md` is in no name or path here but every note's extension.
  assert.deepEqual(
    names("md").filter((name) => name === "Alpha" || name === "Beta"),
    [],
  );
});

test("accepting writes the destination and closes the link once", () => {
  const accept = (doc: string, caret = doc.length, close = true) => {
    const state = EditorState.create({ doc });
    const trigger = linkSuggestion({ state, pos: caret })!;
    const [item] = new SuggestionIndex(vault()).query(SOURCE, trigger, false);
    const next = state.update(
      completionEdit(state, { from: trigger.from, to: caret }, item!.insert, {
        close,
        closer: ")",
      }),
    ).state;
    return [next.doc.toString(), next.selection.main.head] as const;
  };
  // With no `)` after the caret one is added; the caret ends after it.
  assert.deepEqual(accept("[progress](progress.md#Ent"), [
    "[progress](progress.md#Entries)",
    "[progress](progress.md#Entries)".length,
  ]);
  // The `)` a closing-bracket extension typed is reused, not doubled.
  assert.deepEqual(accept("[progress](progress.md#Ent)", 26), [
    "[progress](progress.md#Entries)",
    "[progress](progress.md#Entries)".length,
  ]);
  assert.deepEqual(accept("see [x](Git%20Int) and more", 17), [
    "see [x](../../resources/notes/Git%20Internals.md) and more",
    "see [x](../../resources/notes/Git%20Internals.md)".length,
  ]);
  // A `]]` is not its closer.
  assert.equal(accept("[x](#Ov]]", 7)[0], "[x](#Overview)]]");
  // Tab takes the text and leaves the link open, keeping the `)` there.
  assert.deepEqual(accept("[x](#Ov)", 7, false), ["[x](#Overview)", 13]);
});

test("a destination in code or frontmatter opens nothing in the Lumiere editor", () => {
  for (const doc of [
    "`[x](Pro`",
    "```\n[x](Pro\n```",
    "---\nkey: '[x](Pro'\n---",
  ]) {
    const state = EditorState.create({
      doc,
      extensions: markdownLanguageSupport(),
    });
    const at = doc.indexOf("Pro") + 3;
    assert.equal(allowsSuggestions(state, at, "link"), false, doc);
  }
  const plain = EditorState.create({
    doc: "text [x](Pro",
    extensions: markdownLanguageSupport(),
  });
  assert.equal(allowsSuggestions(plain, 12, "link"), true);
});

test("the host answers from the note's own folder when asked through RPC, in a vault with spaces in its folders", async () => {
  const pair = rpcPair();
  const root = createRoot();
  root.provide("rpc", pair.host);
  root.provide("vault", vault());
  provideHostServices(
    root,
    fakeHost({
      settings: {
        forNote: () => ({
          preset: "obsidian",
          mode: "livePreview",
          features: { links: { enabled: true, config: {} } },
        }),
      },
    }),
  );
  root.plugin(suggestHost, {
    panel: { document: fakeDocument({ uri: uriOf(SOURCE) }) } as PanelShell,
  });
  await root.settled();
  const ask = (query: object) =>
    pair.client.call(protocol, "query", query as never);
  // The owner's wikilink and Markdown link.
  assert.deepEqual(
    labels(
      await ask({ kind: "heading", query: "Entries", note: "progress.md" }),
    ),
    ["Entries"],
  );
  assert.deepEqual(
    await ask({
      kind: "heading",
      query: "Entries",
      note: "progress.md",
      destination: "relative",
    }),
    [{ label: "Entries", detail: `H2 · ${OWN_PROGRESS}`, insert: "Entries" }],
  );
  assert.equal(
    (
      await ask({
        kind: "link",
        query: "progress.md",
        destination: "relative",
      })
    )[0]?.insert,
    "../Another%20Project/progress.md",
  );
  await root.dispose();
  await pair.dispose();
});

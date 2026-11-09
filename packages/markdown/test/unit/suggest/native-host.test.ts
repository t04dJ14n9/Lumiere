import test from "node:test";
import assert from "node:assert/strict";
import { createRoot } from "@workshop/core";
import { metadata } from "../../../src/markdown/metadata";
import { nativeSuggestHost } from "../../../src/plugins/suggest/native-host";
import { suggestions } from "../../../src/plugins/suggest/sources";
import { provideHostServices } from "../../../src/shared/host";
import type {
  NoteSettings,
  TextCompletionProvider,
} from "../../../src/shared/host";
import type { PdfOutlines } from "../../../src/shared/pdf-outlines";
import { CancelToken } from "../../../src/shared/rpc/lifecycle";
import { fakeHost } from "../../support/vscode-fake";
import { memoryVaults, uriOf } from "../views/fakes";

const notes = {
  "Home.md": "Links to [[Target Note]]",
  "Target Note.md":
    "---\naliases: [Goal]\n---\n# Target Note\n\n## Second Section\n\nBody ^kept\n\nNo id here\n",
  "Folder/Deep.md": "# Deep",
};
const home = uriOf("Home.md");

async function start(
  options: {
    registers?: boolean;
    extra?: Record<string, string>;
    outlines?: PdfOutlines;
  } = {},
) {
  const { vaults, index } = memoryVaults({ ...notes, ...options.extra });
  let provider: TextCompletionProvider | undefined;
  let note: NoteSettings = {
    preset: "obsidian",
    mode: "livePreview",
    features: { links: { enabled: true, config: {} } },
  };
  const root = createRoot();
  root.provide("vaults", vaults);
  if (options.outlines) {
    root.provide("pdfOutlines", options.outlines);
  }
  provideHostServices(
    root,
    fakeHost({
      hostDocuments:
        options.registers === false
          ? {}
          : {
              registerCompletions: (given) => {
                provider = given;
                return () => {
                  provider = undefined;
                };
              },
            },
      settings: { forNote: () => note },
    }),
  );
  root.plugin(nativeSuggestHost);
  await root.settled();
  return {
    root,
    index,
    registered: () => provider !== undefined,
    configure(settings: NoteSettings) {
      note = settings;
    },
    complete: (
      before: string,
      options: { uri?: string; token?: CancelToken } = {},
    ) =>
      provider!.complete(
        { uri: options.uri ?? home, before },
        options.token ?? new CancelToken(),
      ),
  };
}

test("[[ offers the notes the Lumiere editor offers, ranked and written the same way", async () => {
  const { root, index, complete } = await start();
  const before = "See [[Targ";
  const items = await complete(before);
  assert.deepEqual(items[0], {
    label: "Target Note",
    detail: "Target Note.md",
    insert: "Target Note]]",
    replaceFrom: 6,
    absorbs: "]]",
  });
  assert.deepEqual(
    items.map((item) => item.label),
    suggestions(index, "Home.md", { kind: "link", query: "Targ" }).map(
      (item) => item.label,
    ),
  );
  assert.deepEqual(
    (await complete("[[")).map((item) => item.insert.slice(0, -2)),
    suggestions(index, "Home.md", { kind: "link", query: "" }).map(
      (item) => item.insert,
    ),
  );
  await root.dispose();
});

test("a query can hold spaces and folders, and an alias is offered by its own name", async () => {
  const { root, complete } = await start();
  // Matched on its path, written as the vault writes links (shortest).
  assert.equal((await complete("[[Folder/De"))[0]?.insert, "Deep]]");
  assert.equal((await complete("[[Target N"))[0]?.insert, "Target Note]]");
  assert.equal((await complete("[[Go"))[0]?.insert, "Target Note|Goal]]");
  await root.dispose();
});

test("[[Note# offers its headings and [[Note#^ only the blocks that have an id", async () => {
  const { root, complete } = await start();
  const headings = await complete("[[Target Note#Sec");
  assert.deepEqual(headings, [
    {
      label: "Second Section",
      detail: "H2 · Target Note.md",
      insert: "Second Section]]",
      replaceFrom: 14,
      absorbs: "]]",
    },
  ]);
  // The paragraph without an id would need an id written into the note.
  const blocks = await complete("[[Target Note#^");
  assert.deepEqual(
    blocks.map((item) => item.insert),
    ["kept]]"],
  );
  assert.equal(blocks[0]?.replaceFrom, 15);
  await root.dispose();
});

test("an alias keeps the note offered, and accepting only finishes the link", async () => {
  const { root, complete } = await start();
  const before = "[[Target Note|the goal";
  const items = await complete(before);
  assert.equal(items[0]?.label, "Target Note");
  assert.equal(items[0]?.insert, "]]");
  assert.equal(items[0]?.replaceFrom, before.length);
  await root.dispose();
});

test("with Use Wikilinks off a Markdown link replaces the whole [[ token", async () => {
  const { root, configure, complete } = await start();
  configure({
    preset: "obsidian",
    mode: "livePreview",
    features: { links: { enabled: true, config: { useWikilinks: false } } },
  });
  const items = await complete("text [[Target Note#Sec");
  assert.deepEqual(items[0], {
    label: "Second Section",
    detail: "H2 · Target Note.md",
    insert: "[Second Section](Target%20Note.md#Second%20Section)",
    replaceFrom: 5,
    absorbs: "]]",
  });
  await root.dispose();
});

test("the list follows the index as notes change", async () => {
  const { root, index, complete } = await start();
  assert.deepEqual(
    (await complete("[[Target Note#")).map((item) => item.label),
    ["Target Note", "Second Section"],
  );
  index.setMetadata("Target Note.md", metadata("# Changed"));
  assert.deepEqual(
    (await complete("[[Target Note#")).map((item) => item.label),
    ["Changed"],
  );
  await root.dispose();
});

test("nothing is offered outside a link, outside a vault, or with the feature off", async () => {
  const { root, configure, complete } = await start();
  assert.deepEqual(await complete("Targ"), []);
  assert.deepEqual(await complete("[[Done]] Targ"), []);
  assert.deepEqual(
    await complete("[[Targ", { uri: "file:///elsewhere/Note.md" }),
    [],
  );
  const features = (links: { enabled: boolean }, suggest?: boolean) => ({
    links: { ...links, config: {} },
    ...(suggest === undefined
      ? {}
      : { suggest: { enabled: suggest, config: {} } }),
  });
  for (const settings of [
    { preset: "minimal", mode: "source" },
    {
      preset: "obsidian",
      mode: "source",
      features: features({ enabled: false }),
    },
    {
      preset: "obsidian",
      mode: "source",
      features: features({ enabled: true }, false),
    },
  ] as const) {
    configure(settings);
    assert.deepEqual(await complete("[[Targ"), [], JSON.stringify(settings));
  }
  await root.dispose();
});

test("a cancelled request answers nothing, and stopping withdraws the provider", async () => {
  const { root, registered, complete } = await start();
  assert.ok(registered());
  const token = new CancelToken();
  token.cancel();
  assert.deepEqual(await complete("[[Targ", { token }), []);
  assert.ok((await complete("[[Targ")).length);
  await root.dispose();
  assert.equal(registered(), false);
});

test("a host without a text editor of its own starts the plugin and registers nothing", async () => {
  const { root, registered } = await start({ registers: false });
  assert.equal(registered(), false);
  await root.dispose();
});

test("[[paper.pdf# offers the PDF's bookmarks where the host can read them", async () => {
  const asked: string[] = [];
  const { root, complete } = await start({
    extra: { "papers/paper.pdf": "" },
    outlines: {
      sections: async (uri) => {
        asked.push(uri);
        return [
          { title: "Introduction", page: 1, depth: 0 },
          { title: "Methods", page: 5, depth: 1 },
        ];
      },
    },
  });
  const items = await complete("[[paper.pdf#meth");
  assert.deepEqual(
    items.map((item) => item.insert),
    ["page=5|Methods]]"],
  );
  assert.deepEqual(asked, [uriOf("papers/paper.pdf")]);
  await root.dispose();
});

test("[[paper.pdf# offers nothing without pdfOutlines", async () => {
  const { root, complete } = await start({
    extra: { "papers/paper.pdf": "" },
  });
  assert.deepEqual(await complete("[[paper.pdf#"), []);
  await root.dispose();
});

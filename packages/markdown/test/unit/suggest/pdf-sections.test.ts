import test from "node:test";
import assert from "node:assert/strict";
import { EditorState } from "@codemirror/state";
import { createRoot } from "@workshop/core";
import { metadata } from "../../../src/markdown/metadata";
import { linkSuggestion } from "../../../src/plugins/links/suggestions";
import { protocol } from "../../../src/plugins/suggest/protocol";
import { SuggestionIndex } from "../../../src/plugins/suggest/sources";
import { suggestHost } from "../../../src/plugins/suggest/host";
import { MemoryVaultIndex } from "../../../src/plugins/vault/memory-index";
import type { VaultFile } from "../../../src/plugins/vault/api";
import { provideHostServices } from "../../../src/shared/host";
import type { PanelShell } from "../../../src/shared/host";
import type { PdfSection } from "../../../src/shared/pdf-outlines";
import { fakeDocument, fakeHost } from "../../support/vscode-fake";
import { rpcPair } from "../../support/rpc-pair";

const SECTIONS: readonly PdfSection[] = [
  { title: "Introduction", page: 1, depth: 0 },
  { title: "Methods", page: 5, depth: 0 },
  { title: "Data collection", page: 6, depth: 1 },
  { title: "Results [draft]", page: 9, depth: 0 },
];

function vaultWithPdf(): MemoryVaultIndex {
  const vault = new MemoryVaultIndex({
    root: "file:///vault",
    folderNote: "",
    linkFormat: "shortest",
  });
  for (const path of [
    "Home.md",
    "notes/Deep.md",
    "papers/paper.pdf",
    "papers/My Paper (v2).pdf",
  ]) {
    vault.upsertFile({
      path,
      uri: `file:///vault/${path.replaceAll(" ", "%20")}`,
      size: 0,
      mtime: 0,
    });
    if (path.endsWith(".md")) {
      vault.setMetadata(path, metadata("# Heading"));
    }
  }
  return vault;
}

/** A reader that records which PDFs it was asked for. */
function reader(sections: readonly PdfSection[] = SECTIONS) {
  const asked: string[] = [];
  return {
    asked,
    read: async (file: VaultFile) => {
      asked.push(file.path);
      return sections;
    },
  };
}

const request = (query: string, note = "paper.pdf") =>
  ({ kind: "heading" as const, query, note }) as const;

test("[[paper.pdf# asks for the PDF's headings like a note's", () => {
  const state = EditorState.create({ doc: "see [[paper.pdf#Meth" });
  assert.deepEqual(linkSuggestion({ state, pos: state.doc.length }), {
    kind: "heading",
    query: "Meth",
    note: "paper.pdf",
    from: 16,
    closeLink: true,
  });
});

test("a PDF offers its bookmarks in document order, as page and title", async () => {
  const pdf = reader();
  const index = new SuggestionIndex(vaultWithPdf(), undefined, pdf.read);
  await index.prepare("Home.md", request(""));
  assert.deepEqual(
    index
      .query("Home.md", request(""))
      .map((item) => [item.label, item.insert]),
    [
      ["Introduction", "page=1|Introduction"],
      ["Methods", "page=5|Methods"],
      ["Data collection", "page=6|Data collection"],
      ["Results [draft]", "page=9|Results draft"],
    ],
  );
  assert.deepEqual(pdf.asked, ["papers/paper.pdf"]);
  assert.equal(
    index.query("Home.md", request(""))[1]!.detail,
    "p.5 · papers/paper.pdf",
  );
});

test("typing after # filters the bookmarks with the headings' ranking", async () => {
  const index = new SuggestionIndex(vaultWithPdf(), undefined, reader().read);
  await index.prepare("Home.md", request("meth"));
  assert.deepEqual(
    index.query("Home.md", request("meth")).map((item) => item.label),
    ["Methods"],
  );
  // Fuzzy, as for headings: the letters in order, not next to each other.
  assert.deepEqual(
    index.query("Home.md", request("dcol")).map((item) => item.label),
    ["Data collection"],
  );
  assert.deepEqual(index.query("Home.md", request("zzz")), []);
});

test("with Use Wikilinks off a bookmark becomes a Markdown link to its page", async () => {
  const index = new SuggestionIndex(vaultWithPdf(), undefined, reader().read);
  await index.prepare("Home.md", request("meth"));
  const [methods] = index.query("Home.md", request("meth"), false);
  assert.equal(methods!.insert, "[Methods](papers/paper.pdf#page=5)");
  assert.equal(methods!.replaceLink, true);
  // The path is relative to the note and encoded as other Markdown links are.
  const spaced = request("draft", "My Paper (v2).pdf");
  await index.prepare("notes/Deep.md", spaced);
  assert.equal(
    index.query("notes/Deep.md", spaced, false)[0]!.insert,
    "[Results \\[draft\\]](../papers/My%20Paper%20%28v2%29.pdf#page=9)",
  );
});

test("only headings of a PDF are bookmarks, and only when a reader exists", async () => {
  const pdf = reader();
  const index = new SuggestionIndex(vaultWithPdf(), undefined, pdf.read);
  // Blocks, and the headings of a note, never ask the PDF reader.
  await index.prepare("Home.md", {
    kind: "block",
    query: "",
    note: "paper.pdf",
  });
  await index.prepare("Home.md", request("", "Deep"));
  assert.deepEqual(pdf.asked, []);
  assert.deepEqual(
    index.query("Home.md", request("", "Deep")).map((item) => item.insert),
    ["Heading"],
  );
  assert.deepEqual(
    index.query("Home.md", { kind: "block", query: "", note: "paper.pdf" }),
    [],
  );
  const without = new SuggestionIndex(vaultWithPdf());
  await without.prepare("Home.md", request(""));
  assert.deepEqual(without.query("Home.md", request("")), []);
});

test("a changed list read from the PDF replaces the bookmarks offered", async () => {
  let current: readonly PdfSection[] = SECTIONS;
  const index = new SuggestionIndex(
    vaultWithPdf(),
    undefined,
    async () => current,
  );
  await index.prepare("Home.md", request(""));
  assert.equal(index.query("Home.md", request("")).length, SECTIONS.length);
  current = [{ title: "Rewritten", page: 2, depth: 0 }];
  await index.prepare("Home.md", request(""));
  assert.deepEqual(
    index.query("Home.md", request("")).map((item) => item.insert),
    ["page=2|Rewritten"],
  );
});

test("the suggest host offers bookmarks when the root provides pdfOutlines", async () => {
  const pair = rpcPair();
  const root = createRoot();
  const asked: string[] = [];
  root.provide("rpc", pair.host);
  root.provide("vault", vaultWithPdf());
  root.provide("pdfOutlines", {
    sections: async (uri) => {
      asked.push(uri);
      return SECTIONS;
    },
  });
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
    panel: {
      document: fakeDocument({ uri: "file:///vault/Home.md" }),
    } as PanelShell,
  });
  await root.settled();
  const items = await pair.client.call(protocol, "query", {
    kind: "heading",
    query: "meth",
    note: "paper.pdf",
  });
  assert.deepEqual(
    items.map((item) => item.insert),
    ["page=5|Methods"],
  );
  assert.deepEqual(asked, ["file:///vault/papers/paper.pdf"]);
  await root.dispose();
  await pair.dispose();
});

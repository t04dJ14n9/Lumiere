import test from "node:test";
import { fakeHost } from "../../support/vscode-fake";
import assert from "node:assert/strict";
import {
  NoteResources,
  resourceKind,
} from "../../../src/plugins/resources/note-resources";
import type { VaultIndex } from "../../../src/plugins/vault/api";
import { MemoryVaultIndex } from "../../../src/plugins/vault/memory-index";
import type { LinkSyntax } from "../../../src/shared/vault-path";

test("NoteResources classifies and resolves .markdown notes alongside .md notes", async () => {
  assert.equal(resourceKind("Note.md"), "note");
  assert.equal(resourceKind("Note.markdown"), "note");
  assert.equal(resourceKind("Note.MARKDOWN"), "note");

  const root = "vscode-remote://host/vault";
  const vault = new MemoryVaultIndex({
    root,
    folderNote: "",
    linkFormat: "shortest",
  });
  vault.replaceFiles([
    {
      uri: `${root}/Source.md`,
      path: "Source.md",
      mtime: 1,
      size: 10,
    },
    {
      uri: `${root}/Target.markdown`,
      path: "Target.markdown",
      mtime: 1,
      size: 14,
    },
  ]);
  const resources = new NoteResources({
    source: `${root}/Source.md`,
    vault: {
      root: vault.root,
      files: () => vault.files(),
      file: (path) => vault.file(path),
      metadata: (path) => vault.metadata(path),
      resolveLink: (linktext, sourcePath, syntax) =>
        vault.resolveLink(linktext, sourcePath, syntax),
      resolveLinkCandidates: (linktext, sourcePath, syntax) =>
        vault.resolveLinkCandidates(linktext, sourcePath, syntax),
      linkText: (target, sourcePath) => vault.linkText(target, sourcePath),
      resolvedLinks: (sourcePath) => vault.resolvedLinks(sourcePath),
      unresolvedLinks: (sourcePath) => vault.unresolvedLinks(sourcePath),
      backlinks: (targetPath) => vault.backlinks(targetPath),
      tags: () => vault.tags(),
      onDidChange: (listener) => vault.onDidChange(listener),
      onDidResolve: (listener) => vault.onDidResolve(listener),
    } satisfies VaultIndex,
    host: fakeHost({
      workspace: {
        stat: async () => ({ mtime: 1, symbolicLink: false }),
        read: async () => new TextEncoder().encode("note"),
      },
    }),
    resourceUrl: (uri) => uri,
  });

  const byStem = await resources.load(
    "Target",
    `${root}/Source.md`,
    "wikilink",
  );
  assert.equal(byStem.kind, "note");
  assert.equal(byStem.source, `${root}/Target.markdown`);
  assert.equal(byStem.text, "note");

  const byFull = await resources.load(
    "Target.markdown",
    `${root}/Source.md`,
    "wikilink",
  );
  assert.equal(byFull.kind, "note");
  assert.equal(byFull.source, `${root}/Target.markdown`);
  assert.equal(byFull.text, "note");
});

test("a Markdown image whose path has spaces resolves, as its link is written encoded", async () => {
  const root = "file:///vault";
  const vault = new MemoryVaultIndex({
    root,
    folderNote: "",
    linkFormat: "shortest",
  });
  vault.replaceFiles(
    ["Notes/Plan.md", "Attachments/My image.png", "100% done.png"].map(
      (path) => ({
        uri: `${root}/${encodeURI(path)}`,
        path,
        mtime: 1,
        size: 1,
      }),
    ),
  );
  const resources = new NoteResources({
    source: `${root}/Notes/Plan.md`,
    vault,
    host: fakeHost({
      workspace: {
        stat: async () => ({ mtime: 1, symbolicLink: false }),
        read: async () => new Uint8Array(),
      },
    }),
    resourceUrl: (uri) => uri,
  });
  const load = (target: string, syntax: LinkSyntax) =>
    resources.load(target, `${root}/Notes/Plan.md`, syntax);

  assert.equal(
    (await load("../Attachments/My%20image.png", "markdown")).source,
    `${root}/Attachments/My%20image.png`,
  );
  assert.equal(
    (await load("100%25%20done.png", "markdown")).source,
    `${root}/100%25%20done.png`,
  );
  // A wikilink is never percent-encoded.
  await assert.rejects(load("My%20image.png", "wikilink"), /not found/);
  assert.equal(
    (await load("My image.png", "wikilink")).source,
    `${root}/Attachments/My%20image.png`,
  );
});

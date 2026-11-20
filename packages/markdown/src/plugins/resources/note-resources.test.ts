import test from "node:test";
import assert from "node:assert/strict";
import type { VaultIndex } from "../vault/api";
import type { LinkSyntax } from "../../shared/vault-path";
import { NoteResources, resourceKind } from "./note-resources";

test("resource kinds preserve note and PDF precedence and unknown-file fallback", () => {
  assert.equal(resourceKind("Note.MD"), "note");
  assert.equal(resourceKind("file.PDF"), "pdf");
  assert.equal(resourceKind("photo.png"), "image");
  assert.equal(resourceKind("sound.mp3"), "audio");
  assert.equal(resourceKind("clip.mp4"), "video");
  assert.equal(resourceKind("note.markdown"), "note");
  assert.equal(resourceKind("other.bin"), "file");
});

test("resource loading defaults to markdown syntax", async () => {
  const root = "vscode-remote://host/vault";
  const seen: Array<LinkSyntax | undefined> = [];
  const resources = new NoteResources({
    source: `${root}/notes/source.md`,
    vault: {
      root,
      resolveLink(_linktext: string, _source: string, syntax?: LinkSyntax) {
        seen.push(syntax);
        return {
          path: "notes/image.png",
          uri: `${root}/notes/image.png`,
          basename: "image",
          extension: "png",
          mtime: 1,
          size: 1,
        };
      },
    } as unknown as VaultIndex,
    host: {
      workspace: {
        async stat() {
          return { mtime: 1, symbolicLink: false };
        },
        async read() {
          return new Uint8Array();
        },
      },
      hostDocuments: {
        async open() {
          throw new Error("unused");
        },
      },
    } as never,
    resourceUrl: (uri) => uri,
  });
  await resources.load("image.png");
  assert.deepEqual(seen, ["markdown"]);
});

test("authorizeTarget contains PDFs without requiring a known source note", async () => {
  const root = "vscode-remote://host/vault";
  const resources = new NoteResources({
    source: `${root}/notes/source.md`,
    vault: {
      root,
      resolveLink() {
        return undefined;
      },
    } as unknown as VaultIndex,
    host: {
      workspace: {
        async stat() {
          return { mtime: 1, symbolicLink: false };
        },
        async read() {
          return new Uint8Array();
        },
      },
      hostDocuments: {
        async open() {
          throw new Error("unused");
        },
      },
    } as never,
    resourceUrl: (uri) => uri,
  });
  await assert.rejects(
    resources.authorize(`${root}/raw/paper.pdf`),
    /Unknown note source/,
  );
  await resources.authorizeTarget(`${root}/raw/paper.pdf`);
  await assert.rejects(
    resources.authorizeTarget("vscode-remote://host/outside/secret.pdf"),
    /Resource escapes the vault/,
  );
});

/** Resources over a vault whose index knows no file, and a disk that has `files`. */
function resourcesOnDisk(root: string, files: Record<string, string>) {
  const stats: string[] = [];
  const resources = new NoteResources({
    source: `${root}/wiki/notes/source.md`,
    vault: {
      root,
      resolveLink() {
        return undefined;
      },
    } as unknown as VaultIndex,
    host: {
      workspace: {
        async stat(uri: string) {
          stats.push(uri);
          // Containment also asks for each folder above a file.
          const isFolder = Object.keys(files).some((file) =>
            file.startsWith(`${uri}/`),
          );
          if (!(uri in files) && !isFolder) {
            throw new Error("FileNotFound");
          }
          return { mtime: 7, symbolicLink: false };
        },
      },
      hostDocuments: {
        async open(uri: string) {
          return { getText: () => files[uri]! };
        },
      },
    } as never,
    resourceUrl: (uri) => uri,
  });
  return { resources, stats };
}

// The index never enters hidden folders (`.raw`, `.git`), but a click on a
// Markdown link opens the file there; its preview and embed show it too.
test("a Markdown link into a hidden folder loads the file a click opens", async () => {
  const root = "file:///home/reader/vault";
  const page = `${root}/.raw/captured/page.md`;
  const { resources } = resourcesOnDisk(root, { [page]: "# Captured" });

  const rooted = await resources.load("/.raw/captured/page.md");
  assert.equal(rooted.kind, "note");
  assert.equal(rooted.source, page);
  assert.equal(rooted.text, "# Captured");

  const relative = await resources.load("../../.raw/captured/page.md#L26");
  assert.equal(relative.source, page);
});

test("a link the index does not know is looked for only where a click looks", async () => {
  const root = "file:///home/reader/vault";
  const { resources, stats } = resourcesOnDisk(root, {
    [`${root}/.raw/page.md`]: "x",
  });
  await assert.rejects(resources.load("/.raw/other.md"), /Resource not found/);
  // A wikilink resolves through the index only, as Obsidian's does.
  await assert.rejects(
    resources.load(".raw/page", undefined, "wikilink"),
    /Resource not found/,
  );
  // Above the vault root, or a folder: never asked of the disk.
  await assert.rejects(
    resources.load("../../../outside.md"),
    /Resource not found/,
  );
  await assert.rejects(resources.load("/.raw"), /Resource not found/);
  assert.deepEqual(stats, [`${root}/.raw/other.md`]);
});

test("a name with # or a space is found by its percent-encoded URI", async () => {
  const root = "file:///home/reader/vault";
  const page = `${root}/.raw/C%23%20notes.md`;
  const { resources } = resourcesOnDisk(root, { [page]: "x" });
  const loaded = await resources.load("/.raw/C%23%20notes.md");
  assert.equal(loaded.source, page);
});

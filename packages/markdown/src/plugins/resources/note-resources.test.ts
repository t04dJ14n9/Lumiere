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

test("an HTML file is a resource of its own kind, whatever its case or subpath", () => {
  assert.equal(resourceKind("diagram.html"), "html");
  assert.equal(resourceKind("folder/Page.HTM"), "html");
  assert.equal(resourceKind("report.Html"), "html");
  // Only the extension decides: no sniffing, and no other web file runs.
  assert.equal(resourceKind("diagram.html.txt"), "file");
  assert.equal(resourceKind("diagram.xhtml"), "file");
  assert.equal(resourceKind("script.js"), "file");
  assert.equal(resourceKind("style.css"), "file");
  assert.equal(resourceKind("image.svg"), "image");
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

interface DiskOptions {
  /** Vault paths the index lists; by default it knows no file. */
  indexed?: string[];
  /** URIs whose real path is outside the vault (a symbolic link). */
  escaping?: string[];
}

/** Resources over a vault whose index knows `indexed`, and a disk that has `files`. */
function resourcesOnDisk(
  root: string,
  files: Record<string, string | undefined>,
  { indexed = [], escaping }: DiskOptions = {},
) {
  const stats: string[] = [];
  // The index resolves a link with no path to the note it is in, when it
  // lists that note, and knows nothing else.
  const vault = {
    root,
    resolveLink(linktext: string, source: string) {
      return linktext.split("#")[0] === "" && indexed.includes(source)
        ? { path: source, uri: `${root}/${source}` }
        : undefined;
    },
  } as unknown as VaultIndex;
  const resources = new NoteResources({
    source: `${root}/wiki/notes/source.md`,
    vault,
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
        ...(escaping
          ? {
              async realContains(_root: string, uri: string) {
                return !escaping.includes(uri);
              },
            }
          : {}),
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

// The disk is asked in the order a click asks (`linkLocation`): the same
// existing file whether or not the click could make a note.
test("a bare Markdown link is looked for beside the note, then at the vault root", async () => {
  const root = "file:///home/reader/vault";
  const { resources, stats } = resourcesOnDisk(root, {
    [`${root}/wiki/notes/.twin.md`]: "beside",
    [`${root}/.twin.md`]: "root",
    [`${root}/.rootonly.md`]: "root only",
  });
  assert.equal((await resources.load(".twin.md")).text, "beside");
  assert.equal((await resources.load("./.twin.md")).text, "beside");
  assert.equal((await resources.load("/.twin.md")).text, "root");
  // No neighbour: the vault root's file of that name.
  assert.equal((await resources.load(".rootonly.md")).text, "root only");
  // `./` is only the note's folder, with no fallback.
  await assert.rejects(resources.load("./.rootonly.md"), /Resource not found/);

  stats.length = 0;
  await assert.rejects(resources.load(".nowhere.md"), /Resource not found/);
  assert.deepEqual(stats, [
    `${root}/wiki/notes/.nowhere.md`,
    `${root}/.nowhere.md`,
  ]);
});

// A hidden note loaded by its rooted path is a known source, and a link in it
// to its own heading (`#Part`) has no path for the index to find it by.
test("a fragment-only link in a hidden note loaded by its rooted path names that note", async () => {
  const root = "file:///home/reader/vault";
  const page = `${root}/.raw/captured/page.md`;
  const text = "## Part\n\n[jump](#Part)";
  const { resources } = resourcesOnDisk(root, { [page]: text });

  const loaded = await resources.load("/.raw/captured/page.md");
  assert.equal(loaded.source, page);
  for (const syntax of ["markdown", "wikilink"] as const) {
    const jumped = await resources.load("#Part", loaded.source, syntax);
    assert.equal(jumped.kind, "note", syntax);
    assert.equal(jumped.source, page, syntax);
    assert.equal(jumped.text, text, syntax);
  }
  // A heading with a space, as the page's own links write it.
  assert.equal((await resources.load("#My%20Part", page)).source, page);
  assert.equal((await resources.load("#^block-id", page)).source, page);
});

test("a hidden note is a source for its own fragment links only once it was loaded", async () => {
  const root = "file:///home/reader/vault";
  const page = `${root}/.raw/captured/page.md`;
  const { resources } = resourcesOnDisk(root, { [page]: "## Part" });
  await assert.rejects(resources.load("#Part", page), /Unknown note source/);
  await resources.load("/.raw/captured/page.md");
  assert.equal((await resources.load("#Part", page)).source, page);
});

test("a fragment-only link keeps the containment and existence checks of its note", async () => {
  const root = "file:///home/reader/vault";
  const page = `${root}/.raw/captured/page.md`;
  const files: Record<string, string | undefined> = { [page]: "## Part" };
  const escaping: string[] = [];
  const { resources } = resourcesOnDisk(root, files, { escaping });
  await resources.load("/.raw/captured/page.md");

  // The file turned into a link that leaves the vault since it was loaded.
  escaping.push(page);
  await assert.rejects(
    resources.load("#Part", page),
    /symlink escapes the vault/,
  );
  escaping.length = 0;

  // The file went away: nothing to show, and the link is remembered missing.
  delete files[page];
  await assert.rejects(resources.load("#Part", page), /Resource not found/);
});

test("a link naming the hidden note itself (page.md#Part) still resolves beside it", async () => {
  const root = "file:///home/reader/vault";
  const page = `${root}/.raw/captured/page.md`;
  const { resources } = resourcesOnDisk(root, { [page]: "## Part" });
  await resources.load("/.raw/captured/page.md");
  assert.equal((await resources.load("page.md#Part", page)).source, page);
  assert.equal((await resources.load("./page.md#Part", page)).source, page);
});

test("a fragment-only link in an indexed note still resolves through the index", async () => {
  const root = "file:///home/reader/vault";
  const source = `${root}/wiki/notes/source.md`;
  const { resources } = resourcesOnDisk(
    root,
    { [source]: "## Part" },
    { indexed: ["wiki/notes/source.md"] },
  );
  const jumped = await resources.load("#Part");
  assert.equal(jumped.source, source);
  assert.equal(jumped.text, "## Part");
});

test("an HTML file in the vault loads as the html kind, with a URL that changes with the file", async () => {
  const root = "file:///home/reader/vault";
  const page = `${root}/wiki/assets/diagram.html`;
  const { resources } = resourcesOnDisk(root, { [page]: "<p>hi</p>" });
  const loaded = await resources.load("/wiki/assets/diagram.html");
  assert.equal(loaded.kind, "html");
  assert.equal(loaded.source, page);
  assert.equal(loaded.url, `${page}?v=7`);
  // The page is shown by its URL: its text never travels to the editor.
  assert.equal(loaded.text, undefined);
});

test("an HTML file outside the vault, or behind a link out of it, is never loaded", async () => {
  const root = "file:///home/reader/vault";
  const outside = "file:///home/reader/secret.html";
  const { resources, stats } = resourcesOnDisk(root, {
    [outside]: "<script>1</script>",
  });
  await assert.rejects(
    resources.load("../../../secret.html"),
    /Resource not found/,
  );
  await assert.rejects(resources.load("/../secret.html"), /Resource not found/);
  // A link that names a scheme is no vault link.
  await assert.rejects(
    resources.load(outside),
    /Resource must be a vault link/,
  );
  assert.equal(
    stats.some((uri) => uri.startsWith(outside)),
    false,
    "the file outside the vault was never asked of the disk",
  );
  // `authorizeTarget` reads the file's stat, then refuses it: it is never served.
  await assert.rejects(
    resources.authorizeTarget(outside),
    /Resource escapes the vault/,
  );
});

test("an HTML file that is a symbolic link out of the vault is refused", async () => {
  const root = "vscode-remote://host/vault";
  const resources = new NoteResources({
    source: `${root}/notes/source.md`,
    vault: {
      root,
      resolveLink: () => ({
        path: "linked.html",
        uri: `${root}/linked.html`,
        basename: "linked",
        extension: "html",
        mtime: 1,
        size: 1,
      }),
    } as unknown as VaultIndex,
    host: {
      workspace: {
        async stat() {
          return { mtime: 1, symbolicLink: true };
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
    resources.load("linked.html", undefined, "wikilink"),
    /symbolic links are not supported/,
  );
});

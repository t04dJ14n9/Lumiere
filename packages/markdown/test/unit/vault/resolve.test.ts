import test from "node:test";
import assert from "node:assert/strict";
import { MemoryVaultIndex } from "../../../src/plugins/vault/memory-index";
import type { LinkFormat } from "../../../src/plugins/vault/link-text";

function vault(
  paths: string[],
  folderNote = "",
  linkFormat: LinkFormat = "shortest",
) {
  const index = new MemoryVaultIndex({
    root: "file:///vault",
    folderNote,
    linkFormat,
  });
  index.replaceFiles(
    paths.map((path) => ({
      uri: `file:///vault/${path}`,
      path,
      mtime: 1,
      size: 1,
    })),
  );
  return index;
}

const files = [
  "Home.md",
  "Unique.md",
  "notes/Shared.md",
  "notes/deep/Shared.md",
  "archive/Shared.md",
  "notes/Local.md",
  "notes/sub/Child.md",
  "projects/Plan.md",
  "projects/Plan.pdf",
  "assets/image.png",
  "Folder/_index.md",
  "Folder/Other.md",
  "Mixed Case.md",
];

const cases: [string, string, string, string | undefined][] = [
  // [description, linktext, source, expected destination]
  [
    "empty path means the source note",
    "#Heading",
    "notes/Local.md",
    "notes/Local.md",
  ],
  [
    "exact path without extension",
    "projects/Plan",
    "Home.md",
    "projects/Plan.md",
  ],
  [
    "exact path with extension",
    "projects/Plan.pdf",
    "Home.md",
    "projects/Plan.pdf",
  ],
  [
    "exact path ignores subpath and case",
    "PROJECTS/plan#Goals",
    "Home.md",
    "projects/Plan.md",
  ],
  ["unique basename anywhere", "Unique", "notes/sub/Child.md", "Unique.md"],
  [
    "unique basename for attachments keeps extension",
    "image.png",
    "Home.md",
    "assets/image.png",
  ],
  ["unique basename ignores case", "mixed case", "Home.md", "Mixed Case.md"],
  [
    "./ resolves from the source folder",
    "./Local",
    "notes/Shared.md",
    "notes/Local.md",
  ],
  [
    "../ climbs from the source folder",
    "../Local",
    "notes/sub/Child.md",
    "notes/Local.md",
  ],
  [
    // As in Obsidian (measured): `..` above the root is dropped.
    "../ beyond the vault root stops at the root",
    "../../Home",
    "notes/Local.md",
    "Home.md",
  ],
  [
    "leading slash starts at the vault root",
    "/projects/Plan",
    "notes/Local.md",
    "projects/Plan.md",
  ],
  [
    "ambiguous name prefers the same folder",
    "Shared",
    "notes/Local.md",
    "notes/Shared.md",
  ],
  [
    "ambiguous name prefers a match under the source folder",
    "Shared",
    "notes/deep/Note.md",
    "notes/deep/Shared.md",
  ],
  [
    "ambiguous name from the root prefers the shortest path",
    "Shared",
    "Home.md",
    "notes/Shared.md",
  ],
  [
    // As in Obsidian: outside the source folder, length beats folder distance.
    "ambiguous name outside the source folder prefers the shortest path",
    "Shared",
    "notes/sub/Child.md",
    "notes/Shared.md",
  ],
  [
    "path suffix narrows ambiguous names",
    "deep/Shared",
    "Home.md",
    "notes/deep/Shared.md",
  ],
  ["unknown note does not resolve", "Missing", "Home.md", undefined],
  [
    // Rooted miss must not fall through to suffix / folder-note fuzzy resolve.
    "rooted miss does not fuzzy-match a basename",
    "/Shared",
    "Home.md",
    undefined,
  ],
  [
    "rooted miss of an unknown path resolves to nothing",
    "/does-not-exist",
    "notes/Local.md",
    undefined,
  ],
  [
    "folder link without a folder note does not resolve",
    "Folder",
    "Home.md",
    undefined,
  ],
  ["alias text is not part of the path", "Unique", "Home.md", "Unique.md"],
];

for (const [description, linktext, source, expected] of cases) {
  test(`resolveLink: ${description}`, () => {
    assert.equal(vault(files).resolveLink(linktext, source)?.path, expected);
  });
}

test("resolveLink: a folder link opens the configured folder note", () => {
  const index = vault(files, "_index.md");
  assert.equal(
    index.resolveLink("Folder", "Home.md")?.path,
    "Folder/_index.md",
  );
  assert.equal(index.resolveLink("Other", "Home.md")?.path, "Folder/Other.md");
});

test("resolveLinkCandidates lists every ambiguous match shortest first", () => {
  assert.deepEqual(
    vault(files)
      .resolveLinkCandidates("Shared", "notes/sub/Child.md")
      .map((file) => file.path),
    ["notes/Shared.md", "archive/Shared.md", "notes/deep/Shared.md"],
  );
});

test("resolveLink: a shorter path beats a nearer folder outside the source", () => {
  // From notes/daily/, notes/x.md is one folder away and y/x.md three, but
  // Obsidian ranks by path length, so a rename rewrite must target y/x.md.
  assert.equal(
    vault(["notes/x.md", "y/x.md", "notes/daily/today.md"]).resolveLink(
      "x",
      "notes/daily/today.md",
    )?.path,
    "y/x.md",
  );
});

test("resolveLink: under the source folder still wins over a shorter path", () => {
  assert.equal(
    vault([
      "notes/daily/deep/x.md",
      "a/x.md",
      "notes/daily/today.md",
    ]).resolveLink("x", "notes/daily/today.md")?.path,
    "notes/daily/deep/x.md",
  );
});

test("resolveLink: equal-length matches tie-break by path", () => {
  assert.equal(
    vault(["b/x.md", "a/x.md", "c/today.md"]).resolveLink("x", "c/today.md")
      ?.path,
    "a/x.md",
  );
});

test("linkText follows the new link format", () => {
  const formats: [LinkFormat, string, string, string][] = [
    ["shortest", "Unique.md", "notes/Local.md", "Unique"],
    ["shortest", "notes/Shared.md", "Home.md", "notes/Shared"],
    ["shortest", "assets/image.png", "Home.md", "image.png"],
    ["relative", "notes/sub/Child.md", "notes/Local.md", "sub/Child"],
    ["relative", "Home.md", "notes/sub/Child.md", "../../Home"],
    ["absolute", "Unique.md", "notes/Local.md", "Unique"],
    ["absolute", "notes/sub/Child.md", "Home.md", "notes/sub/Child"],
  ];
  for (const [format, target, source, expected] of formats) {
    const index = vault(files, "", format);
    assert.equal(
      index.linkText(index.file(target)!, source),
      expected,
      `${format} ${target}`,
    );
  }
});

// Measured with Obsidian's getFirstLinkpathDest over the same files
// (2026-10-17): a relative link is joined to its note's folder, `..` above
// the root dropped, and then resolves like any other link.
test("a relative link resolves as Obsidian resolves it", () => {
  const vault = new MemoryVaultIndex({
    root: "file:///vault",
    folderNote: "",
    linkFormat: "shortest",
  });
  for (const path of [
    "Same.md",
    "dup/A/Same.md",
    "dup/B/Same.md",
    "dup/A/src.md",
    "dup/A/Sub/src2.md",
  ]) {
    vault.upsertFile({
      path,
      uri: `file:///vault/${path}`,
      size: 0,
      mtime: 0,
      excluded: false,
    });
  }
  const resolve = (link: string, source: string) =>
    vault.resolveLink(link, source)?.path;
  assert.equal(resolve("../Same", "root.md"), "Same.md");
  assert.equal(resolve("../B/Same", "root.md"), "dup/B/Same.md");
  assert.equal(resolve("./Same", "dup/A/src.md"), "dup/A/Same.md");
  assert.equal(resolve("../B/Same", "dup/A/src.md"), "dup/B/Same.md");
  assert.equal(resolve("../Same", "dup/A/src.md"), undefined);
  assert.equal(resolve("../Same", "dup/A/Sub/src2.md"), "dup/A/Same.md");
  assert.equal(resolve("./Same", "dup/A/Sub/src2.md"), undefined);
});

test("resolveLink: a Markdown path keeps its #, a wikilink's # starts its subpath", () => {
  const index = vault(["chapter.md", "chapter#1.md"]);
  assert.equal(
    index.resolveLink("chapter#1.md", "Home.md", "markdown")?.path,
    "chapter#1.md",
  );
  assert.equal(
    index.resolveLink("chapter#2.md", "Home.md", "markdown"),
    undefined,
  );
  assert.equal(
    index.resolveLink("chapter#1", "Home.md", "wikilink")?.path,
    "chapter.md",
  );
});

test("resolveLink: rooted miss does not open a folder note", () => {
  const index = vault(files, "_index.md");
  assert.equal(index.resolveLink("/Folder", "Home.md"), undefined);
});

// Source-folder (and descendant) suffix hits rank ahead of nearer outsiders.
test("suffixMatches: source-folder descendant ranks before other folders", () => {
  const paths = ["a/b/note.md", "a/b/c/x.md", "z/x.md"];
  assert.equal(
    vault(paths).resolveLink("x", "a/b/note.md")?.path,
    "a/b/c/x.md",
  );
  assert.deepEqual(
    vault(paths)
      .resolveLinkCandidates("x", "a/b/note.md")
      .map((file) => file.path),
    ["a/b/c/x.md", "z/x.md"],
  );
});

test("suffixMatches: source-folder hit beats a closer non-descendant", () => {
  // Distance-only: a/x.md is closer to a/b than a/b/c/d/x.md (1 vs 2).
  // Source-folder preference must still pick the under-a/b candidate first.
  const paths = ["a/b/note.md", "a/b/c/d/x.md", "a/x.md"];
  assert.equal(
    vault(paths).resolveLink("x", "a/b/note.md")?.path,
    "a/b/c/d/x.md",
  );
  assert.deepEqual(
    vault(paths)
      .resolveLinkCandidates("x", "a/b/note.md")
      .map((file) => file.path),
    ["a/b/c/d/x.md", "a/x.md"],
  );
});

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  changedSpan,
  createSidecar,
  formatHighlight,
  highlightFragment,
  highlightIdOfFragment,
  isHighlightId,
  newHighlightId,
  parseSidecar,
  removeHighlight,
  sidecarBelongsTo,
  upsertHighlight,
  type SidecarHighlight,
} from "../../src/shared/sidecar-format";
import {
  parseSidecarLocation,
  sidecarFileName,
  sidecarPlacement,
  workspaceFolderSegments,
} from "../../src/shared/sidecar-path";

function highlight(
  overrides: Partial<SidecarHighlight> = {},
): SidecarHighlight {
  return {
    id: "hl-a1b2c3d4",
    page: 3,
    subtype: "highlight",
    color: "#FFE566",
    opacity: 0.45,
    segmentRects: [
      { x: 72, y: 410, w: 220, h: 12 },
      { x: 72, y: 424, w: 180.5, h: 12 },
    ],
    quote: "scaled dot-product attention",
    contextBefore: "We propose ",
    contextAfter: " as the core of the Transformer.",
    created: "2026-11-01T18:00:00.000Z",
    modified: "2026-11-01T18:00:00.000Z",
    ...overrides,
  };
}

test("a sidecar is the PDF's name with .lumiere.md", () => {
  assert.equal(sidecarFileName("paper.pdf"), "paper.pdf.lumiere.md");
});

test("sidecars go beside the PDF unless a workspace folder is set", () => {
  assert.deepEqual(sidecarPlacement(undefined, "notes"), { kind: "sibling" });
  assert.deepEqual(sidecarPlacement("sibling", "notes"), { kind: "sibling" });
  assert.deepEqual(sidecarPlacement("directory", "notes/pdf-sidecars"), {
    kind: "directory",
    folder: ["notes", "pdf-sidecars"],
  });
  assert.equal(parseSidecarLocation("elsewhere"), "sibling");
});

test("a sidecar folder must stay inside the workspace", () => {
  assert.deepEqual(workspaceFolderSegments("notes\\pdf/./x/"), [
    "notes",
    "pdf",
    "x",
  ]);
  assert.deepEqual(workspaceFolderSegments("a/../b"), ["b"]);
  assert.deepEqual(workspaceFolderSegments("."), [], "the workspace root");
  for (const bad of [
    "",
    "  ",
    "/abs",
    "~/notes",
    "C:\\notes",
    "../out",
    "a/../../b",
    7,
  ]) {
    assert.equal(typeof workspaceFolderSegments(bad), "string", String(bad));
    assert.equal(sidecarPlacement("directory", bad).kind, "misconfigured");
  }
});

test("a highlight survives a write and a read", () => {
  const text = createSidecar({ source: "paper.pdf" }, [highlight()]);
  assert.match(
    text,
    /^---\nlumiere-pdf-sidecar: 1\nsource: "paper.pdf"\n---\n/,
  );
  assert.match(text, /## Notes\n$/);
  const file = parseSidecar(text);
  assert.equal(file.version, 1);
  assert.equal(file.source, "paper.pdf");
  assert.equal(file.path, undefined);
  assert.deepEqual(file.highlights, [highlight()]);
  const inFolder = parseSidecar(
    createSidecar({ source: "paper.pdf", path: "papers/a/paper.pdf" }, []),
  );
  assert.equal(inFolder.path, "papers/a/paper.pdf");
});

test("quotes cannot end the comment, and keep line breaks and quotes", () => {
  const tricky = highlight({
    quote: 'a --> b "c"\nnext <!-- d',
    contextAfter: "-->",
  });
  const block = formatHighlight(tricky);
  assert.equal(
    block.indexOf("-->"),
    block.length - 3,
    "only the block's own end",
  );
  assert.deepEqual(parseSidecar(block).highlights, [tricky]);
});

test("the block from the design reads as written", () => {
  const text = [
    "---",
    "lumiere-pdf-sidecar: 1",
    "source: paper.pdf",
    "---",
    "",
    "<!-- lumiere-highlight",
    "id: hl-a1b2c3d4",
    "page: 3",
    "subtype: highlight",
    'color: "#FFE566"',
    "opacity: 0.45",
    "segmentRects:",
    "  - { x: 72, y: 410, w: 220, h: 12 }",
    "  - { x: 72, y: 424, w: 180.5, h: 12 }",
    'quote: "scaled dot-product attention"',
    'contextBefore: "We propose "',
    'contextAfter: " as the core of the Transformer."',
    "created: 2026-11-01T18:00:00.000Z",
    "modified: 2026-11-01T18:00:00.000Z",
    "-->",
    "",
    "## Notes",
    "",
    "See [attention definition](paper.pdf#hl-a1b2c3d4).",
    "",
  ].join("\r\n");
  const file = parseSidecar(text);
  assert.equal(file.source, "paper.pdf");
  assert.deepEqual(file.highlights, [highlight()]);
});

test("blocks that are not highlights are skipped, odd values fall back", () => {
  const text = [
    "<!-- lumiere-highlight\nid: no spaces allowed\npage: 1\nsegmentRects:\n  - { x: 1, y: 1, w: 1, h: 1 }\n-->",
    "<!-- lumiere-highlight\nid: hl-1\npage: 0\nsegmentRects:\n  - { x: 1, y: 1, w: 1, h: 1 }\n-->",
    "<!-- lumiere-highlight\nid: hl-2\npage: 1\nsegmentRects:\n  - { x: 1, y: 1, w: 0, h: 1 }\n-->",
    "<!-- lumiere-highlight\nid: 7f\npage: 2\ncolor: red\nopacity: 4\nsegmentRects:\n  - { x: 1, y: 2, w: 3, h: 4 }\n-->",
  ].join("\n\n");
  const [only, ...rest] = parseSidecar(text).highlights;
  assert.deepEqual(rest, []);
  assert.equal(only?.id, "7f");
  assert.equal(only?.color, "#FFE566");
  assert.equal(only?.opacity, 0.45);
  assert.equal(only?.quote, "");
  assert.equal(highlightFragment(only!.id), "hl-7f");
});

test("a new highlight goes after the last one, and the prose stays", () => {
  const prose = "\n## Notes\n\nMy notes [link](paper.pdf#hl-a1b2c3d4).\n";
  const start = createSidecar({ source: "paper.pdf" }, []).replace(
    "## Notes\n",
    prose.trimStart(),
  );
  const one = upsertHighlight(start, highlight());
  assert.ok(one.endsWith(prose.trimStart()));
  const two = upsertHighlight(one, highlight({ id: "hl-2", page: 4 }));
  assert.deepEqual(
    parseSidecar(two).highlights.map((h) => h.id),
    ["hl-a1b2c3d4", "hl-2"],
  );
  assert.ok(two.endsWith(prose.trimStart()));
  assert.ok(two.indexOf("hl-2") < two.indexOf("## Notes"));
  // Rewriting a highlight changes its block only.
  const moved = upsertHighlight(
    two,
    highlight({ quote: "moved", modified: "2026-11-02T00:00:00.000Z" }),
  );
  assert.equal(parseSidecar(moved).highlights[0]?.quote, "moved");
  assert.equal(
    moved.replace(/quote: "moved"\n/, "").length < moved.length,
    true,
  );
  assert.equal(
    removeHighlight(removeHighlight(moved, "hl-a1b2c3d4"), "hl-2"),
    start.replace(/\n+## Notes/, "\n\n## Notes"),
  );
  assert.equal(removeHighlight(start, "hl-missing"), start);
  assert.match(
    upsertHighlight("", highlight()),
    /^<!-- lumiere-highlight[\s\S]*-->\n$/,
  );
});

test("links name a highlight with #hl-", () => {
  assert.equal(highlightIdOfFragment("#hl-a1b2c3d4"), "hl-a1b2c3d4");
  assert.equal(highlightIdOfFragment("page=3&hl-a1b2c3d4"), "hl-a1b2c3d4");
  assert.equal(highlightIdOfFragment("page=3&viewrect=1,2,3,4"), undefined);
  assert.equal(highlightIdOfFragment("hl-%zz"), undefined);
  assert.equal(highlightIdOfFragment("hl-has space"), undefined);
  assert.equal(highlightFragment("hl-x"), "hl-x");
  assert.equal(highlightFragment("x"), "hl-x");
  assert.equal(
    newHighlightId(() => "0123456789abcdef"),
    "hl-01234567",
  );
  assert.ok(isHighlightId("hl-01234567"));
  assert.ok(!isHighlightId("hl-" + "a".repeat(70)));
});

test("an edit to the sidecar replaces only what changed", () => {
  const apply = (before: string, after: string) => {
    const span = changedSpan(before, after);
    return span
      ? before.slice(0, span.start) + span.text + before.slice(span.end)
      : before;
  };
  for (const [before, after] of [
    ["abc", "abXc"],
    ["aXbc", "abc"],
    ["aaaa", "aaaaa"],
    ["", "new"],
    ["old", ""],
    ["same", "same"],
  ] as const) {
    assert.equal(apply(before, after), after);
  }
  assert.deepEqual(changedSpan("one two three", "one 2 three"), {
    start: 4,
    end: 7,
    text: "2",
  });
  assert.equal(changedSpan("x", "x"), undefined);
});

test("a sidecar for another PDF is not this PDF's", () => {
  const owner = { source: "paper.pdf", path: "a/paper.pdf" };
  assert.ok(
    sidecarBelongsTo({}, owner),
    "no front matter: a reader's own file",
  );
  assert.ok(sidecarBelongsTo({ source: "paper.pdf" }, owner));
  assert.ok(
    sidecarBelongsTo({ source: "paper.pdf", path: "a/paper.pdf" }, owner),
  );
  assert.ok(!sidecarBelongsTo({ source: "other.pdf" }, owner));
  assert.ok(
    !sidecarBelongsTo({ source: "paper.pdf", path: "b/paper.pdf" }, owner),
  );
  assert.ok(
    sidecarBelongsTo(
      { source: "paper.pdf", path: "b/paper.pdf" },
      { source: "paper.pdf" },
    ),
  );
});

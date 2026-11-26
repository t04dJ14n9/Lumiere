import assert from "node:assert/strict";
import test from "node:test";
import { config as editorConfig } from "../../../src/plugins/editor/manifest";
import { webviewSnapshot } from "../../../src/plugins/editor/snapshot";
import { snapshotLayout } from "../../../src/plugins/editor/snapshot-layout";
import { snapshotMatches } from "../../../src/webview/snapshot";
import type { NoteSettings } from "../../../src/shared/host";

type Note = Pick<NoteSettings, "preset" | "mode" | "editor" | "features">;
const NOTE: Note = { preset: "obsidian", mode: "livePreview" };
const snapshot = (source: string, note: Note = NOTE) =>
  webviewSnapshot(source, note, "mac");

/** The drawn lines' text, one string per line, tags removed. */
function text(html: string): string[] {
  const content =
    /<div class="mw-snapshot-text"[^>]*>(.*)<\/div><\/div>$/s.exec(html)![1]!;
  return content
    .split(/<\/div>(?=<div class="cm-line|<div class="hybrid)/)
    .map((line) =>
      line
        .replace(/<br>/g, "")
        .replace(/<[^>]*>/g, "")
        .replaceAll("&lt;", "<")
        .replaceAll("&gt;", ">")
        .replaceAll("&quot;", '"')
        .replaceAll("&amp;", "&"),
    );
}

/**
 * The elements and attributes the snapshot may contain: nothing that acts.
 * The Properties skeleton's inputs are read-only, its link has no `href` and
 * its button no handler; it draws two icons as inline SVG.
 */
function assertInert(html: string): void {
  const tags = html.match(/<[^>]*>/g) ?? [];
  const allowed = [
    "class",
    "style",
    "aria-hidden",
    "data-layout",
    "type",
    "tabindex",
    "readonly",
    "disabled",
    "checked",
    "value",
    "inputmode",
    "step",
    "data-property-input",
    "data-placeholder",
    "data-lucide",
    "xmlns",
    "width",
    "height",
    "viewBox",
    "fill",
    "stroke",
    "stroke-width",
    "stroke-linecap",
    "stroke-linejoin",
    "d",
  ];
  for (const tag of tags) {
    const match =
      /^<\/?(div|span|br|wbr|svg|path|input|a|button)((?:\s+[A-Za-z-]+(?:="[^"]*")?)*)\s*\/?>$/.exec(
        tag,
      );
    assert.ok(match, `unexpected markup ${tag}`);
    const names = match[2]!.replace(/="[^"]*"/g, "");
    for (const [, name] of names.matchAll(/\s([A-Za-z-]+)/g)) {
      assert.ok(allowed.includes(name!), `unexpected attribute ${name}`);
    }
  }
  // Text is escaped: every `<` left starts one of the tags above.
  assert.equal(html.replace(/<[^>]*>/g, "").includes("<"), false);
  assert.equal(/javascript:|onerror|onload/i.test(tags.join("")), false);
}

test("a note's first screen is drawn with Live Preview's classes", () => {
  const html = snapshot(
    "# Title\n\nSome **bold** and *italic* text with `code` and a [link](https://example.com) and [[Wiki|alias]].\n\n- one\n  - two\n\n> quote\n",
  );
  assert.match(html, /^<div class="mw-snapshot" aria-hidden="true"/);
  assert.match(
    html,
    /<div class="cm-line md-heading md-h1 is-first-line"><span class="md-syntax-mark">#<\/span><span class="md-header-space"> <\/span>Title<\/div>/,
  );
  // Hidden syntax leaves a place where a line may break, as the editor does.
  assert.match(html, /<wbr><span class="md-strong">bold<\/span><wbr>/);
  assert.match(html, /<wbr><span class="md-emphasis">italic<\/span><wbr>/);
  assert.match(html, /<wbr><span class="md-inline-code">code<\/span><wbr>/);
  assert.match(
    html,
    /<wbr><span class="md-link md-link-rendered md-link-external">link<\/span><wbr>/,
  );
  assert.match(
    html,
    /<wbr><span class="md-link md-link-rendered">alias<\/span><wbr>/,
  );
  assert.match(
    html,
    /<div class="cm-line md-list-line" style="--list-depth: 1; --list-marker: calc\(1.25em \+ 3px\)"><span class="md-list-indent" style="--list-depth: 1"><\/span><span class="list-bullet">•<\/span>two<\/div>/,
  );
  assert.match(
    html,
    /<div class="cm-line md-quote" style="--quote-depth: 1">quote<\/div>/,
  );
  assert.deepEqual(text(html), [
    "# Title",
    "",
    "Some bold and italic text with code and a link and alias.",
    "",
    "•one",
    "•two",
    "",
    "quote",
    "",
  ]);
  // A heading below line 1 hides its marks and has space above it.
  assert.match(
    snapshot("Intro\n\n## Later\n"),
    /<div class="cm-line md-heading md-h2"><wbr>Later<\/div>/,
  );
});

test("tags are drawn as tags while the tags plugin is on, else stay text", () => {
  const source = "Intro\n\nSee #project/alpha and #todo here.\n";
  assert.match(
    snapshot(source),
    /See <span class="md-tag">#project\/alpha<\/span> and <span class="md-tag">#todo<\/span> here\./,
  );
  const off: Note = {
    ...NOTE,
    features: { tags: { enabled: false, config: {} } },
  };
  assert.match(snapshot(source, off), /See #project\/alpha and #todo here\./);
  assert.doesNotMatch(snapshot(source, off), /md-tag/);
});

test("code, rules and numbered items are drawn like the editor draws them", () => {
  const html = snapshot(
    "Intro\n\n1. first\n10. tenth\n\n---\n\n```ts\nconst a = 1 < 2;\n\n```\n",
  );
  assert.match(html, /<span class="md-list-number">1\. <\/span>first/);
  assert.match(html, /<span class="md-list-number">10\. <\/span>tenth/);
  assert.match(html, /--list-marker: calc\(1.5em \+ 6px\)/);
  assert.match(html, /<div class="cm-line md-hr-line"><br><\/div>/);
  assert.match(
    html,
    /md-code-line md-code-fence md-code-fence-open"><br><\/div><div class="cm-line md-code-line">const a = 1 &lt; 2;<\/div><div class="cm-line md-code-line"><br><\/div><div class="cm-line md-code-line md-code-fence md-code-fence-close">/,
  );
});

test("note text cannot add markup, attributes, scripts or addresses", () => {
  const html = snapshot(
    [
      'Intro "quoted" & 5 < 6 > 4 text',
      "",
      '## Head `"><img src=x onerror=alert(1)>`',
      "",
      'A [click](javascript:alert(1)) and [[a"><script>alert(2)</script>]] and `</div><script>`.',
      "",
      "- item `<script>alert(4)</script>`",
      "",
      '> quote `" onmouseover="x`',
      "",
      "```ts",
      '</div><script>alert(3)</script>" onload="x',
      "```",
    ].join("\n"),
  );
  assertInert(html);
  assert.equal(html.includes("<script"), false);
  assert.equal(html.includes("<img"), false);
  // Neither the link's address nor the wikilink target is in the markup.
  assert.equal(html.includes("href"), false);
  const shown = text(html).join("\n");
  for (const visible of [
    'Intro "quoted" & 5 < 6 > 4 text',
    'a"><script>alert(2)</script>',
    "</div><script>",
    "alert(4)",
    '</div><script>alert(3)</script>" onload="x',
  ]) {
    assert.ok(shown.includes(visible), `${visible} is shown as text`);
  }
});

test("only the first screen is drawn", () => {
  const lines = Array.from({ length: 2000 }, (_, i) => `Line ${i}`);
  const html = snapshot(lines.join("\n\n"));
  const drawn = text(html);
  assert.ok(drawn.length <= 80, `${drawn.length} lines`);
  assert.ok(drawn.length > 40);
  assert.ok(html.length < 24 * 1024, `${html.length} bytes`);
  assert.match(html, /^<div class="mw-snapshot is-truncated"/);
  // Short notes are complete: the editor's scrollbar follows its own height.
  assert.match(snapshot("Short\n"), /^<div class="mw-snapshot"/);
  // A paragraph reaching the cut may go on beyond it, so it is left out.
  const paragraph = "word ".repeat(2000).trim();
  assert.deepEqual(text(snapshot(`First\n\n${paragraph}\n`)), ["First", ""]);
  // Characters count too: long lines cut the screen short.
  const wide = Array.from({ length: 200 }, () => "x".repeat(100)).join("\n\n");
  assert.ok(text(snapshot(wide)).length <= 82);
  // Only the start of a huge note is read.
  const huge = lines.join("\r\n\r\n").repeat(400);
  assert.equal(snapshot(huge), snapshot(huge.slice(0, 100_000)));
  // One line longer than the whole budget leaves nothing to draw.
  assert.equal(snapshot("y".repeat(20000)), "");
});

test("the screen ends before what the editor draws as a widget", async (t) => {
  const stops: Record<string, string> = {
    "a table": "| a | b |\n| - | - |\n| 1 | 2 |",
    "a callout": "> [!note] Title\n> body",
    "an image": "![alt](a.png)",
    "an embed": "![[note]]",
    "an inline image": "text ![alt](a.png) more",
    "inline math": "cost $x^2$ here",
    "block math": "$$\nx\n$$",
    "a footnote": "text[^1]\n\n[^1]: note",
    "a task": "- [ ] task",
    html: "<div>x</div>",
    "an underlined heading": "Heading\n=======",
    "indented code": "    code",
    "a diagram": "```mermaid\ngraph TD\n```",
    "an unclosed fence": "```ts\ncode",
    "a nested quote": "> a\n>\n> > b",
    "a wrapped item": "- one\n  continued",
    "a coloured highlight": "==🔵text==",
    "a reference link": "see [text][ref]\n\n[ref]: https://example.com",
    "an autolink": "<https://example.com>",
    "a comment": "%%hidden%%",
    "a hard break": "line\\\nnext",
  };
  for (const [name, block] of Object.entries(stops)) {
    await t.test(name, () => {
      const html = snapshot(
        `# Before\n\nBefore text.\n\n${block}\n\nAfter text.\n`,
      );
      assert.deepEqual(text(html), ["# Before", "", "Before text.", ""]);
    });
  }
});

test("a note that starts with something it cannot draw has no snapshot", () => {
  for (const source of [
    "| a | b |\n| - | - |\n",
    "**bold** first\n\nText",
    "- item first\n\nText",
    "> quote first\n\nText",
    "```ts\ncode\n```\n",
    "---\nrule first? no, this is a rule\n",
    "",
  ]) {
    assert.equal(snapshot(source), "", JSON.stringify(source));
  }
});

test("frontmatter is the sheet's skeleton, and the text continues below it", () => {
  const html = snapshot(
    "---\ntitle: A\nstatus: open\ntags:\n  - a\n  - b\n---\n\n# Body\n\nText\n",
  );
  assert.match(
    html,
    /<div class="hybrid-properties mw-frontmatter-placeholder"><div class="properties metadata-container mw-properties-skeleton">/,
  );
  assert.equal(html.includes("title: A"), false, "the YAML is not shown");
  // One row per top-level key, named as the sheet names it.
  assert.deepEqual(
    [...html.matchAll(/metadata-property-key-input">([^<]*)</g)].map(
      (m) => m[1],
    ),
    ["title", "status", "tags"],
  );
  assert.deepEqual(text(html).slice(-4), ["Body", "", "Text", ""]);
  assertInert(html);
});

test("a skeleton the browser lays out as the sheet is does not end the screen", () => {
  // Long values wrap, lists of links and any number of items are drawn with
  // the sheet's own classes, so they are as tall as the sheet at any width.
  for (const yaml of [
    `description: "${"word ".repeat(30)}"`,
    'mocs:\n  - "[[One]]"\n  - "[[Two|Alias]]"',
    `authors:\n${Array.from({ length: 12 }, (_, i) => `  - "Author ${i}"`).join("\n")}`,
    "tags: [a, b, c, d, e, f, g]",
    'link: "[[Some Note]]"\ncount: 3\ndone: true\nwhen: 2026-11-21',
  ]) {
    const html = snapshot(`---\n${yaml}\n---\n\n# Body\n\nText\n`);
    assert.match(html, /mw-properties-skeleton/);
    assert.deepEqual(text(html).slice(-4), ["Body", "", "Text", ""], yaml);
  }
});

test("frontmatter whose sheet may differ from its skeleton ends the screen", () => {
  for (const yaml of [
    "title: A\nnested:\n  alpha: 1\n  beta: 2",
    "title: A\nnote: |\n  two\n  lines",
    "title: A\ntitle: B",
    "title: A: B",
    "title: A\nkind: !!str B",
    "title: A\nlist: [[nested]]",
  ]) {
    const html = snapshot(`---\n${yaml}\n---\n\n# Body\n\nText\n`);
    assert.match(html, /mw-frontmatter-placeholder/);
    assert.equal(text(html).join("").includes("Body"), false, yaml);
  }
  // An empty sheet is another height again.
  assert.equal(text(snapshot("---\n---\n\n# Body\n")).includes("Body"), false);
  // A list preview shows fewer chips than the skeleton draws.
  const preview: Note = {
    ...NOTE,
    features: {
      properties: { enabled: true, config: { listPreviewCount: 3 } },
    },
  };
  assert.equal(
    text(
      snapshot("---\ntags: [a, b, c, d]\n---\n\n# Body\n", preview),
    ).includes("Body"),
    false,
  );
});

test("a long frontmatter does not use up the first screen's lines", () => {
  const list = (name: string) =>
    `${name}:\n${Array.from({ length: 40 }, (_, i) => `  - v${i}`).join("\n")}`;
  const yaml = ["a", "b", "c"].map(list).join("\n");
  const html = snapshot(`---\n${yaml}\n---\n\n# Body\n\nText\n`);
  assert.deepEqual(text(html).slice(-4), ["Body", "", "Text", ""]);
});

test("a frontmatter with very many rows draws the first ones and ends the screen", () => {
  const yaml = Array.from({ length: 150 }, (_, i) => `key${i}: v`).join("\n");
  const html = snapshot(`---\n${yaml}\n---\n\n# Body\n\nText\n`);
  assert.match(
    html,
    /min-height:\d+(\.\d+)?px/,
    "the expanded estimate is its floor",
  );
  assert.equal(html.includes("key39"), true);
  assert.equal(html.includes("key40"), false);
  assert.equal(text(html).join("").includes("Body"), false);
});

test("frontmatter that Properties does not draw gives no snapshot", () => {
  const source = "---\ntitle: A\n---\n\n# Body\n";
  const properties = (config: Record<string, unknown>, enabled = true) => ({
    ...NOTE,
    features: { properties: { enabled, config } },
  });
  assert.notEqual(snapshot(source, properties({ display: "visible" })), "");
  assert.equal(snapshot(source, properties({ display: "hidden" })), "");
  assert.equal(snapshot(source, properties({ display: "source" })), "");
  assert.equal(snapshot(source, properties({}, false)), "");
  // Without frontmatter the setting changes nothing about the text.
  assert.notEqual(snapshot("# A\n", properties({ display: "hidden" })), "");
});

test("a CRLF note draws as its LF text does", () => {
  const source = "# Title\n\nParagraph one\ncontinued\n\n- item\n";
  assert.equal(snapshot(source.replaceAll("\n", "\r\n")), snapshot(source));
});

test("the snapshot is skipped for settings it does not draw", () => {
  assert.notEqual(snapshot("# A\n"), "");
  const off = (editor: Record<string, unknown>): Note => ({
    ...NOTE,
    editor: editorConfig.parse(editor),
  });
  assert.equal(snapshot("# A\n", off({ firstPaintSnapshot: false })), "");
  assert.equal(snapshot("# A\n", off({ readableLineLength: true })), "");
  assert.equal(snapshot("# A\n", off({ rightToLeft: true })), "");
  assert.equal(snapshot("# A\n", { ...NOTE, mode: "source" }), "");
  assert.equal(snapshot("# A\n", { ...NOTE, preset: "minimal" }), "");
  const feature = (id: string, enabled: boolean, config = {}): Note => ({
    ...NOTE,
    features: { [id]: { enabled, config } },
  });
  assert.equal(snapshot("# A\n", feature("inlineTitle", true)), "");
  assert.equal(snapshot("# A\n", feature("lineNumbers", false)), "");
  assert.equal(
    snapshot("# A\n", feature("lineNumbers", true, { style: "relative" })),
    "",
  );
  assert.equal(snapshot("# A\n", feature("gitGutter", false)), "");
  assert.equal(snapshot("# A\n", feature("folding", false)), "");
  // Wikilinks stay source without the links plugin.
  assert.equal(snapshot("# A\n", feature("links", false)), "");
  assert.notEqual(
    snapshot("# A\n", feature("lineNumbers", true, { style: "on" })),
    "",
  );
});

test("the note's font and tab settings are carried to the snapshot", () => {
  const html = snapshot("# A\n", {
    ...NOTE,
    editor: editorConfig.parse({
      fontSize: 20,
      lineHeight: 1.8,
      tabSize: 2,
      fontFamily: "Iosevka",
      fontFamilyExplicit: true,
      fontWeight: "300",
    }),
  });
  assert.match(html, /style="--text-font:Iosevka, Menlo/);
  assert.match(html, /--text-size:20px/);
  assert.match(html, /--line-height:1.8/);
  assert.match(html, /--text-weight:300/);
  assert.match(html, /style="tab-size:2"/);
  assertInert(html);
});

test("the editor keeps the snapshot only for the layout it was built for", () => {
  const layout = snapshotLayout(NOTE, "mac")!;
  const element = { dataset: { layout: layout.key } } as unknown as HTMLElement;
  const init = { ...NOTE, editor: editorConfig.parse({}) };
  assert.equal(snapshotMatches(element, init), true);
  const opening = (selection: {
    anchor: number;
    head: number;
    topLine?: number;
  }) => snapshotMatches(element, { ...init, openingSelection: selection });
  assert.equal(opening({ anchor: 3, head: 9 }), false, "a search match");
  assert.equal(opening({ anchor: 0, head: 0, topLine: 120 }), false, "a line");
  assert.equal(
    opening({ anchor: 0, head: 0, topLine: 0 }),
    true,
    "the top, as VS Code reports it when it opens a note",
  );
  assert.equal(
    snapshotMatches(element, {
      ...init,
      editor: editorConfig.parse({ fontSize: 18 }),
    }),
    false,
  );
  assert.equal(snapshotMatches(element, { ...init, mode: "source" }), false);
});

test("a collapsed sheet is its heading alone, with the text drawn below it", () => {
  const source =
    "---\ntitle: A\nstatus: open\ntags:\n  - one\n---\n\n# Body\n\nText\n";
  const collapsed = webviewSnapshot(source, NOTE, "mac", true);
  assert.match(
    collapsed,
    /<div class="properties metadata-container is-collapsed mw-properties-skeleton"><div class="metadata-properties-heading">/,
  );
  assert.equal(collapsed.includes("property-row"), false);
  assert.equal(collapsed.includes("metadata-content"), false);
  assert.deepEqual(text(collapsed).slice(-4), ["Body", "", "Text", ""]);
  assertInert(collapsed);
  // No floor: the heading alone is as tall as the collapsed sheet, at any width.
  assert.equal(collapsed.includes("min-height"), false);
  // Rows the scan cannot read are hidden under a collapsed sheet, but the
  // sheet may then be an error: the screen still ends there.
  const nested = "---\ntitle: A\nn:\n  a: 1\n---\n\n# Body\n";
  assert.equal(
    text(webviewSnapshot(nested, NOTE, "mac", true)).includes("Body"),
    false,
  );
  // Not collapsed, the same note draws its rows.
  assert.equal(
    (webviewSnapshot(source, NOTE, "mac").match(/class="property-row/g) ?? [])
      .length,
    3,
  );
});

test("the layout key says whether the sheet was drawn collapsed, so a mismatch drops the snapshot", () => {
  const expanded = snapshotLayout(NOTE, "mac")!;
  const collapsed = snapshotLayout(NOTE, "mac", true)!;
  assert.notEqual(expanded.key, collapsed.key);
  const init = { ...NOTE, editor: editorConfig.parse({}) };
  const drawnCollapsed = {
    dataset: { layout: collapsed.key },
  } as unknown as HTMLElement;
  const drawnExpanded = {
    dataset: { layout: expanded.key },
  } as unknown as HTMLElement;
  // The host drew it as the `ready` answer says.
  assert.equal(
    snapshotMatches(drawnCollapsed, { ...init, propertiesCollapsed: true }),
    true,
  );
  assert.equal(snapshotMatches(drawnExpanded, init), true);
  assert.equal(
    snapshotMatches(drawnExpanded, { ...init, propertiesCollapsed: false }),
    true,
  );
  // The state changed between the page and the answer: the snapshot goes.
  assert.equal(snapshotMatches(drawnCollapsed, init), false);
  assert.equal(
    snapshotMatches(drawnExpanded, { ...init, propertiesCollapsed: true }),
    false,
  );
  // The webview's layout is built from the same flag as the host's.
  assert.equal(
    snapshotLayout(init, "mac", true)!.key,
    JSON.stringify({
      vars: collapsed.vars,
      tabSize: collapsed.tabSize,
      properties: true,
      listPreviewCount: 0,
      isCollapsed: true,
      tags: true,
    }),
  );
});

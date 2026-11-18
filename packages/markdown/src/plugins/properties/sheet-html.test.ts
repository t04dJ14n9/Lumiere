import test from "node:test";
import assert from "node:assert/strict";
import { renderProperties } from "./sheet-html";

test("property sheet distinguishes editable scalars, list chips and Obsidian unknown JSON maps", () => {
  const html = renderProperties(
    '---\ncount: 3\nflag: true\ntags: ["#one/two", "bad tag"]\nlist: [false, null, "<script>"]\nobject: {child: "<b>"}\n---\n',
  );
  assert.match(html, /type="number" data-property-input="count"/);
  assert.match(html, /type="checkbox" data-property="flag"[^>]* checked/);
  assert.match(html, /data-tag="one\/two"/);
  assert.match(html, /<span>bad tag<\/span>/);
  assert.match(html, /data-property-list="list"/);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /mod-unknown/);
  assert.match(html, /data-property-type="unknown"/);
  assert.match(html, /data-lucide="file-question"/);
  assert.match(html, /&lt;b&gt;/);
  assert.doesNotMatch(html, /data-property-kind="yaml"/);
  assert.doesNotMatch(html, /<script>|<b>/);
});

test("generated is Obsidian Unknown JSON; sources is a plain text property that scrolls", () => {
  const html = renderProperties(
    '---\ngenerated:\n  by: agent\n  at: "2026-10-15T00:00:00Z"\nsources:\n  - resource: ../raw/a.pdf\n    id: a1\nnote: hello\n---\n',
  );
  assert.match(html, /data-property-key="generated"[\s\S]*mod-unknown/);
  assert.doesNotMatch(html, /data-property-type="generated"/);
  assert.match(
    html,
    /data-property-input="sources"[^>]*data-property-kind="text"/,
  );
  // No three-line clamp: the field shows its sources, then scrolls.
  assert.match(
    html,
    /class="metadata-input-longtext mod-scroll"[^>]*data-property-input="sources"/,
  );
});

test("colliding mapping keys stay Source-mode (no dropped entry draft)", () => {
  const html = renderProperties(
    '---\ngenerated:\n  1: first\n  "1": second\n  by: old\n---\n',
  );
  assert.match(html, /data-property-key="generated"[\s\S]*Source mode/);
  assert.doesNotMatch(
    html,
    /data-property-input="generated"[^>]*data-property-kind="yaml"/,
  );
});

test("long property names retain their full identity, accessible label and tooltip", () => {
  const key = "decision_confidence_and_supporting_evidence";
  const html = renderProperties(`---\n${key}: high\n---\n`);
  for (const attribute of [
    "data-property-key",
    "data-property-name",
    "value",
    "title",
  ]) {
    assert.ok(html.includes(`${attribute}="${key}"`), attribute);
  }
  assert.ok(html.includes(`aria-label="Property name: ${key}"`));
});

test("registry property types retain mismatch warnings and choose the expected control", () => {
  const source = "---\ncount: abc\nflag: text\nempty:\n---\n";
  const normal = renderProperties(source, {
    count: "number",
    flag: "checkbox",
    empty: "list",
  });
  assert.match(normal, /Type mismatch, expected Number/);
  assert.match(normal, /type="number" data-property-input="count"/);
  assert.match(normal, /type="checkbox" data-property="flag"/);
  assert.doesNotMatch(normal, /data-property="flag"[^>]* checked/);
  assert.match(normal, /Type mismatch, expected Checkbox/);
  assert.match(normal, /data-property-list="empty"/);
  assert.doesNotMatch(normal, /data-property-convert/);
});

test("property rendering bounds recursive aliases and leaves absent frontmatter alone", () => {
  assert.equal(renderProperties("# note"), "");
  const recursive = renderProperties(
    "---\nloop: &loop { child: *loop }\n---\n",
  );
  assert.match(recursive, /Source mode/);
  assert.doesNotMatch(
    recursive,
    /class="property-chip"|class="property-object"/,
  );
  const empty = renderProperties("---\nvalue: null\n---\n");
  assert.match(empty, /data-placeholder="Empty"/);
});

test("a custom renderer still replaces a non-sources property and keeps a YAML draft", () => {
  const html = renderProperties(
    "---\ncitations: []\n---\n",
    {},
    {
      renderValue: (key) =>
        key === "citations"
          ? '<div class="source-rows" data-sources></div>'
          : undefined,
    },
  );
  assert.match(html, /data-sources/);
  assert.match(html, /data-property-type="multitext"/);
  assert.match(html, /data-property-edit/);
  assert.match(html, /<textarea hidden[^>]*data-property-kind="yaml"/);
  assert.doesNotMatch(html, /data-property-list="citations"/);
});

test("custom rows stay typed UI without YAML even when entries alias", () => {
  const html = renderProperties(
    "---\nreference: &r {resource: ../raw/a.pdf, id: a1}\ncitations: [*r]\n---\n",
    {},
    {
      renderValue: (key) =>
        key === "citations"
          ? '<div class="source-rows"><button data-source-open>Open source</button></div>'
          : undefined,
    },
  );
  assert.match(
    html,
    /class="property-complex"><div class="source-rows">[\s\S]*data-source-open/,
  );
  assert.doesNotMatch(html, /data-property-kind="yaml"|Source mode/);
  assert.doesNotMatch(html, /data-property-list="citations"/);
});

test("tagged YAML sets that cannot round-trip stay non-draft displays", () => {
  const html = renderProperties("---\nvalue: !!set {a: null, b: null}\n---\n");
  assert.doesNotMatch(
    html,
    /data-property-input="value"[^>]*data-property-kind="yaml"/,
  );
});

test("top-level !!timestamp date scalars render editable Date controls", () => {
  const html = renderProperties(
    "---\ncreated: !!timestamp 2026-10-15\nupdated: !!timestamp 2026-10-15T14:30:00\n---\n",
  );
  assert.match(
    html,
    /type="date"[^>]*data-property-input="created"[^>]*value="2026-10-15"|data-property-input="created"[^>]*type="date"[^>]*value="2026-10-15"/,
  );
  assert.match(
    html,
    /type="datetime-local"[^>]*data-property-input="updated"[^>]*value="2026-10-15T14:30"|data-property-input="updated"[^>]*type="datetime-local"[^>]*value="2026-10-15T14:30"/,
  );
  assert.doesNotMatch(html, /data-property-key="created"[\s\S]*Source mode/);
  assert.doesNotMatch(html, /data-property-key="updated"[\s\S]*Source mode/);
});

test("!!timestamp with +08:00 or Z keeps wall-clock in datetime-local value", () => {
  const html = renderProperties(
    "---\nlocal: !!timestamp 2026-10-15T14:30:00+08:00\nutc: !!timestamp 2026-10-15T14:30:00Z\n---\n",
  );
  assert.match(
    html,
    /data-property-input="local"[^>]*value="2026-10-15T14:30"|value="2026-10-15T14:30"[^>]*data-property-input="local"/,
  );
  assert.match(
    html,
    /data-property-input="utc"[^>]*value="2026-10-15T14:30"|value="2026-10-15T14:30"[^>]*data-property-input="utc"/,
  );
  assert.doesNotMatch(html, /value="2026-10-15T06:30"/);
});

test("maps with nested !!timestamp do not fall back to Source mode when Date is settable", () => {
  const html = renderProperties(
    "---\ngenerated: {at: !!timestamp 2026-10-15, by: old}\n---\n",
  );
  // Nested timestamps may become draftable once Date scalars are settable;
  // they must not fall back to the Source-mode dead-end for the whole map.
  assert.doesNotMatch(html, /data-property-key="generated"[\s\S]*Source mode/);
});

for (const value of ["!!pairs [a: 1]", "!!map {a: 1}", ".inf", "[.inf]"]) {
  test(`unsupported ${value} explains Source mode without misleading chips`, () => {
    const html = renderProperties(`---\nvalue: ${value}\n---\n`);
    assert.match(html, /Source mode/);
    assert.doesNotMatch(
      html,
      /data-property-kind="yaml"|class="property-chip"|class="property-object"/,
    );
  });
}

test("type grip is a button distinct from value data-property-type", () => {
  const html = renderProperties("---\na: 1\nb: 2\n---\n");
  assert.match(html, /<button type="button"[^>]*data-property-type/);
  assert.match(
    html,
    /class="metadata-property-value"[^>]*data-property-type="number"/,
  );
  // Order/selection drag and multi-select must target button[data-property-type]
  // only — the value wrapper also carries data-property-type for Obsidian CSS.
});

test("nested maps do not show Type mismatch expected Text (Obsidian unknown, not text)", () => {
  const html = renderProperties(
    `---
generated:
  by: agent
  at: "2026-10-15T00:00:00Z"
decision_confirmation:
  by: human
  scope: cluster
---
`,
  );
  const generated =
    /data-property-key="generated"[\s\S]*?(?=<div class="property-row|$)/.exec(
      html,
    )?.[0];
  assert.ok(generated);
  // Warning node stays in the DOM for type flips; nested maps keep it hidden
  // (Obsidian uses unknown — not a visible Text mismatch flair).
  assert.match(generated!, /metadata-property-warning-icon" hidden/);
  assert.doesNotMatch(generated!, /metadata-property-warning-icon"(?! hidden)/);
  const decision =
    /data-property-key="decision_confirmation"[\s\S]*?(?=<div class="property-row|$)/.exec(
      html,
    )?.[0];
  assert.ok(decision);
  assert.match(decision!, /metadata-property-warning-icon" hidden/);
});

test("a list shows every item by default, as in Obsidian", () => {
  const html = renderProperties("---\ntags: [a, b, c, d, e]\n---\n");
  assert.equal(html.match(/data-property-chip="/g)?.length, 5);
  assert.doesNotMatch(
    html,
    /Showing|data-property-chip-extra|\bhidden data-property-chip/,
  );
});

test("listPreviewCount, when set, shows the top items with a disclosure", () => {
  const html = renderProperties(
    "---\ntags: [a, b, c, d, e]\n---\n",
    {},
    { listPreviewCount: 3 },
  );
  assert.match(html, /Showing 3 of 5/);
  assert.match(html, /data-property-chip-extra/);
  const all = renderProperties(
    "---\ntags: [a, b, c, d, e]\n---\n",
    {},
    { listPreviewCount: 3, expandedLists: new Set(["tags"]) },
  );
  assert.doesNotMatch(all, /Showing 3 of 5|data-property-chip-extra/);
});

test("decision_confirmation stays Obsidian Unknown JSON", () => {
  const html = renderProperties(
    "---\ndecision_confirmation: {by: human:x, at: '2026-01-01T00:00:00Z', scope: cluster}\n---\n",
  );
  assert.match(
    html,
    /data-property-key="decision_confirmation"[\s\S]*mod-unknown/,
  );
  assert.doesNotMatch(html, /data-property-kind="yaml"/);
});

test("verified map and list are Obsidian Unknown JSON", () => {
  for (const yaml of [
    "verified: {by: human:a, at: '2026-01-01T00:00:00Z'}",
    "verified:\n  - {by: human:a}\n  - {by: human:b}",
  ]) {
    const html = renderProperties(`---\n${yaml}\n---\n`);
    assert.match(html, /data-property-key="verified"[\s\S]*mod-unknown/);
    assert.doesNotMatch(html, /data-property-kind="yaml"/);
  }
});

test("sheet heading and add control use Obsidian class aliases and lucide-plus", () => {
  const html = renderProperties("---\nfield: value\n---\n");
  assert.match(html, /class="metadata-properties-title"/);
  assert.match(
    html,
    /class="metadata-collapse-indicator collapse-indicator collapse-icon"/,
  );
  assert.match(
    html,
    /class="metadata-add-button text-icon-button"[^>]*data-property-add/,
  );
  assert.match(html, /data-lucide="plus"/);
  assert.doesNotMatch(html, /＋/);
});

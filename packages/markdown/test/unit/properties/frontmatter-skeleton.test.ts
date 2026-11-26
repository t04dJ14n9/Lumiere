import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  SKELETON_CHEVRON,
  SKELETON_PLUS,
  skeletonMarkup,
  skeletonSheet,
  type SkeletonValue,
} from "../../../src/markdown/properties/frontmatter-skeleton";
import { frontmatterPlaceholder } from "../../../src/markdown/properties/frontmatter-placeholder";
import { renderProperties } from "../../../src/plugins/properties/sheet-html";
import { propertyFlairIcon } from "../../../src/webview/ui/icons";

const valueOf = (yaml: string, key: string): SkeletonValue | undefined =>
  skeletonSheet(yaml).rows.find((row) => row.key === key)?.value;

test("one row per top-level key, in order, with each scalar read as the sheet reads it", () => {
  const sheet = skeletonSheet(
    [
      "title: A plain title # a comment",
      'quoted: "two words"',
      "single: 'it''s'",
      "count: 42",
      "ratio: 0.5",
      "done: true",
      "off: false",
      "when: 2026-11-21",
      "at: 2026-11-21T10:30",
      "word: yes",
      'link: "[[Folder/Note|Alias]]"',
      "empty:",
    ].join("\n"),
  );
  assert.equal(sheet.isExact, true);
  assert.deepEqual(
    sheet.rows.map((row) => [row.key, row.value]),
    [
      ["title", { type: "text", text: "A plain title" }],
      ["quoted", { type: "text", text: "two words" }],
      ["single", { type: "text", text: "it's" }],
      ["count", { type: "number", text: "42" }],
      ["ratio", { type: "number", text: "0.5" }],
      ["done", { type: "checkbox", checked: true }],
      ["off", { type: "checkbox", checked: false }],
      ["when", { type: "date", text: "2026-11-21" }],
      ["at", { type: "datetime", text: "2026-11-21T10:30" }],
      // YAML 1.2, which the sheet parses, has no yes/no booleans.
      ["word", { type: "text", text: "yes" }],
      ["link", { type: "link", label: "Alias" }],
      ["empty", { type: "text", text: "" }],
    ],
  );
});

test("lists read from block items, flush items and flow lists; tags and aliases keep their kind", () => {
  const list = (kind: string, items: string[]) => ({
    type: "list",
    kind,
    items,
  });
  assert.deepEqual(
    valueOf("tags:\n  - a\n  - '#b'\n  - 3", "tags"),
    list("tags", ["a", "#b", "3"]),
  );
  assert.deepEqual(
    valueOf("aliases:\n- x\n- y", "aliases"),
    list("aliases", ["x", "y"]),
  );
  assert.deepEqual(
    valueOf("related: [a, 'b c', d]", "related"),
    list("list", ["a", "b c", "d"]),
  );
  assert.deepEqual(
    valueOf('mocs:\n  - "[[One]]"', "mocs"),
    list("list", ["[[One]]"]),
  );
  assert.deepEqual(valueOf("tags: solo", "tags"), list("tags", ["solo"]));
  assert.deepEqual(valueOf("tags:", "tags"), list("tags", []));
  assert.deepEqual(valueOf("items: []", "items"), list("list", []));
});

test("comments, blank lines and CRLF do not add rows", () => {
  const sheet = skeletonSheet(
    "# header\r\ntitle: A\r\n\r\n# between\r\nstatus: open\r\n",
  );
  assert.deepEqual(
    sheet.rows.map((row) => row.key),
    ["title", "status"],
  );
  assert.equal(sheet.isExact, true);
});

test("a row the scan cannot read makes the sheet inexact and is drawn as one line", () => {
  for (const yaml of [
    "nested:\n  alpha: 1",
    "text: |\n  block",
    "text: >\n  folded",
    'escaped: "a\\nb"',
    "bad: a: b",
    "anchor: &a x",
    "alias: *a",
    "tagged: !!str x",
    "map: {a: 1}",
    "deep: [[x]]",
    "hex: 0x1F",
    "inf: .inf",
    "big: 18446744073709551615",
    "title: A\ntitle: B",
    "invalid: 2026-13-45",
    "mixed: x\n  - y",
    "tags:\n  -\n  - b",
    '"quoted key": 1',
    'wiki: "[[A]] and [[B]]"',
  ]) {
    const sheet = skeletonSheet(yaml);
    assert.equal(sheet.isExact, false, yaml);
    assert.ok(sheet.rows.length > 0, yaml);
  }
  assert.equal(valueOf("nested:\n  alpha: 1", "nested")?.type, "opaque");
  assert.equal(
    skeletonSheet("").isExact,
    false,
    "an empty sheet is another height",
  );
});

test("a very long sheet or list draws a bounded skeleton", () => {
  const many = Array.from({ length: 60 }, (_, i) => `k${i}: v`).join("\n");
  const sheet = skeletonSheet(many);
  assert.equal(sheet.rows.length, 40);
  assert.equal(sheet.isExact, false);
  const long = `tags:\n${Array.from({ length: 60 }, (_, i) => `  - t${i}`).join("\n")}`;
  assert.equal(valueOf(long, "tags")?.type, "opaque");
});

test("the skeleton's chrome is the sheet's own", () => {
  const sheet = renderProperties("---\ntitle: A\n---\n");
  const skeleton = skeletonMarkup(skeletonSheet("title: A"));
  assert.equal(SKELETON_CHEVRON, propertyFlairIcon("collapse"));
  assert.equal(SKELETON_PLUS, propertyFlairIcon("plus"));
  for (const part of [
    `<span class="metadata-collapse-indicator collapse-indicator collapse-icon">${propertyFlairIcon("collapse")}</span><span class="metadata-properties-title">Properties</span>`,
    `${propertyFlairIcon("plus")} Add property`,
    'class="metadata-properties"',
    'class="metadata-content"',
  ]) {
    assert.ok(sheet.includes(part), `the sheet has ${part}`);
    assert.ok(skeleton.includes(part), `the skeleton has ${part}`);
  }
});

test("the skeleton is inert and escapes what it draws", () => {
  const markup = skeletonMarkup(
    skeletonSheet('"<img src=x onerror=1>": 1\nt: "<b>&\\"x"\nl: [a<b>]'),
  );
  assert.equal(/<img|<b>|onerror=1>/.test(markup), false, markup);
  assert.equal(
    / href=| tabindex="0"|contenteditable| data-property-row| data-properties-heading/.test(
      markup,
    ),
    false,
  );
});

test("the placeholder floors the height only for a skeleton that may differ from the sheet", () => {
  const exact = frontmatterPlaceholder(
    "---\ntitle: A\nwhen: 2026-11-21\n---\n",
  );
  assert.equal(exact.isExact, true);
  assert.equal(exact.minHeight, 0);
  const nested = frontmatterPlaceholder("---\ntitle: A\nn:\n  a: 1\n---\n");
  assert.equal(nested.isExact, false);
  assert.equal(nested.minHeight, 166);
});

test("the skeleton never reaches the YAML runtime", () => {
  const root = path.resolve("src");
  const seen = new Set<string>();
  const walk = (file: string): void => {
    if (seen.has(file)) {
      return;
    }
    seen.add(file);
    const source = readFileSync(file, "utf8");
    for (const [, spec] of source.matchAll(/from "([^"]+)"/g)) {
      assert.equal(
        /^(yaml|markdown-it|dompurify)/.test(spec!),
        false,
        `${file} imports ${spec}`,
      );
      if (spec!.startsWith(".")) {
        const target = path.resolve(path.dirname(file), spec!);
        walk(`${target}.ts`);
      }
    }
  };
  walk(path.join(root, "markdown/properties/frontmatter-placeholder.ts"));
  assert.equal(
    [...seen].some((file) =>
      /load-yaml|yaml-runtime|frontmatter\.ts$/.test(file),
    ),
    false,
  );
  assert.ok(seen.size > 3);
});

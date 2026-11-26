import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { headerParts } from "../../../src/markdown/properties/header-parts";
import { skeletonSheet } from "../../../src/markdown/properties/frontmatter-skeleton";
import { skeletonDifferences } from "./skeleton-parity";

const note = (yaml: string) => `---\n${yaml}\n---\n\n# Body\n`;

/**
 * Wherever the skeleton says it is exact, it must be the sheet: the same rows
 * in the same order, the same control, the same text or date or number, the
 * same chips. This is what lets the snapshot draw the text below it.
 */
const AWKWARD = [
  "title: Plain",
  "title: A title with: a colon-free tail # and a comment",
  'quoted: "a: colon, a # hash, a [bracket]"',
  "single: 'it''s'",
  "url: https://example.com/a?b=c#d",
  "time: 12:30",
  "stamp: 2026-11-21 10:00",
  "count: 042\nratio: .5\nbig: 1e3\nneg: -7\nplus: +3",
  "yes: yes\nno: no\non: on",
  "t: True\nf: FALSE\nn: Null\ntilde: ~\nempty:",
  "when: 2026-11-21\nat: 2026-11-21T10:30\nsec: 2026-11-21T10:30:15\nzone: 2026-11-21T10:30:15Z",
  "bad: 2026-02-31",
  "tags:\n  - a\n  - '#b'\n  - c/d\n  - 2024",
  "tags: [a, b]\naliases: [x, 'y z']\ncssclasses:\n- wide\n- narrow",
  "tags: solo\naliases: alone",
  "tags:\naliases:",
  "list: []\nlist2: [ ]",
  "items: [1, true, x, 'two words', \"three\"]",
  'link: "[[Folder/Note|Alias]]"\nbare: "[[Note]]"\nmany: "[[A]] and [[B]]"',
  'mocs:\n  - "[[One]]"\n  - "[[Two|Alias]]"\n  - plain',
  "mocs:\n  - [[One]]",
  "k: [unclosed\nj: 1",
  "k: [a, b\nj: 1",
  'k: "x" y',
  "k: 'a' 'b'",
  "k: ]x\nj: }y",
  "k: a]b\nj: x}y\nl: a,b",
  "a: 1\na: 2",
  "nested:\n  x: 1",
  "block: |\n  two\n  lines",
  "anchor: &a x\nref: *a",
  "tagged: !!str x",
  "k: x\n  continued",
  "# only a comment\ntitle: A",
  "title: A\n\n# between\nstatus: open\n",
  "key with spaces: v\nüñï: v\n-dash: v\n_u: v",
  'k: "a\\nb"',
  "dup list:\n  - a\n  - a",
  "x: a #b\ny: a# b",
  "y: >\n  folded",
  "m: {a: 1}",
  "hex: 0x1F\noct: 0o17\ninf: .inf\nnan: .nan",
  "big: 18446744073709551615",
  "title: " + "word ".repeat(60),
];

test("where the skeleton claims to be exact it is the sheet, over awkward YAML", () => {
  let exact = 0;
  for (const yaml of AWKWARD) {
    const source = note(yaml);
    assert.deepEqual(skeletonDifferences(source), [], yaml);
    exact += skeletonSheet(headerParts(source)!.body).isExact ? 1 : 0;
  }
  assert.ok(
    exact > 15,
    `only ${exact} of ${AWKWARD.length} were exact: the comparison is vacuous`,
  );
  assert.ok(
    exact < AWKWARD.length - 10,
    "the table has cases the scan must refuse",
  );
});

/** Every Markdown file under the repository's own fixtures and documents that opens with a fence. */
function documents(): string[] {
  const roots = ["test/fixtures", "docs", "../../docs"].map((root) =>
    path.resolve(root),
  );
  return roots.flatMap((root) => {
    try {
      return (readdirSync(root, { recursive: true }) as string[])
        .filter((file) => file.endsWith(".md"))
        .map((file) => path.join(root, file));
    } catch {
      return [];
    }
  });
}

test("the skeleton is the sheet for every note with frontmatter in the repository's fixtures and documents", () => {
  let withFrontmatter = 0;
  for (const file of documents()) {
    const source = readFileSync(file, "utf8");
    if (headerParts(source)) {
      withFrontmatter++;
      assert.deepEqual(skeletonDifferences(source), [], file);
    }
  }
  assert.ok(withFrontmatter >= 5, `${withFrontmatter} notes with frontmatter`);
});

import test from "node:test";
import assert from "node:assert/strict";
import { metadata } from "../../../src/markdown/metadata";
import { markdownParser } from "../../../src/markdown/dialect";
import { createRenderer } from "../../../src/markdown/html";
const { renderMarkdown } = createRenderer();

function nodeNames(text: string): string[] {
  const names: string[] = [];
  markdownParser.parse(text).iterate({
    enter(node) {
      names.push(node.name);
    },
  });
  return names;
}

const TRAILING = "$$E=mc^2$$ is the famous one, see [[Einstein]] #physics";

test("text after a closing $$ on the same line is kept in the rendered HTML", () => {
  const html = renderMarkdown(`${TRAILING}\n\nNext`);
  assert.match(html, /data-math="E%3Dmc%5E2" data-display="true"/);
  assert.match(html, /is the famous one, see/);
  assert.match(html, /<p>Next<\/p>/);
});

test("text after a closing $$ on the same line keeps its link and tag in the index", () => {
  const note = metadata(TRAILING);
  assert.deepEqual(
    note.links.map((link) => link.link),
    ["Einstein"],
  );
  assert.deepEqual(
    note.tags.map((tag) => tag.tag),
    ["physics"],
  );
});

test("a one-line formula followed by text is inline display math in a paragraph", () => {
  const names = nodeNames(TRAILING);
  assert.ok(!names.includes("MathBlock"));
  assert.ok(names.includes("Paragraph"));
  assert.ok(names.includes("InlineMath"));
});

test("a one-line formula followed only by spaces is still a display block", () => {
  assert.ok(nodeNames("$$x$$   \nafter").includes("MathBlock"));
  assert.match(
    renderMarkdown("$$x$$   \nafter"),
    /^<span class="math-placeholder math-display"/,
  );
});

test("a paragraph line is not cut by a following line that starts with inline display math", () => {
  const html = renderMarkdown("first line\n$$x$$ continues");
  assert.equal((html.match(/<p>/g) ?? []).length, 1);
  assert.match(html, /continues<\/p>/);
  const names = nodeNames("first line\n$$x$$ continues");
  assert.equal(names.filter((name) => name === "Paragraph").length, 1);
});

/** The formulas of a paragraph as the editor's parser reads it. */
function editorFormulas(text: string): string[] {
  const formulas: string[] = [];
  markdownParser.parse(text).iterate({
    enter(node) {
      if (node.name === "InlineMath") {
        const source = text.slice(node.from, node.to);
        const width = source.startsWith("$$") ? 2 : 1;
        formulas.push(source.slice(width, -width));
      }
    },
  });
  return formulas;
}

/** The formulas of a paragraph as the HTML renderer reads it. */
function renderedFormulas(text: string): string[] {
  return [...renderMarkdown(text).matchAll(/data-math="([^"]*)"/g)].map(
    (match) => decodeURIComponent(match[1]!),
  );
}

test("Live Preview and rendered blocks agree on which text is inline math", () => {
  const cases: [string, string[]][] = [
    ["a $x$ b", ["x"]],
    ["$ x$ is not math", []],
    // A `$` after a space does not close; a later one can.
    ["$a $b$ c", ["a $b"]],
    ["costs $5 and $10 today", []],
    ["escaped \\$x$ and $y\\$z$", ["y\\$z"]],
    ["display $$x + y$$ inline", ["x + y"]],
    // A formula does not run over a line break.
    ["a $x\ny$ b", []],
    ["$1$2", ["1"]],
  ];
  for (const [text, formulas] of cases) {
    assert.deepEqual(editorFormulas(text), formulas, `editor: ${text}`);
    assert.deepEqual(renderedFormulas(text), formulas, `rendered: ${text}`);
  }
});

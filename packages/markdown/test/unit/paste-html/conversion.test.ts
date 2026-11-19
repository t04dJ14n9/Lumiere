import test from "node:test";
import assert from "node:assert/strict";
import { EditorState } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { markdownLanguageSupport } from "../../../src/markdown/dialect";
import { markdownFromHtml } from "../../../src/plugins/pasteHtml/conversion";
import {
  acceptsHtml,
  pasteTransformed,
} from "../../../src/plugins/pasteHtml/paste";

test("rich HTML converts headings, literal text, formatting, lists and tables", () => {
  assert.equal(
    markdownFromHtml(
      "<h2>Heading</h2><p>A <strong>bold</strong> <em>word</em> <mark>mark</mark> <del>gone</del>.</p>",
    ),
    "## Heading\n\nA **bold** _word_ ==mark== ~~gone~~.",
  );
  assert.equal(
    markdownFromHtml("<p>*literal* [brackets]</p>"),
    "\\*literal\\* \\[brackets\\]",
  );
  assert.match(
    markdownFromHtml(
      '<ul><li><input type="checkbox" checked>Done</li><li>Next<ul><li>Nested</li></ul></li></ul>',
    )!,
    /\[x\] Done/,
  );
  assert.equal(
    markdownFromHtml(
      "<table><tr><th>A</th><th>B</th></tr><tr><td><strong>x</strong></td><td>a|b</td></tr></table>",
    ),
    "|A|B|\n|---|---|\n|**x**|a\\|b|",
  );
});

// Expected Markdown is Obsidian's, measured by pasting the same HTML into a
// throwaway vault (2026-10-17).
test("rich HTML is written as Obsidian writes it", () => {
  const cases: [string, string][] = [
    ["<ul><li>a</li><li>b<ul><li>c</li></ul></li></ul>", "- a\n- b\n    - c"],
    [
      "<ol><li>one<ol><li>sub</li></ol></li><li>two</li></ol>",
      "1. one\n    1. sub\n2. two",
    ],
    ['<ol start="3"><li>c</li><li>d</li></ol>', "3. c\n4. d"],
    ["<p>a</p><hr><p>b</p>", "a\n\n---\n\nb"],
    ['<a href="https://x.io" title="T">t</a>', '[t](https://x.io "T")'],
    [
      '<img src="https://x.io/a b.png" alt="A" title="T">',
      '![A](https://x.io/a%20b.png "T")',
    ],
    ['<a href="https://x.io/a b">sp</a>', "[sp](https://x.io/a%20b)"],
    ['<a href="https://w.org/A_(b)">wp</a>', "[wp](https://w.org/A_\\(b\\))"],
    [
      '<table><tr><th align="left">a</th><th align="right">b</th><th align="center">c</th><th style="text-align:right">d</th></tr><tr><td>1</td></tr></table>',
      "|a|b|c|d|\n|:--|--:|:-:|---|\n|1|",
    ],
  ];
  for (const [html, markdown] of cases) {
    assert.equal(markdownFromHtml(html), markdown, html);
  }
});
test("HTML conversion preserves wiki aliases, embeds, math and folded callouts", () => {
  assert.equal(
    markdownFromHtml('<a class="internal-link" data-href="Note">Alias</a>'),
    "[[Note|Alias]]",
  );
  assert.equal(
    markdownFromHtml(
      '<span class="internal-embed" data-href="pic.png"><img alt="200"></span>',
    ),
    "![[pic.png|200]]",
  );
  assert.equal(
    markdownFromHtml('<span class="math" data-tex="x+y"></span>'),
    "$x+y$",
  );
  assert.equal(
    markdownFromHtml('<div class="math-display" data-tex="x+y"></div>'),
    "$$\nx+y\n$$",
  );
  assert.equal(
    markdownFromHtml(
      '<div data-callout="note" data-callout-fold="-"><div class="callout-title-inner">Note</div><div class="callout-content"><p>Body</p></div></div>',
    ),
    "> [!note]-\n> Body",
  );
});
test("conversion drops active containers and script destinations", () => {
  assert.equal(
    markdownFromHtml(
      '<script>alert(1)</script><style>body{}</style><iframe>hidden</iframe><p>Safe <a href="javascript:alert(1)">label</a></p>',
    ),
    "Safe label",
  );
  assert.equal(
    markdownFromHtml('<img src="data:text/html,bad" alt="safe">'),
    "safe",
  );
});
function view(doc = "before") {
  let state = EditorState.create({ doc, selection: { anchor: doc.length } });
  return {
    get state() {
      return state;
    },
    dispatch(spec: Parameters<EditorState["update"]>[0]) {
      state = state.update(spec).state;
    },
  } as EditorView;
}
test("async paste applies once and rejects changed documents, selections and closed views", async () => {
  const target = view();
  assert.equal(
    await pasteTransformed({
      view: target,
      data: { html: "", text: "**after**" },
      transform: async (data) => data,
      isLive: () => true,
    }),
    true,
  );
  assert.equal(target.state.doc.toString(), "before**after**");
  for (const change of ["text", "selection", "closed"]) {
    const target = view();
    let finish!: (data: { html: string; text: string }) => void;
    const pending = pasteTransformed({
      view: target,
      data: { html: "", text: "paste" },
      transform: () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
      isLive: () => change !== "closed",
    });
    if (change === "text") {
      target.dispatch({ changes: { from: 0, insert: "typed" } });
    }
    if (change === "selection") {
      target.dispatch({ selection: { anchor: 0 } });
    }
    finish({ html: "", text: "paste" });
    assert.equal(await pending, false);
    assert.ok(!target.state.doc.toString().includes("paste"));
  }
});
test("HTML conversion is suppressed inside literal code", () => {
  for (const doc of ["`literal`", "```\nliteral\n```", "    literal"]) {
    const state = EditorState.create({
      doc,
      selection: { anchor: doc.indexOf("literal") + 2 },
      extensions: markdownLanguageSupport(),
    });
    assert.equal(acceptsHtml(state), false);
  }
});

test("HTML img data:image stays as markdown so attachments can save it", () => {
  assert.equal(
    markdownFromHtml('<img src="data:image/png;base64,aaa" alt="green">'),
    "![green](data:image/png;base64,aaa)",
  );
  assert.equal(
    markdownFromHtml('<img src="data:image/jpeg;base64,/9j/" alt="x">'),
    "![x](data:image/jpeg;base64,/9j/)",
  );
  // Non-image data URIs remain stripped (XSS).
  assert.equal(
    markdownFromHtml('<img src="data:text/html,bad" alt="safe">'),
    "safe",
  );
});

test("a pasted table cell keeps its line breaks as <br>, as Obsidian writes them", () => {
  assert.equal(
    markdownFromHtml(
      "<table><tr><th>A</th><th>B</th></tr><tr><td>one<br>two</td><td><p>p1</p><p>p2</p></td></tr></table>",
    ),
    "|A|B|\n|---|---|\n|one<br>two|p1<br><br>p2|",
  );
});

test("Google Docs text keeps its bold and italic, with no stray markers around it", () => {
  // Google Docs wraps the copy in a not-bold <b> and styles its spans.
  assert.equal(
    markdownFromHtml(
      '<meta charset="utf-8"><b style="font-weight:normal;" id="docs-internal-guid-1234"><p dir="ltr"><span style="font-weight:700;font-style:normal;">Bold</span><span style="font-weight:400;"> and plain and </span><span style="font-weight:400;font-style:italic;">italic</span><span style="font-weight:700;font-style:italic;"> both </span></p><p dir="ltr"><span style="font-weight:400">Second</span></p></b><br class="Apple-interchange-newline">',
    ),
    "**Bold** and plain and _italic_ **_both_**\n\nSecond",
  );
  // Inside real bold, a bold span adds no second pair of markers.
  assert.equal(
    markdownFromHtml(
      '<p><strong><span style="font-weight:bold">x</span></strong></p>',
    ),
    "**x**",
  );
});

test("Word list paragraphs become a Markdown list, without their literal bullets", () => {
  // Word writes each item as a paragraph with an mso-list style and its
  // bullet or number as text in an `mso-list:Ignore` span.
  const item = (list: string, level: number, marker: string, text: string) =>
    `<p class=MsoListParagraphCxSpMiddle style='text-indent:-.25in;mso-list:${list} level${level} lfo1'><span style='font-family:Symbol'><span style='mso-list:Ignore'>${marker}<span style='font:7.0pt "Times New Roman"'>&nbsp;&nbsp;&nbsp;&nbsp; </span></span></span>${text}<o:p></o:p></p>`;
  assert.equal(
    markdownFromHtml(
      "<p class=MsoNormal>Before</p>" +
        item("l0", 1, "·", "First <b>item</b>") +
        item("l0", 2, "o", "Nested") +
        item("l0", 1, "·", "Last") +
        item("l1", 1, "1.", "One") +
        item("l1", 1, "2.", "Two") +
        "<p class=MsoNormal>After</p>",
    ),
    "Before\n\n- First **item**\n    - Nested\n- Last\n\n1. One\n2. Two\n\nAfter",
  );
  // A copy whose marker is plain text before the item's own.
  assert.equal(
    markdownFromHtml(
      "<p style='mso-list:l2 level1 lfo3'>3.&nbsp;&nbsp; Third</p><p style='mso-list:l3 level1 lfo4'>·&nbsp;&nbsp; Dot</p>",
    ),
    "3. Third\n\n- Dot",
  );
});

test("preformatted text without a code element is a fenced block, as copied", () => {
  // GitHub and many documentation sites highlight with spans in a bare <pre>.
  assert.equal(
    markdownFromHtml(
      '<p>Run:</p><div class="highlight highlight-source-js"><pre><span class="pl-k">const</span> a_b = <span class="pl-s">"x*y"</span>;<br>if (a &lt; b) { [1] }\n</pre></div>',
    ),
    'Run:\n\n```js\nconst a_b = "x*y";\nif (a < b) { [1] }\n```',
  );
  assert.equal(
    markdownFromHtml("<pre>has ``` inside</pre>"),
    "````\nhas ``` inside\n````",
  );
});

test("a table nested in a cell stays in that cell, its rows written once", () => {
  const markdown = markdownFromHtml(
    "<table><thead><tr><th>A</th><th>B</th></tr></thead><tbody><tr><td>outer</td><td><table><tr><td>in1</td><td>in2</td></tr></table></td></tr><tr><td>o2</td><td>o3</td></tr></tbody></table>",
  )!;
  const lines = markdown.split("\n");
  assert.equal(lines.length, 4, markdown);
  assert.deepEqual(
    [lines[0], lines[1], lines[3]],
    ["|A|B|", "|---|---|", "|o2|o3|"],
  );
  assert.match(lines[2]!, /^\|outer\|.*in1.*in2.*\|$/);
});

test("a pasted cell spanning columns is followed by empty cells, so later cells keep their columns", () => {
  assert.equal(
    markdownFromHtml(
      '<table><tr><th colspan="2">Wide</th><th align="right">C</th></tr><tr><td>a</td><td>b</td><td>c</td></tr><tr><td colspan="3">all</td></tr></table>',
    ),
    "|Wide||C|\n|---|---|--:|\n|a|b|c|\n|all|||",
  );
});

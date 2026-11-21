import test from "node:test";
import assert from "node:assert/strict";
import {
  EditorSelection,
  EditorState,
  type Extension,
} from "@codemirror/state";
import type { DecorationSet } from "@codemirror/view";
import { search } from "@codemirror/search";
import { withFindBar } from "../support/find-bar";
import { documentTree } from "../../../src/plugins/livePreview/document-tree";
import { inlineDecorations } from "../../../src/plugins/livePreview/inline";
import { blockIndex } from "../../../src/plugins/livePreview/blocks";
import {
  editorFocus,
  setEditorFocus,
} from "../../../src/plugins/livePreview/editor-focus";
import { blockDecorations } from "../../../src/plugins/livePreview/viewport-decorations";
import {
  blockRenderers,
  inlineRenderers,
} from "../../../src/plugins/livePreview/registry";
import { wikiLinkRenderer } from "../../../src/plugins/links/webview";
import { inlineTasks } from "../../../src/plugins/tasks/webview";
import { footnoteInline } from "../../../src/plugins/footnotes/inline";
import { mathWebview } from "../../../src/plugins/math/webview";
import { embedsWebview } from "../../../src/plugins/embeds/webview";
import { calloutsWebview } from "../../../src/plugins/callouts/webview";
import { tagsWebview } from "../../../src/plugins/tags/webview";
import type { RenderService } from "../../../src/plugins/render/api";
import { fixture } from "../features/fixture";

function stateFor(
  doc: string,
  selection: EditorSelection,
  extensions: Extension = [],
) {
  return EditorState.create({
    doc,
    selection,
    extensions: [
      documentTree,
      EditorState.allowMultipleSelections.of(true),
      inlineRenderers.of(wikiLinkRenderer),
      extensions,
    ],
  });
}
function visibleSource(
  state: EditorState,
  decorations?: DecorationSet,
): string {
  const chars = state.doc.toString().split("");
  (
    decorations ?? inlineDecorations(state, [{ from: 0, to: state.doc.length }])
  ).between(0, state.doc.length, (from, to, value) => {
    if (value.point && from < to) {
      chars.fill("", from, to);
    }
  });
  return chars.join("");
}
for (const at of [0, 1, 2, 3, 4, 5, 6, 9]) {
  test(`Obsidian task: column ${at}`, () => {
    const doc = "- [ ] task";
    const state = stateFor(
      doc,
      EditorSelection.single(at),
      inlineRenderers.of(inlineTasks),
    );
    assert.equal(visibleSource(state), at <= 5 ? doc : " task");
  });
}

for (const [name, at, raw] of [
  ["first line body", 14, true],
  ["first line end", 19, true],
  ["continuation", 25, false],
  ["outside", 40, false],
] as const) {
  test(`Obsidian footnote definition: ${name}`, () => {
    const doc = "[^1]: text **b** xx\n    continued\n\nafter";
    const state = stateFor(
      doc,
      EditorSelection.single(Math.min(at, doc.length)),
      inlineRenderers.of(footnoteInline({} as RenderService)),
    );
    assert.equal(visibleSource(state).startsWith("[^1]:"), raw);
  });
}

test("Obsidian wikilinks join a chain of links and emphasis", () => {
  const doc = "aa [a](x.md)[[B]]**c** zz";
  for (let at = 0; at <= doc.length; at++) {
    const state = stateFor(doc, EditorSelection.single(at));
    assert.equal(
      visibleSource(state),
      at >= 3 && at <= doc.length - 3 ? doc : "aa aBc zz",
    );
  }
});

test("Obsidian math and embeds use the shared inline reveal rules", async () => {
  const f = fixture();
  try {
    f.root.plugin(mathWebview);
    f.root.plugin(embedsWebview);
    await f.root.settled();
    const renderers = f.view.state
      .facet(inlineRenderers)
      .map((r) => inlineRenderers.of(r));
    for (const raw of ["$x$", "$$x$$", "![[note]]", "![alt](image.png)"]) {
      for (const gap of ["", " ", "x"]) {
        const doc = `aa **b**${gap}${raw} zz`;
        // Obsidian 1.13: an image stays rendered and joins no chain.
        const image = raw.endsWith(".png)");
        for (let at = 0; at <= doc.length; at++) {
          const state = stateFor(doc, EditorSelection.single(at), renderers);
          const from = gap === "" ? 3 : 8 + gap.length;
          const isRevealed = !image && at >= from && at <= doc.length - 3;
          const chained = gap === "" && !image;
          const bold = at >= 3 && at <= (chained ? doc.length - 3 : 8);
          assert.equal(
            visibleSource(state),
            `aa ${bold ? "**b**" : "b"}${gap}${isRevealed ? raw : ""} zz`,
            `${raw}, gap '${gap}', caret ${at}`,
          );
        }
      }
      const nested = `aa **b ${raw} b** zz`;
      assert.equal(
        visibleSource(stateFor(nested, EditorSelection.single(3), renderers)),
        raw.endsWith(".png)") ? "aa **b  b** zz" : nested,
      );
    }
  } finally {
    await f.root.dispose();
  }
});

test("the find bar's match shows an image's source, as Obsidian's search highlight does", async () => {
  const f = fixture();
  try {
    f.root.plugin(embedsWebview);
    await f.root.settled();
    const inline = f.view.state
      .facet(inlineRenderers)
      .map((r) => inlineRenderers.of(r));
    const doc = "aa ![alt](image.png) zz";
    const at = doc.indexOf("image");
    const match = EditorSelection.single(at, at + "image".length);
    const state = stateFor(doc, match, [inline, search()]);
    // An image stays rendered under a selection (Obsidian 1.13) ...
    assert.equal(visibleSource(state), "aa  zz");
    // ... but not under the find bar's match.
    assert.equal(visibleSource(withFindBar(state, { search: "image" })), doc);
    const block = f.view.state
      .facet(blockRenderers)
      .find((renderer) => renderer.kind === "embed" && renderer.showSource)!;
    const alone = "![alt](image.png)";
    const sole = stateFor(alone, EditorSelection.single(7, 12), search());
    const range = { from: 0, to: alone.length, kind: "embed", source: alone };
    assert.equal(block.showSource!(sole, range), false);
    assert.equal(
      block.showSource!(withFindBar(sole, { search: "image" }), range),
      true,
    );
  } finally {
    await f.root.dispose();
  }
});

test("Obsidian callout reveals its block, only selected quote lines, and independent inline elements", async () => {
  const f = fixture();
  try {
    f.root.plugin(calloutsWebview);
    await f.root.settled();
    const blocks = blockDecorations((error) => {
      throw error;
    });
    const doc = "> [!note] Title\n> **bold** and *italic*\n> tail\n\nafter";
    const create = (at: number) =>
      stateFor(doc, EditorSelection.single(at), [
        blockIndex,
        blocks,
        f.view.state.facet(blockRenderers).map((r) => blockRenderers.of(r)),
      ]);
    let state = create(doc.length);
    assert.equal(visibleSource(state, state.field(blocks)), "\n\nafter");
    for (const [at, expected] of [
      [doc.indexOf("Title"), "> [!note] Title\nbold and italic\ntail\n\nafter"],
      [
        doc.indexOf("bold"),
        "[!note] Title\n> **bold** and italic\ntail\n\nafter",
      ],
      [doc.indexOf("tail"), "[!note] Title\nbold and italic\n> tail\n\nafter"],
    ] as const) {
      state = state.update({ selection: EditorSelection.single(at) }).state;
      assert.equal(visibleSource(state, state.field(blocks)), doc);
      assert.equal(visibleSource(state), expected);
    }
  } finally {
    await f.root.dispose();
  }
});

/** The widgets in a decoration set: `block` ones and inline ones apart. */
function widgets(set: DecorationSet): { block: number; inline: number } {
  const count = { block: 0, inline: 0 };
  set.between(0, 1e9, (_from, _to, value) => {
    if (value.spec.widget) {
      count[value.spec.block ? "block" : "inline"]++;
    }
  });
  return count;
}

/** A state that tracks focus, as the editor's does, focused or not. */
function focused(state: EditorState, hasFocus: boolean): EditorState {
  return state.update({ effects: setEditorFocus.of(hasFocus) }).state;
}

test("display math, as in Obsidian 1.15.0: focused, the whole source with the formula typeset below it; without focus, rendered", async () => {
  const f = fixture();
  try {
    f.root.plugin(mathWebview);
    await f.root.settled();
    const blocks = blockDecorations((error) => {
      throw error;
    });
    const doc = "before\n\n$$\nx + y\n$$\n\nafter";
    const closing = doc.lastIndexOf("$$") + 2;
    let state = stateFor(doc, EditorSelection.single(0), [
      editorFocus,
      search(),
      blockIndex,
      blocks,
      f.view.state.facet(blockRenderers).map((r) => blockRenderers.of(r)),
    ]);
    state = focused(state, true);
    assert.equal(
      visibleSource(state, state.field(blocks)),
      "before\n\n\n\nafter",
    );
    assert.deepEqual(widgets(state.field(blocks)), { block: 1, inline: 0 });
    for (let at = doc.indexOf("$$"); at <= closing; at++) {
      state = state.update({ selection: EditorSelection.single(at) }).state;
      assert.equal(visibleSource(state, state.field(blocks)), doc);
      const preview: number[] = [];
      state.field(blocks).between(0, doc.length, (from, _to, value) => {
        if (value.spec.widget) {
          assert.equal(value.spec.block, true);
          assert.equal(value.spec.side, 1);
          preview.push(from);
        }
      });
      assert.deepEqual(preview, [closing], `preview after $$ at ${at}`);
    }
    // Without focus the caret inside it leaves it rendered.
    state = focused(state, false);
    assert.equal(
      visibleSource(state, state.field(blocks)),
      "before\n\n\n\nafter",
    );
    assert.deepEqual(widgets(state.field(blocks)), { block: 1, inline: 0 });
    // The find bar's match in it reveals it while the find field has focus.
    state = withFindBar(
      state.update({ selection: EditorSelection.single(11, 12) }).state,
      { search: "x" },
    );
    assert.equal(visibleSource(state, state.field(blocks)), doc);
  } finally {
    await f.root.dispose();
  }
});

test("display math sharing a line with text, or unclosed, gets no preview below it", async () => {
  const f = fixture();
  try {
    f.root.plugin(mathWebview);
    await f.root.settled();
    const blocks = blockDecorations((error) => {
      throw error;
    });
    for (const doc of ["$$\nx\n$$ is famous", "$$\nx + y"]) {
      const state = stateFor(doc, EditorSelection.single(3), [
        blockIndex,
        blocks,
        f.view.state.facet(blockRenderers).map((r) => blockRenderers.of(r)),
      ]);
      assert.equal(visibleSource(state, state.field(blocks)), doc);
      assert.deepEqual(widgets(state.field(blocks)), { block: 0, inline: 0 });
    }
  } finally {
    await f.root.dispose();
  }
});

test("Obsidian tag widgets keep the literal hash and label at every caret position", async () => {
  const f = fixture();
  try {
    f.root.plugin(tagsWebview);
    await f.root.settled();
    const doc = "aa #tag zz";
    for (let at = 0; at <= doc.length; at++) {
      const state = stateFor(
        doc,
        EditorSelection.single(at),
        f.view.state.facet(inlineRenderers).map((r) => inlineRenderers.of(r)),
      );
      inlineDecorations(state, [{ from: 0, to: doc.length }]).between(
        0,
        doc.length,
        (from, to, value) => {
          if (value.point && from < to) {
            assert.equal(`#${value.spec.widget.tag}`, doc.slice(from, to));
          }
        },
      );
    }
  } finally {
    await f.root.dispose();
  }
});

test("inline chains inside task text leave the checkbox rendered", () => {
  const doc = "- [ ] **a**~~b~~";
  assert.equal(
    visibleSource(
      stateFor(doc, EditorSelection.single(8), inlineRenderers.of(inlineTasks)),
    ),
    " **a**~~b~~",
  );
});

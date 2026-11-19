import assert from "node:assert/strict";
import test from "node:test";
import { markdown } from "@codemirror/lang-markdown";
import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import {
  EditorState,
  StateEffect,
  type TransactionSpec,
} from "@codemirror/state";
import { ViewPlugin, type EditorView, type ViewUpdate } from "@codemirror/view";
import {
  isRevealFrozen,
  pointerSelection,
  revealFreezeToggled,
  setPointerSelection,
  setVisualRevealFreeze,
  visualRevealFreeze,
} from "../../webview/ui/pointer-selection";
import { CodeSource, codeSource } from "./code-source";

function fixture(freeze: "visual" | "pointer") {
  const state = EditorState.create({
    doc: "before\n\n```\ncode\n```\n\nafter",
    extensions: [markdown(), pointerSelection, visualRevealFreeze],
  });
  // Parse it all now: on a loaded machine the parser's time budget can run
  // out before the fence. The next transaction carries the complete tree.
  ensureSyntaxTree(state, state.doc.length, 10_000);
  const view = {
    state: state.update({
      effects:
        freeze === "visual"
          ? setVisualRevealFreeze.of(state.selection)
          : setPointerSelection(state.selection),
    }).state,
    visibleRanges: [{ from: 0, to: 6 }],
    composing: false,
  };
  const editorView = view as unknown as EditorView;
  const source = new CodeSource(editorView, () => {});
  return {
    view,
    source,
    update(spec: TransactionSpec = {}, viewportChanged = false) {
      const transaction = view.state.update(spec);
      view.state = transaction.state;
      const update: ViewUpdate = {
        view: editorView,
        state: transaction.state,
        startState: transaction.startState,
        transactions: [transaction],
        changes: transaction.changes,
        docChanged: transaction.docChanged,
        selectionSet: Boolean(transaction.selection),
        viewportChanged,
        viewportMoved: viewportChanged,
        heightChanged: false,
        geometryChanged: transaction.docChanged,
        focusChanged: false,
      };
      source.update(update);
      return update;
    },
  };
}

for (const freeze of ["visual", "pointer"] as const) {
  for (const selectionSet of [false, true]) {
    test(`${freeze} freeze rebuilds newly visible fences with selectionSet=${selectionSet}`, () => {
      const f = fixture(freeze);
      assert.equal(f.source.decorations.size, 0);
      f.view.visibleRanges = [{ from: 8, to: 20 }];
      const update = f.update(
        selectionSet
          ? { selection: { anchor: 0, head: f.view.state.doc.length } }
          : {},
        true,
      );
      assert.equal(isRevealFrozen(update.state), true);
      assert.equal(revealFreezeToggled(update.startState, update.state), false);
      assert.equal(update.docChanged, false);
      assert.equal(syntaxTree(update.startState), syntaxTree(update.state));
      assert.equal(f.source.decorations.size, 1);
      assert.equal(f.source.decorations.iter().from, 11);
    });
  }

  test(`${freeze} freeze skips rebuilds for selection growth alone`, (t) => {
    const f = fixture(freeze);
    f.view.visibleRanges = [{ from: 0, to: f.view.state.doc.length }];
    f.update({}, true);
    const decorations = f.source.decorations;
    const iterate = t.mock.method(syntaxTree(f.view.state), "iterate");
    f.update({ selection: { anchor: 0, head: f.view.state.doc.length } });
    assert.equal(iterate.mock.callCount(), 0);
    assert.equal(f.source.decorations, decorations);
  });

  test(`${freeze} freeze rebuilds when the syntax tree changes`, () => {
    const f = fixture(freeze);
    f.view.visibleRanges = [{ from: 8, to: 20 }];
    const update = f.update({
      effects: StateEffect.reconfigure.of([
        markdown(),
        pointerSelection,
        visualRevealFreeze,
      ]),
    });
    assert.equal(isRevealFrozen(update.state), true);
    assert.equal(revealFreezeToggled(update.startState, update.state), false);
    assert.equal(update.docChanged, false);
    assert.notEqual(syntaxTree(update.startState), syntaxTree(update.state));
    assert.equal(f.source.decorations.size, 1);
  });

  test(`${freeze} freeze rebuilds for a highlighter-ready effect`, async (t) => {
    const f = fixture(freeze);
    f.view.visibleRanges = [{ from: 8, to: 20 }];
    const define = t.mock.method(ViewPlugin, "define");
    codeSource(() => {});
    const compositionend =
      define.mock.calls[0]!.arguments[1]?.eventHandlers?.compositionend;
    assert.ok(compositionend);
    // Composition end dispatches the same ready effect as the lazy highlighter.
    compositionend.call(
      f.source,
      new Event("compositionend") as CompositionEvent,
      {
        dom: { isConnected: true },
        dispatch: (spec: TransactionSpec) => {
          const update = f.update(spec);
          assert.equal(isRevealFrozen(update.state), true);
          assert.equal(update.selectionSet, false);
          assert.equal(update.viewportChanged, false);
          assert.equal(syntaxTree(update.startState), syntaxTree(update.state));
        },
      } as unknown as EditorView,
    );
    await Promise.resolve();
    assert.equal(f.source.decorations.size, 1);
  });
}

test("composition maps existing decorations even when the viewport changes", () => {
  const f = fixture("visual");
  f.view.visibleRanges = [{ from: 0, to: f.view.state.doc.length }];
  f.update({}, true);
  const decoration = f.source.decorations.iter().value;
  f.view.composing = true;
  f.update({ changes: { from: 0, insert: "prefix " } }, true);
  const mapped = f.source.decorations.iter();
  assert.equal(mapped.from, 18);
  assert.equal(mapped.value, decoration);
});

test("an edit above a fence reuses its highlighting instead of tokenising it again", () => {
  const state = EditorState.create({
    doc: "before\n\n```js\nlet x = 1;\n```\n\nafter",
    extensions: [markdown()],
  });
  ensureSyntaxTree(state, state.doc.length, 10_000);
  const view = {
    state: state.update({}).state,
    visibleRanges: [{ from: 0, to: state.doc.length }],
    composing: false,
    dom: { isConnected: true },
  };
  const editorView = view as unknown as EditorView;
  const source = new CodeSource(editorView, () => {});
  const tokenised: string[] = [];
  Object.assign(source, {
    highlighter: {
      tokenRanges(text: string) {
        tokenised.push(text);
        return [{ from: 0, to: 3, classes: "token keyword" }];
      },
    },
    languageLoads: new Map([["js", "ready"]]),
  });
  const apply = (spec: TransactionSpec) => {
    const transaction = view.state.update(spec);
    view.state = transaction.state;
    view.visibleRanges = [{ from: 0, to: transaction.state.doc.length }];
    source.update({
      view: editorView,
      state: transaction.state,
      startState: transaction.startState,
      transactions: [transaction],
      changes: transaction.changes,
      docChanged: transaction.docChanged,
      selectionSet: false,
      viewportChanged: true,
      viewportMoved: false,
      heightChanged: false,
      geometryChanged: transaction.docChanged,
      focusChanged: false,
    } as ViewUpdate);
  };
  apply({});
  assert.deepEqual(tokenised, ["let x = 1;"]);
  apply({ changes: { from: 0, insert: "more text " } });
  assert.deepEqual(tokenised, ["let x = 1;"]);
  // The keyword mark moved with the fence.
  const marks: string[] = [];
  source.decorations.between(0, view.state.doc.length, (from, to, value) => {
    if (value.spec.class === "token keyword") {
      marks.push(view.state.sliceDoc(from, to));
    }
  });
  assert.deepEqual(marks, ["let"]);
  // An edit inside the fence tokenises it again.
  const inside = view.state.doc.toString().indexOf("1;");
  apply({ changes: { from: inside, insert: "4" } });
  assert.deepEqual(tokenised, ["let x = 1;", "let x = 41;"]);
});

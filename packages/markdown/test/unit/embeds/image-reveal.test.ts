import test from "node:test";
import assert from "node:assert/strict";
import {
  EditorSelection,
  EditorState,
  type Extension,
  type TransactionSpec,
} from "@codemirror/state";
import type { DecorationSet, EditorView } from "@codemirror/view";
import { documentTree } from "../../../src/plugins/livePreview/document-tree";
import { inlineDecorations } from "../../../src/plugins/livePreview/inline";
import { blockIndex } from "../../../src/plugins/livePreview/blocks";
import { blockDecorations } from "../../../src/plugins/livePreview/viewport-decorations";
import {
  editorFocus,
  setEditorFocus,
} from "../../../src/plugins/livePreview/editor-focus";
import {
  blockRenderers,
  inlineRenderers,
} from "../../../src/plugins/livePreview/registry";
import {
  pointerSelection,
  setPointerSelection,
} from "../../../src/webview/ui/pointer-selection";
import { embedsWebview } from "../../../src/plugins/embeds/webview";
import {
  editingImage,
  imageKeyFromEvent,
  runSelectedImageKey,
  selectedImage,
  selectImage,
} from "../../../src/plugins/embeds/image-selection";
import {
  escapeBlock,
  verticalBlock,
} from "../../../src/plugins/livePreview/motion";
import { fixture } from "../features/fixture";

type Renderers = Extension;

/**
 * Runs `check` with the embeds plugin's Live Preview renderers, taken from
 * a running plugin; they read the state they are given, not the fixture's.
 */
async function withRenderers(
  check: (renderers: Renderers) => void,
): Promise<void> {
  const f = fixture();
  try {
    f.root.plugin(embedsWebview);
    await f.root.settled();
    check([
      ...f.view.state.facet(inlineRenderers).map((r) => inlineRenderers.of(r)),
      ...f.view.state.facet(blockRenderers).map((r) => blockRenderers.of(r)),
    ]);
  } finally {
    await f.root.dispose();
  }
}

const blocks = blockDecorations((error) => {
  throw error;
});

function editorState(
  renderers: Renderers,
  doc: string,
  selection: EditorSelection,
  options: { hasFocus?: boolean; extensions?: Extension } = {},
): EditorState {
  return EditorState.create({
    doc,
    selection,
    extensions: [
      documentTree,
      EditorState.allowMultipleSelections.of(true),
      editorFocus,
      pointerSelection,
      blockIndex,
      blocks,
      renderers,
      options.extensions ?? [],
    ],
  }).update({ effects: setEditorFocus.of(options.hasFocus ?? true) }).state;
}

interface Drawing {
  /** The note's text as painted: replaced ranges removed. */
  text: string;
  /** Where each image drawn after its source stands, and how. */
  previews: string[];
}

/** What the inline and block decorations paint. */
function drawing(state: EditorState): Drawing {
  const chars = state.doc.toString().split("");
  const previews: string[] = [];
  const read = (set: DecorationSet) =>
    set.between(0, state.doc.length, (from, to, value) => {
      if (!value.point) {
        return;
      }
      if (from < to) {
        chars.fill("", from, to);
      } else if (value.spec.widget) {
        previews.push(`${value.spec.block ? "block" : "inline"} at ${from}`);
      }
    });
  read(inlineDecorations(state, [{ from: 0, to: state.doc.length }]));
  read(state.field(blocks));
  return { text: chars.join(""), previews: previews.sort() };
}

test("an image in a line of text shows its source under the caret, and the image just after it", () =>
  withRenderers((renderers) => {
    for (const raw of ["![[a.png|100]]", "![alt](a.png)"]) {
      const doc = `aa ${raw} zz`;
      const from = 3;
      const to = from + raw.length;
      for (let at = 0; at <= doc.length; at++) {
        const state = editorState(renderers, doc, EditorSelection.single(at));
        const isTouched = at >= from && at <= to;
        assert.deepEqual(
          drawing(state),
          isTouched
            ? { text: doc, previews: [`inline at ${to}`] }
            : { text: "aa  zz", previews: [] },
          `${raw}, caret ${at}`,
        );
      }
    }
  }));

test("an image alone on its line shows its source, and the image as a block below it", () =>
  withRenderers((renderers) => {
    for (const raw of ["![[a.png]]", "![[a.png|100]]", "![alt](a.png)"]) {
      // Trailing spaces belong to the block: a caret there reveals it too.
      const doc = `before\n\n${raw}  \n\nafter`;
      const from = doc.indexOf("!");
      const lineEnd = from + raw.length + 2;
      for (let at = 0; at <= doc.length; at++) {
        const state = editorState(renderers, doc, EditorSelection.single(at));
        const result = drawing(state);
        if (at >= from && at <= lineEnd) {
          assert.equal(result.text, doc, `${raw}, caret ${at}`);
          assert.equal(result.previews.length, 1, `${raw}, caret ${at}`);
          assert.match(result.previews[0]!, /^block at /u);
        } else {
          assert.equal(result.text.includes(raw), false, `${raw}, caret ${at}`);
          assert.deepEqual(result.previews, [], `${raw}, caret ${at}`);
        }
      }
    }
  }));

test("an image's source stays shown when the focus leaves the editor (for its inspector), so its drawing is not replaced", () =>
  withRenderers((renderers) => {
    for (const doc of ["aa ![[a.png]] zz", "![[a.png]]"]) {
      const at = doc.indexOf("a.png");
      const focused = editorState(renderers, doc, EditorSelection.single(at));
      const unfocused = focused.update({
        effects: setEditorFocus.of(false),
      }).state;
      assert.deepEqual(drawing(unfocused), drawing(focused), doc);
      assert.equal(drawing(unfocused).text, doc, doc);
    }
  }));

test("images join chains of abutting elements and follow selections and several carets", () =>
  withRenderers((renderers) => {
    const chained = "aa **b**![[a.png]] zz";
    // The caret in the bold text reveals the image it abuts, and back.
    for (const at of [4, chained.indexOf("a.png")]) {
      assert.deepEqual(
        drawing(editorState(renderers, chained, EditorSelection.single(at))),
        { text: chained, previews: [`inline at ${chained.indexOf(" zz")}`] },
      );
    }
    const three = "![[a.png]] x ![[b.png]] y ![[c.png]] z";
    const end = (name: string) => three.indexOf(`${name}.png]]`) + 7;
    // A selection over a and b reveals both; c stays drawn.
    const selected = drawing(
      editorState(renderers, three, EditorSelection.single(2, end("b") - 3)),
    );
    assert.equal(selected.text, "![[a.png]] x ![[b.png]] y  z");
    assert.deepEqual(selected.previews, [
      `inline at ${end("a")}`,
      `inline at ${end("b")}`,
    ]);
    // A caret in a and one in c reveal those two.
    const carets = drawing(
      editorState(
        renderers,
        three,
        EditorSelection.create([
          EditorSelection.cursor(3),
          EditorSelection.cursor(end("c") - 3),
        ]),
      ),
    );
    assert.equal(carets.text, "![[a.png]] x  y ![[c.png]] z");
    assert.deepEqual(carets.previews, [
      `inline at ${end("a")}`,
      `inline at ${end("c")}`,
    ]);
  }));

test("an embedded note still shows only its source under the caret", () =>
  withRenderers((renderers) => {
    for (const doc of ["aa ![[note]] zz", "![[note]]"]) {
      const state = editorState(
        renderers,
        doc,
        EditorSelection.single(doc.indexOf("note")),
        { hasFocus: false },
      );
      assert.deepEqual(drawing(state), { text: doc, previews: [] }, doc);
    }
  }));

test("a click keeps the image drawn while the button is down and shows its source on release", () =>
  withRenderers((renderers) => {
    const doc = "before\n\n![[a.png]]\n\nafter";
    const image = { from: doc.indexOf("!"), to: doc.indexOf("]]") + 2 };
    let state = editorState(renderers, doc, EditorSelection.single(0), {
      extensions: [selectedImage, editingImage],
    });
    const drawn = drawing(state);
    // The press freezes reveal at the selection from before it ...
    state = state.update({
      effects: setPointerSelection(state.selection),
    }).state;
    state = state.update({
      selection: { anchor: image.from },
      effects: selectImage.of(image),
    }).state;
    assert.deepEqual(drawing(state), drawn);
    // ... and the release shows the source, the image below it.
    state = state.update({ effects: setPointerSelection(null) }).state;
    assert.deepEqual(state.field(selectedImage), image);
    assert.deepEqual(drawing(state), {
      text: doc,
      previews: [`block at ${image.to}`],
    });
  }));

/**
 * A view over a state, enough for the selected image's keys: one image in
 * a line of text, drawn just after its shown source.
 */
function viewOf(initial: EditorState, width: number) {
  let state = initial;
  const view = {
    get state() {
      return state;
    },
    dispatch(spec: TransactionSpec) {
      state = state.update(spec).state;
    },
    scaleX: 1,
    contentDOM: {
      clientWidth: 800,
      querySelectorAll: () => [
        {
          classList: { contains: () => false },
          parentElement: { classList: { contains: () => false } },
          closest: (selector: string) =>
            [".cm-line", ".md-image-after-source"].includes(selector)
              ? {}
              : null,
          getBoundingClientRect: () => ({ width }),
        },
      ],
    },
    // Its widget stands at the embed's end.
    posAtDOM: () => state.doc.toString().indexOf("]]") + 2,
  };
  return view as unknown as EditorView & { state: EditorState };
}

test("with its source shown, a selected image still resizes, and the caret stays at its start", () =>
  withRenderers((renderers) => {
    const original = globalThis.getComputedStyle;
    globalThis.getComputedStyle = (() => ({
      paddingLeft: "0",
      paddingRight: "0",
    })) as unknown as typeof getComputedStyle;
    try {
      const doc = "aa ![[a.png|100]] zz";
      const image = { from: 3, to: 3 + "![[a.png|100]]".length };
      const state = editorState(
        renderers,
        doc,
        EditorSelection.single(image.from),
        { extensions: [selectedImage, editingImage] },
      ).update({ effects: selectImage.of(image) }).state;
      const view = viewOf(state, 100);
      assert.equal(drawing(view.state).text, doc);
      for (const [key, source] of [
        ["+", "![[a.png|125]]"],
        ["=", "![[a.png|150]]"],
        ["-", "![[a.png|125]]"],
        ["0", "![[a.png]]"],
      ] as const) {
        assert.equal(runSelectedImageKey(view, key), true, key);
        const after = view.state;
        assert.equal(after.doc.toString(), `aa ${source} zz`, key);
        assert.equal(after.selection.main.head, image.from, key);
        assert.deepEqual(after.field(selectedImage), {
          from: image.from,
          to: image.from + source.length,
        });
        // The source stays shown, the image after it.
        assert.deepEqual(drawing(after), {
          text: after.doc.toString(),
          previews: [`inline at ${image.from + source.length}`],
        });
      }
    } finally {
      globalThis.getComputedStyle = original;
    }
  }));

test("arrow keys select no image: they move through its shown source, as through a link's", () => {
  for (const key of ["ArrowRight", "ArrowLeft"]) {
    assert.equal(
      imageKeyFromEvent({
        key,
        code: key,
        shiftKey: false,
        ctrlKey: false,
        altKey: false,
        metaKey: false,
      }),
      undefined,
    );
  }
  const image = { from: 3, to: 13 };
  let state = EditorState.create({
    doc: "aa ![[a.png]] zz",
    selection: { anchor: image.from },
    extensions: [selectedImage, editingImage],
  });
  state = state.update({ effects: selectImage.of(image) }).state;
  const view = {
    get state() {
      return state;
    },
    dispatch(spec: TransactionSpec) {
      state = state.update(spec).state;
    },
  } as unknown as EditorView;
  // CodeMirror's own motion runs, and moving the caret lets the image go.
  assert.equal(runSelectedImageKey(view, "ArrowRight"), false);
  assert.equal(runSelectedImageKey(view, "ArrowLeft"), false);
  state = state.update({ selection: { anchor: image.from + 1 } }).state;
  assert.equal(state.field(selectedImage), null);
});

test("Up and Down enter an image alone on its line at its source line, and Escape leaves it", () =>
  withRenderers((renderers) => {
    const doc = "before\n\n![[a.png]]  \n\nafter";
    const from = doc.indexOf("!");
    const line = (at: number) =>
      editorState(renderers, doc, EditorSelection.single(at));
    // From the blank line above, Down lands at the start of its source line.
    assert.equal(verticalBlock(line(from - 1), 1), from);
    // From the blank line below, Up lands at the start of its last line.
    assert.equal(verticalBlock(line(from + 13), -1), from);
    // With the source shown, the caret leaves by plain motion ...
    assert.equal(verticalBlock(line(from + 3), 1), undefined);
    assert.equal(verticalBlock(line(from + 3), -1), undefined);
    // ... and Escape moves it to the line after the block.
    assert.equal(escapeBlock(line(from + 3)), from + 13);
  }));

test("Up and Down enter an image alone after a list, quote or indentation prefix at the image, revealing it", () =>
  withRenderers((renderers) => {
    for (const prefix of ["- ", "1. ", "> ", "  "]) {
      const doc = `before\n\n${prefix}![[a.png]]\n\nafter`;
      const from = doc.indexOf("!");
      const lineEnd = from + "![[a.png]]".length;
      const at = (head: number) =>
        editorState(renderers, doc, EditorSelection.single(head));
      for (const [start, direction] of [
        [from - prefix.length - 1, 1],
        [lineEnd + 1, -1],
      ] as const) {
        const target = verticalBlock(at(start), direction);
        assert.equal(target, from, `${prefix}, ${direction}`);
        const entered = drawing(at(target!));
        assert.equal(entered.text.includes("![[a.png]]"), true, prefix);
        assert.deepEqual(entered.previews, [`block at ${lineEnd}`], prefix);
        // From there, Escape leaves it for the next line.
        assert.equal(escapeBlock(at(target!)), lineEnd + 1, prefix);
      }
    }
  }));

test("an image in a task item stays in its line: plain motion reaches it, and its source shows with the image after it", () =>
  withRenderers((renderers) => {
    const doc = "before\n\n- [ ] ![[a.png]]\n\nafter";
    const from = doc.indexOf("!");
    const to = from + "![[a.png]]".length;
    const at = (head: number) =>
      editorState(renderers, doc, EditorSelection.single(head));
    assert.equal(verticalBlock(at(from - 7), 1), undefined);
    assert.equal(verticalBlock(at(to + 1), -1), undefined);
    const shown = drawing(at(from));
    assert.equal(shown.text.includes("![[a.png]]"), true);
    assert.deepEqual(shown.previews, [`inline at ${to}`]);
  }));

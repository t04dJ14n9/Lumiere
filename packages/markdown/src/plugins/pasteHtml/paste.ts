import { syntaxTree } from "@codemirror/language";
import {
  ChangeSet,
  type ChangeSpec,
  type EditorState,
  type Text,
} from "@codemirror/state";
import { ViewPlugin, type EditorView } from "@codemirror/view";
import { difference } from "../../shared/document/wire";
import type { PasteData } from "./api";
export function acceptsHtml(state: EditorState): boolean {
  let node = syntaxTree(state).resolveInner(state.selection.main.from, 1);
  for (;;) {
    if (["FencedCode", "CodeBlock", "InlineCode"].includes(node.name)) {
      return false;
    }
    if (!node.parent) {
      return true;
    }
    node = node.parent;
  }
}
/**
 * Paste `data` once its asynchronous transforms (image imports can take
 * 45 s) are done. Typing meanwhile does not lose the paste, whose files the
 * host has already saved: it goes where it was made, mapped through the
 * edits since, and never over text the reader wrote. Nothing is written
 * into a view that has closed.
 */
export async function pasteTransformed(options: {
  view: EditorView;
  data: PasteData;
  transform(data: PasteData): Promise<PasteData>;
  isLive(): boolean;
}): Promise<boolean> {
  const { view, data, transform, isLive } = options;
  const before = view.state;
  const edits = editsSince(view);
  let result: PasteData;
  try {
    result = await transform(data);
  } finally {
    edits.stop();
  }
  if (!isLive()) {
    return false;
  }
  if (
    view.state.doc === before.doc &&
    view.state.selection.eq(before.selection)
  ) {
    view.dispatch({
      ...view.state.replaceSelection(result.text),
      userEvent: "input.paste",
      scrollIntoView: true,
    });
    return true;
  }
  const now = view.state.doc;
  view.dispatch({
    changes: mappedPaste({
      before,
      now,
      // A view without the tracker (a table cell's editor) is compared
      // instead; its text is one cell.
      edits:
        edits.changes() ?? difference(before.doc.toString(), now.toString()),
      text: result.text,
    }),
    userEvent: "input.paste",
  });
  return true;
}

/**
 * The paste's changes in `now` for the selection it was made over in
 * `before`. A range keeps being replaced only while it still holds the same
 * text; one the reader edited takes the paste before their edit instead.
 */
function mappedPaste(options: {
  before: EditorState;
  now: Text;
  edits: ChangeSet;
  text: string;
}): ChangeSpec[] {
  const { before, now, edits, text } = options;
  return before.selection.ranges.map((range) => {
    // assoc -1: text typed at the caret comes after the paste made there.
    const from = edits.mapPos(range.from, -1);
    const to = edits.mapPos(range.to, -1);
    const selected = before.doc.sliceString(range.from, range.to);
    const isIntact =
      to - from === selected.length && now.sliceString(from, to) === selected;
    return { from, to: isIntact ? to : from, insert: text };
  });
}

/** Views whose edits reach pending pastes, with those pastes' listeners. */
const trackedViews = new WeakMap<EditorView, Set<(edits: ChangeSet) => void>>();

/**
 * Reports a view's edits to its pending pastes, so a paste maps its place
 * through exactly what was typed (a text comparison can merge two nearby
 * edits and misplace it).
 */
export const pasteEditTracker = ViewPlugin.define((view) => {
  trackPasteEdits(view);
  return {
    update(update) {
      if (update.docChanged) {
        reportPasteEdits(update.view, update.changes);
      }
    },
    destroy() {
      trackedViews.delete(view);
    },
  };
});

export function trackPasteEdits(view: EditorView): void {
  trackedViews.set(view, new Set());
}

export function reportPasteEdits(view: EditorView, edits: ChangeSet): void {
  for (const listener of trackedViews.get(view) ?? []) {
    listener(edits);
  }
}

/** The edits made to `view` from now until `stop`, if they are tracked. */
function editsSince(view: EditorView): {
  changes(): ChangeSet | undefined;
  stop(): void;
} {
  const listeners = trackedViews.get(view);
  if (!listeners) {
    return { changes: () => undefined, stop() {} };
  }
  let combined = ChangeSet.empty(view.state.doc.length);
  const listener = (edits: ChangeSet) => {
    combined = combined.compose(edits);
  };
  listeners.add(listener);
  return { changes: () => combined, stop: () => listeners.delete(listener) };
}

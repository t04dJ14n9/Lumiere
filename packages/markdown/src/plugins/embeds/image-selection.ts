import { syntaxTree } from "@codemirror/language";
import {
  Prec,
  StateEffect,
  StateField,
  type EditorState,
  type Extension,
} from "@codemirror/state";
import { ViewPlugin, keymap, type EditorView } from "@codemirror/view";
import { embedsNote } from "./clicks";
import { IMAGE_EMBED } from "./embed-actions";
import {
  aliasRange,
  steppedWidth,
  targetRange,
  withWidth,
  writtenWidth,
} from "./image-size";
import {
  isSelectableImage,
  setImageSelectedChrome,
} from "./image-resize-corner";
import { imageKeyFromEvent } from "./image-selection-keys";
import { ClickedImagePin } from "./image-click-pin";

export { imageKeyFromEvent } from "./image-selection-keys";

interface Range {
  from: number;
  to: number;
}

export const selectImage = StateEffect.define<Range | null>();
export const editImage = StateEffect.define<Range | null>();

/**
 * The image being edited (Enter or Tab on a selected image), until the
 * caret leaves it, so that Escape selects it again. Its source shows
 * anyway while the caret touches it (`image-reveal.ts`).
 */
export const editingImage = StateField.define<Range | null>({
  create: () => null,
  update(value, transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(editImage)) {
        return effect.value;
      }
    }
    if (!value) {
      return null;
    }
    const from = transaction.changes.mapPos(value.from, -1);
    const to = transaction.changes.mapPos(value.to, 1);
    const head = transaction.state.selection.main.head;
    return head >= from && head <= to ? { from, to } : null;
  },
});

/**
 * The image embed a click selected, as Obsidian 1.13 selects images: its
 * source, which shows while it is selected (the caret is at its start).
 * Any other edit or move of the caret lets it go.
 */
export const selectedImage = StateField.define<Range | null>({
  create: () => null,
  update(value, transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(selectImage)) {
        return effect.value;
      }
    }
    return value && !transaction.docChanged && !transaction.selection
      ? value
      : null;
  },
});

/** The image embeds (`![[a.png]]`, `![](a.png)`) on the line holding `at`. */
function imagesOnLine(state: EditorState, at: number): Range[] {
  const line = state.doc.lineAt(at);
  const found: Range[] = [];
  syntaxTree(state).iterate({
    from: line.from,
    to: line.to,
    enter(node) {
      if (!["WikiEmbed", "Image"].includes(node.name)) {
        return true;
      }
      if (!embedsNote(state.sliceDoc(node.from, node.to))) {
        found.push({ from: node.from, to: node.to });
      }
      return false;
    },
  });
  return found;
}

/** The image embed drawn at `at`: the one around it, else the next on its line. */
function embedAt(state: EditorState, at: number): Range | undefined {
  const images = imagesOnLine(state, at);
  return (
    images.find((range) => at >= range.from && at <= range.to) ??
    images.find((range) => range.from >= at)
  );
}

/**
 * The rendered images of the selected embed: those drawn at its source (a
 * block's image may report its block's start or end).
 */
export function imagesOf(view: EditorView, range: Range): HTMLImageElement[] {
  return [...view.contentDOM.querySelectorAll("img")].filter((image) => {
    try {
      const at = isSelectableImage(image) ? view.posAtDOM(image) : -1;
      return at >= range.from && at <= range.to;
    } catch {
      return false;
    }
  });
}

/**
 * A click on an image selects it, the caret at its start, as in Obsidian.
 * Returns what it selected.
 */
function selectOnClick(
  view: EditorView,
  event: MouseEvent,
): { image: HTMLImageElement; range: Range } | undefined {
  const image =
    event.target instanceof HTMLImageElement ? event.target : undefined;
  if (
    !image ||
    !isSelectableImage(image) ||
    event.button !== 0 ||
    event.shiftKey ||
    event.metaKey ||
    event.ctrlKey ||
    event.altKey ||
    image.closest(
      "a, button, .hybrid-Callout, .hybrid-Blockquote, .hybrid-BulletList, .hybrid-OrderedList, .cm-table-widget",
    )
  ) {
    return undefined;
  }
  const range = embedAt(view.state, view.posAtDOM(image));
  if (!range) {
    return undefined;
  }
  event.preventDefault();
  event.stopPropagation();
  view.focus();
  view.dispatch({
    selection: { anchor: range.from },
    effects: selectImage.of(range),
  });
  return { image, range };
}

/** The widest an image can be: the width of the note's text. */
function maxWidth(view: EditorView): number {
  const style = getComputedStyle(view.contentDOM);
  return (
    view.contentDOM.clientWidth -
    parseFloat(style.paddingLeft) -
    parseFloat(style.paddingRight)
  );
}

function resize(view: EditorView, change: 1 | -1 | 0): boolean {
  const range = view.state.field(selectedImage);
  if (!range) {
    return false;
  }
  const source = view.state.sliceDoc(range.from, range.to);
  let width: number | undefined;
  if (change !== 0) {
    // The image as shown (a hidden placeholder may share its source).
    const shown = Math.max(
      0,
      ...imagesOf(view, range).map(
        (image) => image.getBoundingClientRect().width,
      ),
    );
    const current = writtenWidth(source) ?? shown / view.scaleX;
    width = steppedWidth(current, change, maxWidth(view));
  }
  const insert = withWidth(source, width);
  view.dispatch({
    changes: { from: range.from, to: range.to, insert },
    effects: selectImage.of({
      from: range.from,
      to: range.from + insert.length,
    }),
  });
  return true;
}

/** Enter selects the file name; Tab selects the alias / size segment. */
function editSource(view: EditorView, part: "target" | "alias"): boolean {
  const range = view.state.field(selectedImage);
  if (!range) {
    return false;
  }
  const source = view.state.sliceDoc(range.from, range.to);
  const segment = part === "target" ? targetRange(source) : aliasRange(source);
  if (!segment) {
    return false;
  }
  view.dispatch({
    selection: {
      anchor: range.from + segment.from,
      head: range.from + segment.to,
    },
    effects: editImage.of(range),
  });
  return true;
}

function remove(view: EditorView): boolean {
  const range = view.state.field(selectedImage);
  if (!range) {
    return false;
  }
  view.dispatch({
    changes: { from: range.from, to: range.to },
    selection: { anchor: range.from },
  });
  return true;
}

/**
 * The inspect control Obsidian opens with Space on a selected image (REA
 * showSelectedImage → lightbox). Lumiere's frosted-bar ⤢ / inspector is the
 * host equivalent.
 */
export function inspectButtonBesideImage(
  image: HTMLImageElement,
): HTMLButtonElement | null {
  const host = image.closest(`.${IMAGE_EMBED}`) ?? image.parentElement ?? image;
  // querySelector already requires button.inspect-image; cast for stubs/jsdom.
  return host.querySelector("button.inspect-image") as HTMLButtonElement | null;
}

/** Space on a selected image opens its inspector, as Obsidian's Space does. */
function inspectSelected(view: EditorView): boolean {
  const range = view.state.field(selectedImage);
  if (!range) {
    return false;
  }
  const image = imagesOf(view, range)[0];
  if (!image) {
    return false;
  }
  const button = inspectButtonBesideImage(image);
  if (!button) {
    return false;
  }
  button.click();
  return true;
}

/**
 * Escape: leave source edit and re-select (Obsidian exitImageEdit), or clear
 * a selected outline. Enter/Tab clear selectedImage when they move the caret
 * into the source, so Escape must check editingImage first.
 */
export function escapeImage(view: EditorView): boolean {
  const editing = view.state.field(editingImage);
  if (editing) {
    view.dispatch({
      selection: { anchor: editing.from },
      effects: [editImage.of(null), selectImage.of(editing)],
    });
    return true;
  }
  if (!view.state.field(selectedImage)) {
    return false;
  }
  view.dispatch({ effects: selectImage.of(null) });
  return true;
}

/**
 * Run the selected-image action for a keymap id. Used by the CM keymap and by
 * a capture-phase keydown so @replit/codemirror-vim (domEventHandlers) cannot
 * swallow Space / `=` / … while an image is selected (BH-006).
 */
export function runSelectedImageKey(view: EditorView, key: string): boolean {
  switch (key) {
    case "+":
    case "=":
      return resize(view, 1);
    case "-":
      return resize(view, -1);
    case "0":
      return resize(view, 0);
    case "Space":
      return inspectSelected(view);
    case "Enter":
      return editSource(view, "target");
    case "Tab":
      return editSource(view, "alias");
    case "Backspace":
    case "Delete":
      return remove(view);
    case "Escape":
      return escapeImage(view);
    default:
      return false;
  }
}

/** Apply / clear Obsidian selected-image chrome for the current range. */
function syncSelectedChrome(
  view: EditorView,
  marked: HTMLImageElement[],
): HTMLImageElement[] {
  const range = view.state.field(selectedImage);
  const images = range ? imagesOf(view, range) : [];
  for (const image of marked) {
    if (!images.includes(image)) {
      setImageSelectedChrome(image, false);
    }
  }
  for (const image of images) {
    setImageSelectedChrome(image, true);
  }
  // Outline only — a caret at the embed paints a tall bar below (height).
  if (images.length) {
    view.dom.dataset.mwImageSelected = "";
  } else {
    delete view.dom.dataset.mwImageSelected;
  }
  return images;
}

/**
 * Capture-phase keydown so Vim's domEventHandler cannot swallow Space/= while
 * an image is selected (BH-006). CM Prec.highest keymap alone is too late.
 */
function captureSelectedImageKeydown(
  view: EditorView,
  event: KeyboardEvent,
): void {
  if (
    event.defaultPrevented ||
    event.isComposing ||
    event.target !== view.contentDOM
  ) {
    return;
  }
  const selected = view.state.field(selectedImage);
  const editing = view.state.field(editingImage);
  if (!selected && !editing) {
    return;
  }
  const key = imageKeyFromEvent(event);
  if (!key) {
    return;
  }
  // Source edit: only Escape is ours; Space must insert a space.
  if (editing && !selected && key !== "Escape") {
    return;
  }
  if (!runSelectedImageKey(view, key)) {
    return;
  }
  event.preventDefault();
  event.stopImmediatePropagation();
}

/** Shows which image is selected. */
const selectedClass = ViewPlugin.define((view) => {
  let marked: HTMLImageElement[] = [];
  const mark = () => {
    marked = syncSelectedChrome(view, marked);
  };
  // Resized images redraw once the file loads — remake chrome then.
  const redrawn = new MutationObserver(() => {
    if (view.state.field(selectedImage) || marked.length) {
      mark();
    }
  });
  redrawn.observe(view.contentDOM, { childList: true, subtree: true });
  const pin = new ClickedImagePin(view, (range) => imagesOf(view, range));
  const onClick = (event: MouseEvent) => {
    const selected = selectOnClick(view, event);
    if (selected) {
      pin.press(selected.image, selected.range);
    }
  };
  const onKeydown = (event: KeyboardEvent) =>
    captureSelectedImageKeydown(view, event);
  view.contentDOM.addEventListener("mousedown", onClick, { capture: true });
  view.contentDOM.addEventListener("keydown", onKeydown, true);
  return {
    update(update) {
      pin.update(update);
      const before = update.startState.field(selectedImage);
      const after = update.state.field(selectedImage);
      if (before !== after || (after && update.docChanged)) {
        view.requestMeasure({ read: () => null, write: mark });
      }
    },
    destroy() {
      redrawn.disconnect();
      view.contentDOM.removeEventListener("mousedown", onClick, {
        capture: true,
      });
      view.contentDOM.removeEventListener("keydown", onKeydown, true);
      for (const image of marked) {
        setImageSelectedChrome(image, false);
      }
      delete view.dom.dataset.mwImageSelected;
    },
  };
});

/**
 * Selecting and editing images in Live Preview, as Obsidian 1.13 does
 * (measured): a click selects an image, its source shown above or before
 * it (Obsidian 1.12's reveal, owner request 2026-11-21; arrow keys move
 * through that source as through a link's, so they select nothing); then
 * `+`/`=` and `-` resize it in steps of 25 pixels, `0` resets its size, Space opens the inspector (Obsidian lightbox), Enter selects
 * its file name, Tab selects its alias / size segment (Obsidian
 * `editSelectedImageAlias`), Backspace or Delete removes it, and Escape
 * leaves source edit (re-selecting) or clears the outline. Selection also
 * paints Obsidian's `.image-resize-corner` chevron chrome (CSS);
 * drag-to-resize is still `+`/`-` only. Keys also bind in a capture-phase
 * keydown so Vim cannot swallow them while the image is selected (BH-006).
 */
export function imageSelection(): Extension {
  return [
    selectedImage,
    editingImage,
    selectedClass,
    Prec.highest(
      keymap.of(
        "+ = - 0 Space Enter Tab Backspace Delete Escape"
          .split(" ")
          .map((key) => ({
            key,
            run: (view: EditorView) => runSelectedImageKey(view, key),
          })),
      ),
    ),
  ];
}

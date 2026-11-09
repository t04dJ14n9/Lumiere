import type { TextLayout } from "@embedpdf/engine";
import { StageToken } from "@embedpdf/plugin-stage/contract";
import { useOptionalCapability } from "@embedpdf/react/runtime";
import { useCallback, useEffect, useRef } from "react";
import { coreWord } from "../shared/look-up";
import { postToHost } from "./host";
import { lookUpPageAt } from "./look-up-pages";
import { setLookUpTarget, type LookUpTarget } from "./look-up-target";
import { charBox, unionBounds } from "./text-boxes";
import { useTextAccess, type TextAccess } from "./text-access";

/** How often the word under the pointer is looked for while it moves. */
const HOVER_MS = 120;

/** How far outside a glyph's box (points) the pointer still counts as on it. */
const GLYPH_SLACK = 0.5;

/**
 * macOS Look Up. The page text is drawn as images, so the system's own Look
 * Up (a force click, or a three-finger tap) has no text to find. Three
 * triggers are wired:
 *
 * - the word under the pointer is put in the page as hidden text
 *   (look-up-word.tsx), so the system's own Look Up finds it and shows its
 *   Dictionary popover. This is how a hard press works in VS Code and
 *   Cursor: Chromium tells a webpage nothing about the force of a click.
 * - `webkitmouseforcedown`, WebKit's force click event: look the word up at
 *   once in the Dictionary app.
 * - the context menu: the word under the pointer is reported when it opens,
 *   so its Look Up entry knows which word to open.
 *
 * Off until the extension says it is on (`lookUp` host message).
 */
export function useLookUp(enabled: boolean): () => void {
  const text = useTextAccess();
  const stage = useOptionalCapability(StageToken);
  const command = useRef<(() => void) | undefined>(undefined);
  useEffect(() => {
    if (!enabled || !text) {
      return;
    }
    const binding = new LookUpBinding(new PageWords(text));
    command.current = binding.open;
    // The pages move under a still pointer with the camera, not by scrolling:
    // the Stage's viewport never scrolls natively.
    const stopCamera = stage?.onCameraChanged(binding.moved);
    return () => {
      command.current = undefined;
      stopCamera?.();
      binding.dispose();
    };
  }, [enabled, text, stage]);
  return useCallback(() => command.current?.(), []);
}

/** A word found under the pointer: the word itself, and where it is drawn. */
interface FoundWord {
  word: string;
  target: LookUpTarget;
}

/** The words on the pages of one PDF, found under window points. */
class PageWords {
  constructor(private readonly text: TextAccess) {}

  /** The word under a window point, if the pointer is still on it. */
  async at(x: number, y: number): Promise<FoundWord | undefined> {
    const here = lookUpPageAt(x, y);
    if (!here) {
      return undefined;
    }
    const { page, point } = here;
    const found = await this.wordAt(page.ref, point);
    // The page may have scrolled or zoomed under the pointer meanwhile.
    const current = lookUpPageAt(x, y);
    if (
      !found ||
      !current ||
      current.page.pageIndex !== page.pageIndex ||
      Math.abs(current.point.x - point.x) > 0.1 ||
      Math.abs(current.point.y - point.y) > 0.1
    ) {
      return undefined;
    }
    const word = coreWord(found.text);
    if (!word) {
      return undefined;
    }
    return {
      word,
      target: { pageIndex: page.pageIndex, box: found.box, text: found.text },
    };
  }

  /** Whether `target` is the word drawn under a window point. */
  covers(target: LookUpTarget | undefined, x: number, y: number): boolean {
    const here = lookUpPageAt(x, y);
    if (!target || here?.page.pageIndex !== target.pageIndex) {
      return false;
    }
    const [left, top, right, bottom] = target.box;
    const { point } = here;
    return (
      point.x >= left && point.x <= right && point.y >= top && point.y <= bottom
    );
  }

  /** The word on the glyph at a page point, with its text and box. */
  private async wordAt(
    page: Parameters<TextAccess["layoutOf"]>[0],
    point: { x: number; y: number },
  ): Promise<{ text: string; box: LookUpTarget["box"] } | undefined> {
    try {
      const layout = await this.text.layoutOf(page);
      const index = layout.charAt(point);
      // `charAt` forgives a near miss, so hovering beside a word would find
      // it; Look Up wants the pointer on the word itself.
      if (index === null || !isOnGlyph(layout, index, point)) {
        return undefined;
      }
      const range = layout.wordAt(index);
      const box =
        range && unionBounds(layout.segments(range).map((s) => s.rect));
      return range && box
        ? { text: await this.text.slice(page, range), box }
        : undefined;
    } catch {
      // Selecting or copying is forbidden by the PDF, or the page is gone.
      return undefined;
    }
  }
}

/**
 * Look Up's triggers on the document: the pointer, the context menu and a
 * force click. The latest request wins; older answers are dropped.
 */
class LookUpBinding {
  private generation = 0;
  private live = true;
  /** A context menu is open over a word: hovering no longer moves it. */
  private menuTarget = false;
  private clicked: { x: number; y: number } | undefined;
  /** Where the pointer last rested, to find its word again after the pages move. */
  private pointer: { x: number; y: number } | undefined;
  private shown: LookUpTarget | undefined;
  /** The host was last told a word: a camera move or a click retracts it, once. */
  private reported = false;
  /**
   * A button is down. The hidden word may be what was pressed: keep it in
   * the page until the press ends, as the drag that follows is read from
   * where it began.
   */
  private pressed = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private readonly listeners: [
    string,
    EventListener,
    boolean | AddEventListenerOptions,
  ][] = [
    ["pointerdown", this.onPointerDown.bind(this) as EventListener, true],
    ["pointerup", () => (this.pressed = false), true],
    ["pointercancel", () => (this.pressed = false), true],
    [
      "keydown",
      ((event: KeyboardEvent) => {
        if (event.key === "Escape") {
          this.clearTarget();
        }
      }) as EventListener,
      true,
    ],
    ["pointermove", this.onMove.bind(this) as EventListener, { passive: true }],
    ["contextmenu", this.onContextMenu.bind(this) as EventListener, true],
    // The hidden word must stay selectable for the system to read it, but a
    // drag or a double click on it must not select it instead of the page.
    ["selectstart", preventInLookUpWord, true],
    // Keep Safari's own force-click preview from opening as well.
    ["webkitmouseforcewillbegin", (event) => event.preventDefault(), true],
    ["webkitmouseforcedown", this.onForceDown.bind(this), true],
  ];

  constructor(private readonly words: PageWords) {
    for (const [type, listener, options] of this.listeners) {
      document.addEventListener(type, listener, options);
    }
  }

  /** Look up the word the context menu was opened on (bound: it is handed out). */
  readonly open = (): void => {
    if (this.clicked && this.live) {
      this.report(this.clicked.x, this.clicked.y, true);
    }
  };

  readonly dispose = (): void => {
    this.live = false;
    this.generation++;
    clearTimeout(this.timer);
    for (const [type, listener, options] of this.listeners) {
      document.removeEventListener(type, listener, options);
    }
    this.show(undefined);
  };

  private report(x: number, y: number, open: boolean): void {
    const request = ++this.generation;
    void this.words.at(x, y).then((found) => {
      if (this.live && request === this.generation) {
        this.show(found?.target);
        this.tellHost(found?.word ?? null, open);
      }
    });
  }

  private tellHost(word: string | null, open: boolean): void {
    this.reported = word !== null;
    postToHost({ type: "lookUp", word, open });
  }

  private show(target: LookUpTarget | undefined): void {
    this.shown = target;
    setLookUpTarget(target);
  }

  private onMove(event: PointerEvent): void {
    // A drag (a selection, a pan) moves nothing: the word stays where the
    // press began, which is where a hard press looks it up.
    if (this.menuTarget || event.buttons) {
      return;
    }
    clearTimeout(this.timer);
    const { clientX, clientY } = event;
    this.pointer = { x: clientX, y: clientY };
    this.generation++;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.report(clientX, clientY, false);
    }, HOVER_MS);
  }

  /**
   * Forget the word under a click or a menu, and tell the host it is gone.
   * The Stage's camera event calls this for every wheel event, so the host
   * is told only when there was a word to forget: a message to the extension
   * host per frame of scrolling, each one flushing the view report that
   * waits to go out with the frame's others, is what a scroll cost on macOS.
   */
  private clearTarget(): void {
    const hadWord =
      this.menuTarget || this.clicked !== undefined || this.reported;
    this.menuTarget = false;
    this.clicked = undefined;
    this.generation++;
    clearTimeout(this.timer);
    if (hadWord) {
      this.tellHost(null, false);
    }
  }

  /**
   * A hard press starts as a click: keep the hidden word, and put it under
   * the press now if the pointer had not rested long enough to place it.
   */
  private onPointerDown(event: PointerEvent): void {
    this.clearTarget();
    this.pressed = true;
    const { clientX: x, clientY: y } = event;
    if (this.words.covers(this.shown, x, y)) {
      return;
    }
    const request = this.generation;
    void this.words.at(x, y).then((found) => {
      if (this.live && request === this.generation) {
        this.show(found?.target);
      }
    });
  }

  /**
   * The pages move under a still pointer (the camera moved: a scroll, a zoom):
   * find its word once they stop. Bound: the Stage's camera event is handed it.
   */
  readonly moved = (): void => {
    this.clearTarget();
    if (this.pressed) {
      return;
    }
    this.show(undefined);
    const pointer = this.pointer;
    if (!pointer) {
      return;
    }
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.report(pointer.x, pointer.y, false);
    }, HOVER_MS);
  };

  // Always resolve the clicked point. A nearby pointer or cached pre-scroll
  // word is not evidence for the word under this context menu.
  private onContextMenu(event: MouseEvent): void {
    this.clearTarget();
    this.menuTarget = true;
    this.clicked = { x: event.clientX, y: event.clientY };
    this.report(event.clientX, event.clientY, false);
  }

  private onForceDown(event: Event): void {
    const { clientX, clientY } = event as MouseEvent;
    this.clearTarget();
    this.report(clientX, clientY, true);
  }
}

/** Stop a text selection that would start in the hidden Look Up word. */
function preventInLookUpWord(event: Event): void {
  const node = event.target as Node | null;
  const element =
    node?.nodeType === 1 ? (node as Element) : (node?.parentElement ?? null);
  if (element?.closest(".look-up-word")) {
    event.preventDefault();
  }
}

/** Whether a page point is on the character's own box, around its shape. */
function isOnGlyph(
  layout: TextLayout,
  index: number,
  point: { x: number; y: number },
): boolean {
  const box = charBox(layout, index);
  return (
    box !== undefined &&
    point.x >= box[0] - GLYPH_SLACK &&
    point.x <= box[2] + GLYPH_SLACK &&
    point.y >= box[1] - GLYPH_SLACK &&
    point.y <= box[3] + GLYPH_SLACK
  );
}

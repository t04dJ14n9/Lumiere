import { useRegistry } from "@embedpdf/core/react";
import type {
  PdfDocumentObject,
  PdfEngine,
  PdfGlyphObject,
} from "@embedpdf/models";
import { useCallback, useEffect, useRef } from "react";
import {
  coreWord,
  glyphRangeBox,
  wordGlyphRange,
  type WordGlyph,
} from "../shared/look-up";
import { postToHost } from "./host";
import { setLookUpTarget, type LookUpTarget } from "./look-up-target";

/** How often the word under the pointer is looked for while it moves. */
const HOVER_MS = 120;

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
export function useLookUp(
  pdf: PdfDocumentObject,
  enabled: boolean,
): () => void {
  const { registry } = useRegistry();
  const engine = useRef<PdfEngine | null>(null);
  engine.current = registry?.getEngine() ?? null;
  const command = useRef<(() => void) | undefined>(undefined);
  useEffect(() => {
    if (!enabled) {
      return;
    }
    const binding = attach(() => engine.current, pdf);
    command.current = binding.open;
    return () => {
      command.current = undefined;
      binding.dispose();
    };
  }, [enabled, pdf]);
  return useCallback(() => command.current?.(), []);
}

function attach(
  engine: () => PdfEngine | null,
  pdf: PdfDocumentObject,
): { dispose(): void; open(): void } {
  return new LookUpBinding(new PageWords(engine, pdf));
}

type Glyphs = readonly (WordGlyph | undefined)[];

/** A word found under the pointer: the word itself, and where it is drawn. */
interface FoundWord {
  word: string;
  target: LookUpTarget;
}

/** The words on the pages of one PDF, found under window points. */
class PageWords {
  private readonly glyphs = new Map<number, Promise<Glyphs | undefined>>();

  constructor(
    private readonly engine: () => PdfEngine | null,
    private readonly pdf: PdfDocumentObject,
  ) {}

  /** The word under a window point, if the pointer is still on it. */
  async at(x: number, y: number): Promise<FoundWord | undefined> {
    const target = pageAt(this.pdf, x, y);
    const engine = this.engine();
    if (!target || !engine) {
      return undefined;
    }
    const { page, point } = target;
    const list = await this.glyphsOf(engine, page);
    const index =
      list?.findIndex(
        (glyph) =>
          glyph?.box !== undefined &&
          !glyph.isSpace &&
          point.x >= glyph.box[0] - 0.5 &&
          point.x <= glyph.box[2] + 0.5 &&
          point.y >= glyph.box[1] - 0.5 &&
          point.y <= glyph.box[3] + 0.5,
      ) ?? -1;
    const range = index < 0 ? undefined : wordGlyphRange(list!, index);
    if (!range) {
      return undefined;
    }
    const texts = await engine
      .getTextSlices(this.pdf, [
        {
          pageIndex: page.index,
          charIndex: range[0],
          charCount: range[1] - range[0],
        },
      ])
      .toPromise()
      .catch(() => undefined);
    // The page may have scrolled or zoomed under the pointer meanwhile.
    const current = pageAt(this.pdf, x, y);
    if (
      !current ||
      current.page.index !== page.index ||
      Math.abs(current.point.x - point.x) > 0.1 ||
      Math.abs(current.point.y - point.y) > 0.1
    ) {
      return undefined;
    }
    const text = texts?.[0] ?? "";
    const word = coreWord(text);
    const box = glyphRangeBox(list!, range);
    if (!word || !box) {
      return undefined;
    }
    return { word, target: { pageIndex: page.index, box, text } };
  }

  /** Whether `target` is the word drawn under a window point. */
  covers(target: LookUpTarget | undefined, x: number, y: number): boolean {
    const here = pageAt(this.pdf, x, y);
    if (!target || here?.page.index !== target.pageIndex) {
      return false;
    }
    const [left, top, right, bottom] = target.box;
    const { point } = here;
    return (
      point.x >= left && point.x <= right && point.y >= top && point.y <= bottom
    );
  }

  private glyphsOf(
    engine: PdfEngine,
    page: PdfDocumentObject["pages"][number],
  ): Promise<Glyphs | undefined> {
    let glyphs = this.glyphs.get(page.index);
    if (!glyphs) {
      glyphs = engine
        .getPageGlyphs(this.pdf, page)
        .toPromise()
        .then(
          (list) => Array.from(list, toWordGlyph),
          () => undefined,
        );
      this.glyphs.set(page.index, glyphs);
    }
    return glyphs;
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
  /** Where the pointer last rested, to find its word again after a scroll. */
  private pointer: { x: number; y: number } | undefined;
  private shown: LookUpTarget | undefined;
  /**
   * A button is down. EmbedPDF captures the pointer on the element pressed,
   * which may be the hidden word: removing it mid-drag would end the capture.
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
    ["scroll", this.onScroll.bind(this), true],
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
        postToHost({ type: "lookUp", word: found?.word ?? null, open });
      }
    });
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

  private clearTarget(): void {
    this.menuTarget = false;
    this.clicked = undefined;
    this.generation++;
    clearTimeout(this.timer);
    postToHost({ type: "lookUp", word: null, open: false });
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

  /** The pages move under a still pointer: find its word once they stop. */
  private onScroll(): void {
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
  }

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

/** The page under a window point, and the point in the page's own points. */
function pageAt(
  pdf: PdfDocumentObject,
  x: number,
  y: number,
):
  | {
      page: PdfDocumentObject["pages"][number];
      point: { x: number; y: number };
    }
  | undefined {
  const element = document
    .elementsFromPoint(x, y)
    .find((candidate) => candidate.hasAttribute("data-page-index"));
  const page = pdf.pages[Number(element?.getAttribute("data-page-index"))];
  // Pages stored sideways (/Rotate) are not looked up: their boxes are turned.
  if (!element || !page || page.rotation) {
    return undefined;
  }
  const rect = element.getBoundingClientRect();
  const scale = rect.width / Math.max(1, page.size.width);
  return {
    page,
    point: { x: (x - rect.left) / scale, y: (y - rect.top) / scale },
  };
}

function toWordGlyph(glyph: PdfGlyphObject | undefined): WordGlyph | undefined {
  if (!glyph) {
    return undefined;
  }
  const { x, y } = glyph.tightOrigin ?? glyph.origin;
  const { width, height } = glyph.tightSize ?? glyph.size;
  return {
    isSpace: Boolean(glyph.isSpace),
    ...(width > 0 && height > 0
      ? {
          box: [x, y, x + width, y + height] as [
            number,
            number,
            number,
            number,
          ],
        }
      : {}),
  };
}

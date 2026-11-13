/**
 * PDFium's colour-scheme render, reached through EmbedPDF's page reader.
 *
 * EmbedPDF 3's `PageRenderReader` draws a page with the runtime's
 * `EPDF_RenderPageBitmapWithMatrix_Start` and has no colour-scheme option.
 * The runtime still exports `FPDF_RenderPageBitmapWithColorScheme_Start`, so
 * `withColorScheme` hands the reader a runtime whose three render calls
 * answer with that one instead. The reader still allocates the bitmap, works
 * out the area, slices the render and reads the pixels back; only the call
 * that draws is another one. See packages/pdf/docs/embedpdf-page-colors-patch.md.
 */
import type { Callback, PdfRuntimeModule, Ptr } from "@embedpdf/engine-runtime";

/** `FPDF_COLORSCHEME`: the path fill and stroke and the text fill and stroke, as ARGB. */
const SCHEME_BYTES = 16;
/**
 * `IFSDK_PAUSE` as wasm32 lays it out: an int version, then the pointers to
 * `NeedToPauseNow` and to the caller's data. The worker's runtime is always
 * wasm, as `createPdfRuntime({ prefer: "wasm" })` asks.
 */
const PAUSE_BYTES = 12;

/** The four colours of PDFium's scheme, each `#AARRGGBB`. */
export interface SchemeColors {
  readonly pathFill: string;
  readonly pathStroke: string;
  readonly textFill: string;
  readonly textStroke: string;
}

/** `#AARRGGBB` as the signed 32-bit word PDFium reads. */
function argbOf(hex: string): number {
  if (!/^#[0-9a-f]{8}$/i.test(hex)) {
    throw new RangeError(`A scheme colour is #AARRGGBB, not ${hex}`);
  }
  return Number.parseInt(hex.slice(1), 16) | 0;
}

/**
 * The structs one colour-scheme render passes to PDFium, alive from its
 * `Start` to its `Close`. The pause callback tells PDFium to stop once the
 * slice's budget is spent, as EmbedPDF's own render does, so an abort is
 * heard about as soon as for a normal page.
 */
class SchemeStructs {
  readonly scheme: Ptr;
  readonly pause: Ptr;
  private readonly needToPause: Callback;
  private deadline = 0;

  constructor(
    private readonly runtime: PdfRuntimeModule,
    colors: SchemeColors,
  ) {
    const { mem, cb } = runtime;
    this.scheme = mem.alloc(SCHEME_BYTES);
    this.pause = mem.alloc(PAUSE_BYTES);
    this.needToPause = cb.register("ii", () =>
      performance.now() >= this.deadline ? 1 : 0,
    );
    [
      colors.pathFill,
      colors.pathStroke,
      colors.textFill,
      colors.textStroke,
    ].forEach((hex, at) => mem.poke(this.scheme, "i32", argbOf(hex), at * 4));
    mem.poke(this.pause, "i32", 1, 0);
    mem.poke(this.pause, "i32", Number(this.needToPause), 4);
    mem.poke(this.pause, "i32", 0, 8);
  }

  /** The next slice of the render may run for `budgetMs`. */
  startSlice(budgetMs: number): void {
    this.deadline = performance.now() + budgetMs;
  }

  free(): void {
    const { mem, cb } = this.runtime;
    cb.dispose(this.needToPause);
    mem.free(this.pause);
    mem.free(this.scheme);
  }
}

/** Where PDFium's own display matrix must put the whole page for the render's matrix. */
interface Placement {
  readonly startX: number;
  readonly startY: number;
  readonly sizeX: number;
  readonly sizeY: number;
  /** PDFium's `rotate`: quarter turns clockwise. */
  readonly rotate: number;
}

/**
 * `FPDF_RenderPageBitmap*` takes the rectangle the whole page lands on and
 * the turn, where EmbedPDF's render takes the matrix from page points to
 * pixels (`renderMatrix` in engine-core, which has no skew). A tile is a
 * small bitmap and a page rectangle far outside it: the matrix places the
 * page's corners, and PDFium clips to the bitmap.
 */
function placementOf(
  runtime: PdfRuntimeModule,
  pagePtr: Ptr,
  matrixPtr: Ptr,
): Placement {
  const { fn, mem } = runtime;
  const [a = 0, b = 0, c = 0, d = 0, e = 0, f = 0] = [0, 1, 2, 3, 4, 5].map(
    (at) => Number(mem.peek(matrixPtr, "f32", at * 4)),
  );
  const width = fn.FPDF_GetPageWidthF(pagePtr);
  const height = fn.FPDF_GetPageHeightF(pagePtr);
  const xs = [e, e + a * width, e + c * height, e + a * width + c * height];
  const ys = [f, f + b * width, f + d * height, f + b * width + d * height];
  const left = Math.min(...xs);
  const top = Math.min(...ys);
  return {
    startX: Math.round(left),
    startY: Math.round(top),
    sizeX: Math.round(Math.max(...xs) - left),
    sizeY: Math.round(Math.max(...ys) - top),
    rotate: quarterTurnsOf(a, b),
  };
}

/** The clockwise quarter turns a `renderMatrix` of 0, 90, 180 or 270 degrees has. */
function quarterTurnsOf(a: number, b: number): number {
  if (b > 0) {
    return 1;
  }
  if (b < 0) {
    return 3;
  }
  return a < 0 ? 2 : 0;
}

type PdfFunctions = PdfRuntimeModule["fn"];
type StartArguments = Parameters<
  PdfFunctions["EPDF_RenderPageBitmapWithMatrix_Start"]
>;

/**
 * The render in progress. Renders do not overlap: the engine's host runs one
 * job at a time, and PDFium holds one render per page. So the three calls
 * share one set of structs, made at `Start` and freed at `Close`, which the
 * reader calls even when the render fails.
 */
class SchemeRender {
  private structs: SchemeStructs | undefined;

  constructor(
    private readonly runtime: PdfRuntimeModule,
    private readonly colors: SchemeColors,
  ) {}

  start([bitmap, page, matrix, , flags, budgetMs]: StartArguments): number {
    this.end();
    const structs = new SchemeStructs(this.runtime, this.colors);
    this.structs = structs;
    structs.startSlice(budgetMs);
    try {
      const at = placementOf(this.runtime, page, matrix);
      return this.runtime.fn.FPDF_RenderPageBitmapWithColorScheme_Start(
        bitmap,
        page,
        at.startX,
        at.startY,
        at.sizeX,
        at.sizeY,
        at.rotate,
        flags,
        structs.scheme,
        structs.pause,
      );
    } catch (error) {
      // The reader closes a render that started, not one that threw.
      this.end();
      throw error;
    }
  }

  /** The reader goes on only with a render that `start` left unfinished. */
  continue(page: Ptr, budgetMs: number): number {
    const structs = this.structs!;
    structs.startSlice(budgetMs);
    return this.runtime.fn.FPDF_RenderPage_Continue(page, structs.pause);
  }

  close(page: Ptr): void {
    try {
      this.runtime.fn.FPDF_RenderPage_Close(page);
    } finally {
      this.end();
    }
  }

  private end(): void {
    this.structs?.free();
    this.structs = undefined;
  }
}

/**
 * A runtime that draws pages with PDFium's colour scheme `colors`, for a
 * `PageRenderReader` (engine-services). The runtime it wraps is untouched, so
 * everything else of the engine goes on drawing as authored.
 */
export function withColorScheme(
  runtime: PdfRuntimeModule,
  colors: SchemeColors,
): PdfRuntimeModule {
  const render = new SchemeRender(runtime, colors);
  return {
    ...runtime,
    fn: {
      ...runtime.fn,
      EPDF_RenderPageBitmapWithMatrix_Start: (...args) => render.start(args),
      EPDF_RenderPage_Continue: (page, budgetMs) =>
        render.continue(page, budgetMs),
      FPDF_RenderPage_Close: (page) => render.close(page),
    },
  };
}

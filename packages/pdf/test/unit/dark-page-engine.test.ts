/**
 * The dark page with the real PDFium, through the engine the viewer runs:
 * EmbedPDF's local engine on Lumiere's host (src/engine-worker), asked for
 * pages as the render plugin asks. `darkenPage` finds pictures by the alpha of
 * the colour-scheme render (src/shared/dark-page.ts), which holds only as long
 * as the engine leaves pictures opaque there and draws everything else in the
 * scheme's near-transparent ink. An EmbedPDF or PDFium update could break that
 * without a fake engine noticing, and bring back labels the colour of their
 * box. This renders figure.pdf as the viewer does, on every check.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { mock, test } from "node:test";
import { LocalEngine } from "@embedpdf/engine";
import { createPdfRuntime } from "@embedpdf/engine-runtime";
import type { PdfRuntimeModule } from "@embedpdf/engine-runtime";
import { DarkInlineTransport } from "../../src/engine-worker/inline-transport";
import type { EffectivePageColors } from "../../src/shared/page-colors";
import { FIGURE, figurePdf } from "../fixtures/make-fixtures.mjs";
import { darkFigureProblems, type Picture } from "../support/dark-figure";

const wasm = readFileSync(
  createRequire(import.meta.url).resolve(
    "@embedpdf/engine-runtime-wasm32/embedpdf.wasm",
  ),
);

/** What the render plugin asks for: a page, or a tile of it, at a scale. */
interface Request {
  scale: number;
  /** A tile, in points from the page's top-left corner. */
  tile?: { x: number; y: number; width: number; height: number };
  /** Degrees clockwise; the viewer turns pages with CSS and asks for none. */
  rotation?: 0 | 90 | 180 | 270;
}

/**
 * A slice budget a machine cannot use up: the page is drawn at once. PDFium
 * pauses a render whose slice outlasts its budget in wall-clock time (8 ms by
 * default), and a test process that is not scheduled for 8 ms, as under a
 * full `pnpm check`, would draw "at once" in slices.
 */
const WHOLE_PAGE = { sliceMs: 60_000 };

interface Session {
  render(mode: EffectivePageColors, request: Request): Promise<Picture>;
  /** How often PDFium was asked to go on with a render. */
  continues(): number;
  close(): Promise<void>;
}

/** The viewer's engine over `pdf`, with a render of each page colour on demand. */
async function openPdf(
  pdf: Uint8Array,
  options: { sliceMs?: number } = {},
): Promise<Session> {
  const runtime = await createPdfRuntime({ prefer: "wasm", wasmBinary: wasm });
  let continues = 0;
  const counting: PdfRuntimeModule = {
    ...runtime,
    fn: {
      ...runtime.fn,
      FPDF_RenderPage_Continue: (page, pause) => {
        continues += 1;
        return runtime.fn.FPDF_RenderPage_Continue(page, pause);
      },
    },
  };
  const transport = new DarkInlineTransport(counting, options);
  const engine = LocalEngine.fromTransport({ transport });
  const document = await engine.open({ kind: "bytes", bytes: pdf });
  const { pages } = await document.pages.list();
  const page = document.page(pages[0]!.ref);
  return {
    async render(mode, { scale, tile, rotation }) {
      transport.setPageColors(mode);
      const raster = await page.render.raw({
        viewport: { kind: "scale", scale },
        ...(tile ? { target: { kind: "rect", rect: tile } as const } : {}),
        ...(rotation ? { rotation } : {}),
      });
      return {
        width: raster.width,
        height: raster.height,
        data: new Uint8ClampedArray(raster.data),
      };
    },
    continues: () => continues,
    async close() {
      await document.close();
      await engine.destroy();
    },
  };
}

/** The pixels of `picture` inside the box at (`x`, `y`) of `width` x `height`. */
function crop(
  picture: Picture,
  box: { x: number; y: number; width: number; height: number },
): Picture {
  const data = new Uint8ClampedArray(box.width * box.height * 4);
  for (let row = 0; row < box.height; row++) {
    const from = ((box.y + row) * picture.width + box.x) * 4;
    data.set(
      Array.prototype.slice.call(picture.data, from, from + box.width * 4),
      row * box.width * 4,
    );
  }
  return { width: box.width, height: box.height, data };
}

/** `picture` turned `quarterTurns` times clockwise. */
function turned(picture: Picture, quarterTurns: number): Picture {
  let current = picture;
  for (let turn = 0; turn < quarterTurns % 4; turn++) {
    const { width, height } = current;
    const data = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const from = (y * width + x) * 4;
        const to = (x * height + (height - 1 - y)) * 4;
        for (let channel = 0; channel < 4; channel++) {
          data[to + channel] = current.data[from + channel]!;
        }
      }
    }
    current = { width: height, height: width, data };
  }
  return current;
}

/** figure.pdf with its page turned by /Rotate, which the engine draws upright. */
function figureRotated(degrees: number): Uint8Array {
  const source = figurePdf().toString("latin1");
  const box = `/MediaBox [0 0 ${FIGURE.size.width} ${FIGURE.size.height}]`;
  assert.ok(source.includes(box));
  return Buffer.from(
    source.replace(box, `${box} /Rotate ${degrees}`),
    "latin1",
  );
}

/**
 * The picture's left and bottom edges lie on whole pixels at scale 2: the
 * pixels just inside them are as authored, and those just outside are dark
 * paper. A mask a pixel off darkens the first or leaves a white line at the
 * second, which the checks inside the picture (darkFigureProblems) cannot see.
 * `left` and `bottom` are where the edges are in `white` and `dark`, a render
 * (or a tile) of the figure at scale 2.
 */
function pictureEdgeProblems(
  white: Picture,
  dark: Picture,
  edges: { left: number; bottom: number },
): string[] {
  const problems: string[] = [];
  const pixel = (picture: Picture, x: number, y: number): number[] =>
    [0, 1, 2].map(
      (channel) => picture.data[(y * picture.width + x) * 4 + channel]!,
    );
  const inside = [
    ...Array.from({ length: 30 }, (_, at) => [
      edges.left,
      edges.bottom - 10 - at,
    ]),
    ...Array.from({ length: 30 }, (_, at) => [
      edges.left + 10 + at,
      edges.bottom - 1,
    ]),
  ] as [number, number][];
  for (const [x, y] of inside) {
    if (pixel(dark, x, y).join() !== pixel(white, x, y).join()) {
      problems.push(`the picture's edge pixel (${x}, ${y}) was darkened`);
    }
  }
  const outside = [
    ...Array.from({ length: 30 }, (_, at) => [
      edges.left - 1,
      edges.bottom - 10 - at,
    ]),
    ...Array.from({ length: 30 }, (_, at) => [
      edges.left + 10 + at,
      edges.bottom,
    ]),
  ] as [number, number][];
  for (const [x, y] of outside) {
    if (Math.max(...pixel(dark, x, y)) > 60) {
      problems.push(`the paper beside the picture at (${x}, ${y}) is light`);
    }
  }
  return problems;
}

/** The largest difference between a channel of `a` and the same one of `b`. */
function largestDifference(a: Picture, b: Picture): number {
  assert.equal(`${a.width}x${a.height}`, `${b.width}x${b.height}`);
  let largest = 0;
  for (let at = 0; at < a.data.length; at++) {
    largest = Math.max(largest, Math.abs(a.data[at]! - b.data[at]!));
  }
  return largest;
}

test("PDFium's renders make figure.pdf a readable dark page with its picture as authored", async () => {
  const session = await openPdf(figurePdf());
  try {
    const white = await session.render("normal", { scale: 2 });
    const dark = await session.render("dark", { scale: 2 });
    assert.deepEqual(darkFigureProblems(dark, white, FIGURE), []);
    const [left, , , bottom] = FIGURE.pictureBounds;
    assert.deepEqual(
      pictureEdgeProblems(white, dark, { left: left * 2, bottom: bottom * 2 }),
      [],
    );
    // The check can fail: the page as authored is not a dark page.
    assert.notDeepEqual(darkFigureProblems(white, white, FIGURE), []);
    // Normal paper again after the dark one: the mode is the host's state.
    const again = await session.render("normal", { scale: 2 });
    assert.equal(largestDifference(again, white), 0);
  } finally {
    await session.close();
  }
});

test("a tile of a dark page is the part of the dark page it shows", async () => {
  const session = await openPdf(figurePdf());
  try {
    const dark = await session.render("dark", { scale: 2 });
    // The picture, the bars and some paper, on whole pixels at this scale.
    const tile = { x: 20, y: 130, width: 380, height: 150 };
    const part = await session.render("dark", { scale: 2, tile });
    const expected = crop(dark, {
      x: tile.x * 2,
      y: tile.y * 2,
      width: tile.width * 2,
      height: tile.height * 2,
    });
    assert.equal(largestDifference(part, expected), 0);
    // A tile's own mask: its edges are where its offset puts them.
    const [left, , , bottom] = FIGURE.pictureBounds;
    const white = await session.render("normal", { scale: 2, tile });
    assert.deepEqual(
      pictureEdgeProblems(white, part, {
        left: (left - tile.x) * 2,
        bottom: (bottom - tile.y) * 2,
      }),
      [],
    );
  } finally {
    await session.close();
  }
});

test("a whole-page render is not paused by a slow machine", async () => {
  const session = await openPdf(figurePdf(), WHOLE_PAGE);
  // A machine that is busy: every look at the clock finds 100 ms gone.
  const real = performance.now.bind(performance);
  let late = 0;
  const clock = mock.method(performance, "now", () => real() + (late += 100));
  try {
    await session.render("dark", { scale: 2 });
  } finally {
    clock.mock.restore();
    await session.close();
  }
  assert.equal(session.continues(), 0);
});

test("a dark page drawn in slices is the page drawn at once", async () => {
  const session = await openPdf(figurePdf(), WHOLE_PAGE);
  const sliced = await openPdf(figurePdf(), { sliceMs: 0 });
  try {
    const atOnce = await session.render("dark", { scale: 2 });
    const inSlices = await sliced.render("dark", { scale: 2 });
    // PDFium asks whether to pause before it draws, so even a small page
    // starts, pauses and is continued once.
    assert.equal(atOnce.data.length, inSlices.data.length);
    assert.ok(
      sliced.continues() >= 1,
      "the colour-scheme render paused and was continued",
    );
    assert.equal(session.continues(), 0);
    assert.equal(largestDifference(inSlices, atOnce), 0);
  } finally {
    await session.close();
    await sliced.close();
  }
});

test("a tile at a fractional scale lines up with the picture it cuts", async () => {
  const session = await openPdf(figurePdf());
  try {
    const scale = 1.3;
    const dark = await session.render("dark", { scale });
    // 192 x 128 device pixels from (350, 150): across the picture's left and
    // top edges (x 390, y 180 at this scale), where a mask a pixel off would
    // darken a line of the picture or leave one of the paper.
    const device = { x: 350, y: 150, width: 192, height: 128 };
    const part = await session.render("dark", {
      scale,
      tile: {
        x: device.x / scale,
        y: device.y / scale,
        width: device.width / scale,
        height: device.height / scale,
      },
    });
    assert.ok(largestDifference(part, crop(dark, device)) <= 2);
  } finally {
    await session.close();
  }
});

test("a dark page turned by the render keeps its picture, whichever way", async () => {
  const session = await openPdf(figurePdf());
  try {
    for (const rotation of [90, 180, 270] as const) {
      const quarterTurnsBack = 4 - rotation / 90;
      const white = turned(
        await session.render("normal", { scale: 2, rotation }),
        quarterTurnsBack,
      );
      const dark = turned(
        await session.render("dark", { scale: 2, rotation }),
        quarterTurnsBack,
      );
      assert.deepEqual(
        darkFigureProblems(dark, white, FIGURE),
        [],
        `${rotation}`,
      );
    }
  } finally {
    await session.close();
  }
});

test("a page with /Rotate is drawn upright, and dark", async () => {
  const session = await openPdf(figureRotated(90));
  try {
    const white = await session.render("normal", { scale: 2 });
    const dark = await session.render("dark", { scale: 2 });
    assert.deepEqual(darkFigureProblems(dark, white, FIGURE), []);
  } finally {
    await session.close();
  }
});

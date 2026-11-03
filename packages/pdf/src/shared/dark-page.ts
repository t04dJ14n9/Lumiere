/**
 * Dark paper: how a page rendered on white paper becomes a page for a dark
 * editor.
 *
 * PDFium's own colour scheme (`FPDF_COLORSCHEME`) cannot do it alone. It
 * paints every filled shape one colour and all text one colour, so a node box
 * in a diagram and the label on it come out the same colour and the label
 * vanishes, and the bars of a chart all turn the same. What a dark page needs
 * is each colour's lightness flipped and its hue kept (black ink becomes
 * light, a light box dark, red stays red).
 *
 * So a page is rendered twice at the same size:
 *
 * - `normal`: as authored, on white paper;
 * - `forced`: with the colour scheme, on a transparent background and with
 *   ink that is all but transparent. The scheme recolours vectors and text
 *   but leaves embedded pictures (and shadings) alone, so they are what is
 *   opaque in this render, with whatever is drawn over them. Its colours do
 *   not matter, only its alpha does: comparing colours instead would take a
 *   light box for a picture whenever its grey happened to be near the ink's.
 *
 * `darkenPage` turns `normal` into the dark page: where `forced` is mostly
 * opaque there is a picture and its pixels stay as authored, as the page
 * colors design asks; every other pixel has its lightness inverted.
 */

export type Rgb = readonly [number, number, number];

export interface DarkPalette {
  /** What white paper becomes: the page's `--paper`. */
  readonly background: Rgb;
  /** What black ink becomes. */
  readonly ink: Rgb;
}

export const DARK_PALETTE: DarkPalette = {
  background: [0x1e, 0x1e, 0x1e],
  ink: [0xe8, 0xe6, 0xe3],
};

/**
 * The colour scheme of the `forced` render (`#AARRGGBB`). Ink of alpha 1, not
 * 0: a pixel's alpha then counts the shapes painted over it, so only a
 * picture (or more than a hundred layers) reaches `PICTURE_ALPHA`. Fully
 * transparent ink might not be drawn at all.
 */
export const FORCED_PAGE_COLORS = {
  background: "#00000000",
  text: "#01e8e6e3",
  pathFill: "#01e8e6e3",
  pathStroke: "#01e8e6e3",
  textFill: "#01e8e6e3",
  textStroke: "#01e8e6e3",
} as const;

/**
 * Alpha from which a pixel of the `forced` render is a picture: one at least
 * half covered by a picture. An anti-aliased picture edge has a partial
 * alpha; this keeps its mostly-picture pixels as authored rather than
 * inverting part of the picture into a halo.
 */
const PICTURE_ALPHA = 128;

/**
 * The dark counterpart of one opaque colour: its lightness inverted with its
 * hue kept (the matrix of CSS `invert(1) hue-rotate(180deg)`), then laid
 * between the palette's background (for white) and ink (for black).
 */
export function darkColor(
  red: number,
  green: number,
  blue: number,
  palette: DarkPalette = DARK_PALETTE,
): [number, number, number] {
  const out: [number, number, number] = [0, 0, 0];
  darkener(palette)(out, red, green, blue);
  return out;
}

/** Writes a colour's dark counterpart into `out`, without allocating. */
type Darken = (out: number[], red: number, green: number, blue: number) => void;

/** `darkColor` for one palette, as a function that allocates nothing. */
function darkener({ background, ink }: DarkPalette): Darken {
  return (out, red, green, blue) => {
    const r = 255 - red;
    const g = 255 - green;
    const b = 255 - blue;
    out[0] = between(background[0], ink[0], -0.574 * r + 1.43 * g + 0.144 * b);
    out[1] = between(background[1], ink[1], 0.426 * r + 0.43 * g + 0.144 * b);
    out[2] = between(background[2], ink[2], 0.426 * r + 1.43 * g - 0.856 * b);
  };
}

/** `level` (0 to 255, clamped) of the way from `from` to `to`. */
function between(from: number, to: number, level: number): number {
  const clamped = Math.min(255, Math.max(0, level)) / 255;
  return Math.round(from + clamped * (to - from));
}

/**
 * Turn `normal` (RGBA, rendered on white paper) into the dark page, in place.
 * `forced` is the same page rendered with `FORCED_PAGE_COLORS`; its mostly
 * opaque pixels are pictures and are left as they are.
 */
export function darkenPage(
  normal: Uint8ClampedArray,
  forced: Uint8ClampedArray,
  palette: DarkPalette = DARK_PALETTE,
): void {
  if (normal.length !== forced.length) {
    throw new RangeError("The two renders of a page differ in size");
  }
  // Flat areas (paper, boxes) repeat one colour for a long run: reuse its
  // result rather than working it out again for every pixel.
  const darken = darkener(palette);
  let lastRed = -1;
  let lastGreen = -1;
  let lastBlue = -1;
  const dark = [0, 0, 0];
  for (let at = 0; at + 3 < normal.length; at += 4) {
    if (forced[at + 3]! >= PICTURE_ALPHA) {
      continue;
    }
    const r = normal[at]!;
    const g = normal[at + 1]!;
    const b = normal[at + 2]!;
    if (r !== lastRed || g !== lastGreen || b !== lastBlue) {
      darken(dark, r, g, b);
      lastRed = r;
      lastGreen = g;
      lastBlue = b;
    }
    normal[at] = dark[0]!;
    normal[at + 1] = dark[1]!;
    normal[at + 2] = dark[2]!;
  }
}

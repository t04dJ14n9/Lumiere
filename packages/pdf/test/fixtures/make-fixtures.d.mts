/** See make-fixtures.mjs: the parts TypeScript tests import. */

/** [left, top, right, bottom] in points from the page's top-left corner. */
export type FigureArea = readonly [number, number, number, number];

export const FIGURE: {
  readonly size: { readonly width: number; readonly height: number };
  readonly box: FigureArea;
  readonly label: FigureArea;
  readonly arrowhead: FigureArea;
  readonly rule: FigureArea;
  readonly bars: {
    readonly red: FigureArea;
    readonly blue: FigureArea;
    readonly green: FigureArea;
  };
  readonly picture: FigureArea;
  readonly paper: FigureArea;
};

export function figurePdf(): Buffer<ArrayBuffer>;

export const SELECTION_COVER: {
  readonly size: { readonly width: number; readonly height: number };
  readonly title: {
    readonly text: string;
    readonly y: number;
    readonly size: number;
    readonly x: number;
  };
  readonly body: ReadonlyArray<{
    readonly text: string;
    readonly y: number;
    readonly size: number;
    readonly x: number;
  }>;
  readonly bullets: ReadonlyArray<{
    readonly mark: readonly [number, number, number, number];
    readonly text: string;
    readonly textX: number;
    readonly y: number;
    readonly size: number;
  }>;
};

export function selectionCoverPdf(): Buffer;

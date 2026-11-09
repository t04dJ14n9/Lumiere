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
  readonly pictureBounds: FigureArea;
  readonly paper: FigureArea;
};

export function figurePdf(): Buffer<ArrayBuffer>;

export const OUTLINE: readonly {
  readonly title: string;
  readonly page: number;
  readonly children: typeof OUTLINE;
}[];

export function outlinePdf(): Buffer<ArrayBuffer>;
export function shortPdf(): Buffer<ArrayBuffer>;

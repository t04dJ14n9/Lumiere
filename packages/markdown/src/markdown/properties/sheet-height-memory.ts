/**
 * The height the frontmatter placeholder's skeleton measured in the page,
 * by frontmatter source. When its skeleton is exact, that is the height the
 * Properties sheet will have, and a better first guess than any estimate:
 * CodeMirror lays the gutter out from the guess until it measures the sheet,
 * so a guess a pixel or two off moves the line numbers below the sheet for a
 * frame or two after the sheet mounts. Only the opening uses them: a heights
 * measured then need not hold after a resize, a font change or a list that
 * expands, so they are forgotten when the features have loaded.
 */
const MAX_REMEMBERED = 16;
const heights = new Map<string, number>();

export function rememberSheetHeight(source: string, height: number): void {
  if (!(height > 0)) {
    return;
  }
  heights.delete(source);
  heights.set(source, height);
  if (heights.size > MAX_REMEMBERED) {
    heights.delete(heights.keys().next().value!);
  }
}

/** The opening is over: the heights it measured may not hold for a resized or re-fonted pane. */
export function forgetSheetHeights(): void {
  heights.clear();
}

export function rememberedSheetHeight(source: string): number | undefined {
  return heights.get(source);
}

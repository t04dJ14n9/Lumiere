/**
 * The height the frontmatter placeholder's skeleton measured in the page,
 * by frontmatter source. When its skeleton is exact, that is the height the
 * Properties sheet will have, and a better first guess than any estimate:
 * CodeMirror lays the gutter out from the guess until it measures the sheet,
 * so a guess a pixel or two off moves the line numbers below the sheet for a
 * frame or two after the sheet mounts.
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

export function rememberedSheetHeight(source: string): number | undefined {
  return heights.get(source);
}

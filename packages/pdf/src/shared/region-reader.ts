/**
 * The text inside a region of a page, read character by character. The viewer
 * reads a dragged region and a mark's quote this way, and so does the
 * extension host's own PDFium for an agent's list of marks. Where a page comes
 * from differs (the viewer's text plugin, a document of the host's engine), so
 * a page here is only what the reading needs.
 */
import type {
  Annotation,
  TextLayout,
  TextRange,
} from "@embedpdf/engine-core/public";
import type { PageRect } from "./geometry";
import { regionRuns, regionText } from "./region-text";
import { charBounds } from "./text-boxes";

/** One page's text, as the engine reads it. */
export interface RegionPage {
  /** Where the page's characters are. */
  layout(): Promise<TextLayout>;
  /** The text of a character range. */
  slice(range: TextRange): Promise<string>;
}

/**
 * Read the characters inside the region, not the text of the lines it
 * crosses: a region cuts a table row or a column out of them. Never rejects:
 * a PDF that forbids copying, or a page that is gone, reads as no text.
 */
export async function readRegionText(
  page: RegionPage,
  rect: PageRect,
): Promise<string> {
  try {
    const runs = regionRuns(charBounds(await page.layout()), rect);
    if (runs.length === 0) {
      return "";
    }
    const texts = await Promise.all(
      runs.map(({ charIndex, charCount }) =>
        page.slice({ start: charIndex, count: charCount }),
      ),
    );
    return regionText(
      runs.map((run, index) => ({
        content: texts[index] ?? "",
        rect: run.rect,
      })),
      rect,
    );
  } catch {
    // Copy or select forbidden by the PDF, or the page gone.
    return "";
  }
}

/** One box a line: the corners of each quad of a text mark, as a page rectangle. */
export function quoteBoxes(mark: Annotation): PageRect[] {
  const quads =
    "quadPoints" in mark && Array.isArray(mark.quadPoints)
      ? mark.quadPoints
      : [];
  return quads.map((quad) => {
    const xs = [
      quad.upperLeft.x,
      quad.upperRight.x,
      quad.lowerLeft.x,
      quad.lowerRight.x,
    ];
    const ys = [
      quad.upperLeft.y,
      quad.upperRight.y,
      quad.lowerLeft.y,
      quad.lowerRight.y,
    ];
    return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
  });
}

/** The text of every box, one box a line, joined with spaces. */
export async function readBoxesText(
  page: RegionPage,
  boxes: readonly PageRect[],
): Promise<string> {
  const lines = await Promise.all(
    boxes.map((box) => readRegionText(page, box)),
  );
  return lines.join(" ");
}

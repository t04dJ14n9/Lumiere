import type { OutlineItem as PdfOutlineItem } from "@embedpdf/engine";
import type { OutlineItem } from "../shared/messages";
import { targetPage, targetTop } from "../shared/pdf-link-target";

/**
 * The PDF's bookmarks as the outline shown in VS Code.
 *
 * `items` is how EmbedPDF reads an outline: flat and depth first, each item
 * naming its parent, so a parent always comes before its children.
 * `pageNumberOf` gives the 1-based position of a page (undefined for one the
 * document does not have).
 */
export function toOutline(
  items: readonly PdfOutlineItem[],
  pageNumberOf: Parameters<typeof targetPage>[1],
): OutlineItem[] {
  const entries = new Map<number, OutlineItem>();
  const roots: OutlineItem[] = [];
  for (const item of items) {
    const page = targetPage(item.target, pageNumberOf);
    const top = page ? targetTop(item.target) : undefined;
    const entry: OutlineItem = {
      title: item.title,
      ...(page ? { page } : {}),
      ...(top !== undefined ? { top } : {}),
      children: [],
    };
    entries.set(item.ref.objectNumber, entry);
    const parent = item.parent && entries.get(item.parent.objectNumber);
    (parent ? parent.children : roots).push(entry);
  }
  return roots;
}

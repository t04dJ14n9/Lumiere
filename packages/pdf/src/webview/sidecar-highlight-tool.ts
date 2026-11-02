import { uuidV4, type PdfAnnotationObject } from "@embedpdf/models";
import type {
  AnnotationTool,
  SelectionHandlerContext,
  SelectionHandlerFactory,
} from "@embedpdf/plugin-annotation";
import { sidecarState } from "./sidecar-store";

/** One page's part of a text selection, as EmbedPDF hands it to a tool. */
export type FormattedSelection = Parameters<
  SelectionHandlerFactory["handle"]
>[1][number];

/** Turns a finished text selection into sidecar highlights; set while the viewer runs. */
export type SidecarWriter = (
  selections: FormattedSelection[],
  tool: AnnotationTool,
) => void;

let writer: SidecarWriter | undefined;

/** Where the highlight tool sends its highlights (sidecar-writing.ts), or nowhere. */
export function setSidecarWriter(next: SidecarWriter | undefined): void {
  writer = next;
}

/**
 * The highlight tool, overriding EmbedPDF's: where the host keeps a sidecar
 * (VS Code), a highlight goes there and never into the PDF, so the file on
 * disk stays as it was. No EmbedPDF annotation is created at all, so nothing
 * of it can reach `saveAsCopy` when another tool saves the PDF. Where the
 * host keeps none, it marks the PDF as EmbedPDF's own handler does.
 */
export const sidecarHighlightTool = {
  id: "highlight",
  selectionHandler: {
    toolId: "__sidecarHighlight__",
    handle(context, selections, getText) {
      const tool = context.getTool();
      if (!tool) {
        return;
      }
      if (writer && sidecarState().highlights !== null) {
        writer(selections, tool);
        return;
      }
      markPdf(context, selections, getText);
    },
  } satisfies SelectionHandlerFactory,
};

/** EmbedPDF's own highlight handler: a Highlight annotation in the PDF. */
function markPdf(
  context: SelectionHandlerContext,
  selections: FormattedSelection[],
  getText: () => Promise<string | undefined>,
): void {
  const tool = context.getTool();
  if (!tool) {
    return;
  }
  for (const selection of selections) {
    const id = uuidV4();
    void getText().then((text) => {
      context.createAnnotation(selection.pageIndex, {
        ...tool.defaults,
        rect: selection.rect,
        segmentRects: selection.segmentRects,
        pageIndex: selection.pageIndex,
        created: new Date(),
        id,
        ...(text !== undefined ? { custom: { text } } : {}),
      } as PdfAnnotationObject);
      if (tool.behavior?.selectAfterCreate) {
        context.selectAnnotation(selection.pageIndex, id);
      }
    });
  }
}

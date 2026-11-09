import { OutlineToken } from "@embedpdf/plugin-outline/contract";
import { useDocuments, useOptionalCapability } from "@embedpdf/react/runtime";
import { useEffect } from "react";
import { reportToHost } from "./host";
import { toOutline } from "./pdf-targets";

/** Read the PDF's bookmarks once and send them to the extension's outline view. */
export function useOutlinePublishing(): void {
  const outline = useOptionalCapability(OutlineToken);
  const documents = useDocuments();
  useEffect(() => {
    if (!outline) {
      return;
    }
    const controller = new AbortController();
    const publish = (): void =>
      reportToHost({
        outline: toOutline(outline.list(), (page) => {
          const index = documents.getPageIndex(page);
          return index < 0 ? undefined : index + 1;
        }),
      });
    // Nothing reads the outline when a document opens: ask for it, and
    // publish whenever it has been read (it fires for the first read too).
    const stop = outline.onResynced(publish);
    outline.ensureLoaded({ signal: controller.signal }).catch(() => {
      if (!controller.signal.aborted) {
        reportToHost({ outline: [] });
      }
    });
    return () => {
      controller.abort();
      stop();
    };
  }, [outline, documents]);
}

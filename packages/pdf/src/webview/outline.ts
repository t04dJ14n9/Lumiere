import { OutlineToken } from "@embedpdf/plugin-outline/contract";
import { useDocuments, useOptionalCapability } from "@embedpdf/react/runtime";
import { useEffect, useState } from "react";
import type { OutlineItem } from "../shared/messages";
import { reportToHost } from "./host";
import { toOutline } from "./pdf-targets";

/**
 * Read the PDF's bookmarks once, send them to the extension's outline view,
 * and give them to the side panel's Outline tab: `undefined` while they are
 * being read.
 */
export function useOutline(): OutlineItem[] | undefined {
  const outline = useOptionalCapability(OutlineToken);
  const documents = useDocuments();
  const [items, setItems] = useState<OutlineItem[]>();
  useEffect(() => {
    if (!outline) {
      return;
    }
    const controller = new AbortController();
    const publish = (read: OutlineItem[]): void => {
      setItems(read);
      reportToHost({ outline: read });
    };
    const onRead = (): void =>
      publish(
        toOutline(outline.list(), (page) => {
          const index = documents.getPageIndex(page);
          return index < 0 ? undefined : index + 1;
        }),
      );
    // Nothing reads the outline when a document opens: ask for it, and
    // publish whenever it has been read (it fires for the first read too).
    const stop = outline.onResynced(onRead);
    outline.ensureLoaded({ signal: controller.signal }).catch(() => {
      if (!controller.signal.aborted) {
        publish([]);
      }
    });
    return () => {
      controller.abort();
      stop();
    };
  }, [outline, documents]);
  return items;
}

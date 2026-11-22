import { useSyncExternalStore } from "react";

function subscribe(listener: () => void): () => void {
  window.addEventListener("resize", listener);
  return () => window.removeEventListener("resize", listener);
}

/**
 * How wide the viewer is: the whole webview, which the editor pane (a split,
 * a floating window) sizes. The panel is drawn within a share of it, so a
 * width saved in a wide editor does not crowd the pages out of a narrow one.
 */
export function useViewerWidth(): number {
  return useSyncExternalStore(subscribe, () => window.innerWidth);
}

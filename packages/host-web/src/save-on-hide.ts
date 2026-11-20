/**
 * Unsaved notes written as soon as the window may go away: a hidden browser
 * tab can be discarded, a closed or reloaded one is gone, and the iPad stops
 * an app soon after it leaves the screen; none of them waits for autosave.
 * `visibilitychange` covers a hidden tab and the iPad app sent to the
 * background (its web view reports it); `pagehide` covers a reload or a
 * closed tab, which may not be hidden first.
 */
export interface HidingWindow {
  readonly document: {
    readonly visibilityState: DocumentVisibilityState;
    addEventListener(type: "visibilitychange", listener: () => void): void;
    removeEventListener(type: "visibilitychange", listener: () => void): void;
  };
  addEventListener(type: "pagehide", listener: () => void): void;
  removeEventListener(type: "pagehide", listener: () => void): void;
}

/** Call `saveAll` whenever the window is hidden or goes; returns the way to stop. */
export function saveOnHide(
  saveAll: () => Promise<void>,
  page: HidingWindow,
  report: (error: unknown) => void = (error) =>
    console.error("Lumière could not save before the window went", error),
): () => void {
  const save = () => {
    saveAll().catch(report);
  };
  const hidden = () => {
    if (page.document.visibilityState === "hidden") {
      save();
    }
  };
  page.document.addEventListener("visibilitychange", hidden);
  page.addEventListener("pagehide", save);
  return () => {
    page.document.removeEventListener("visibilitychange", hidden);
    page.removeEventListener("pagehide", save);
  };
}

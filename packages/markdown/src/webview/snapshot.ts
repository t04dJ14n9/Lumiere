import { platformOf } from "../plugins/editor/font";
import {
  opensAtTop,
  SNAPSHOT_CLASS,
  snapshotLayout,
} from "../plugins/editor/snapshot-layout";
import type { NoteSettings } from "../shared/host";

/** The longest the snapshot stays over an editor whose features are still loading (ms). */
const LONGEST_COVER_MS = 2000;

/** The crossfade that takes it away (ms); `.mw-snapshot.is-leaving` in opening.css is the same. */
export const FADE_MS = 100;

const LEAVING_CLASS = "is-leaving";

type Opening = Pick<NoteSettings, "preset" | "mode" | "editor" | "features"> & {
  openingSelection?: { anchor: number; head: number; topLine?: number };
  /** The note's Properties are stored collapsed (the `ready` answer's say). */
  propertiesCollapsed?: boolean | undefined;
};

/**
 * Whether the editor will draw what the snapshot drew. It will not when the
 * note opens somewhere other than its top (a search match; a restored view
 * is the page's loader's to see) or with settings other than the host
 * assumed when it built the snapshot (an Obsidian vault's own settings reach
 * the host after the page is set), or a Properties sheet collapsed or
 * expanded otherwise than the host drew it (the layout key says which).
 */
export function snapshotMatches(snapshot: HTMLElement, note: Opening): boolean {
  if (!opensAtTop(note.openingSelection)) {
    return false;
  }
  const layout = snapshotLayout(
    note,
    platformOf(navigator.platform),
    note.propertiesCollapsed === true,
  );
  return layout?.key === snapshot.dataset.layout;
}

/** The snapshot over the editor, when it shows what the editor will draw. */
export function coveringSnapshot(
  parent: HTMLElement,
  note: Opening,
): HTMLElement | undefined {
  const snapshot = parent.ownerDocument.querySelector<HTMLElement>(
    `.${SNAPSHOT_CLASS}`,
  );
  return snapshot && snapshotMatches(snapshot, note) ? snapshot : undefined;
}

/**
 * Keeps the snapshot only while it shows what the editor will draw: it goes
 * at once when `snapshotMatches` says it does not (the editor is about to
 * mount), otherwise it crossfades into the editor beneath once that has
 * loaded every feature (so its gutters and chrome have taken their places),
 * or after a while whatever happens: it must never cover a working editor
 * for long.
 */
export function settleSnapshot(
  parent: HTMLElement,
  note: Opening,
  featuresLoaded: Promise<unknown>,
): void {
  const snapshot = parent.ownerDocument.querySelector<HTMLElement>(
    `.${SNAPSHOT_CLASS}`,
  );
  if (!snapshot) {
    return;
  }
  if (!snapshotMatches(snapshot, note)) {
    snapshot.remove();
    return;
  }
  const timeout = new Promise((resolve) =>
    setTimeout(resolve, LONGEST_COVER_MS),
  );
  void Promise.race([featuresLoaded, timeout]).then(() => fadeOut(snapshot));
}

/**
 * Takes the snapshot away by letting the editor show through. The editor
 * beneath is complete and already takes input and scrolling: the snapshot
 * never takes pointer events, so the fade is only what the reader sees, and
 * nothing waits for it. Without motion it goes at once.
 */
function fadeOut(snapshot: HTMLElement): void {
  const view = snapshot.ownerDocument.defaultView;
  if (view?.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
    snapshot.remove();
    return;
  }
  snapshot.classList.add(LEAVING_CLASS);
  snapshot.addEventListener("transitionend", () => snapshot.remove(), {
    once: true,
  });
  // Where no transition runs (a hidden webview) the snapshot goes anyway.
  setTimeout(() => snapshot.remove(), FADE_MS + 50);
}

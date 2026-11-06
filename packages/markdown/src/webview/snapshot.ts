import { platformOf } from "../plugins/editor/font";
import {
  opensAtTop,
  SNAPSHOT_CLASS,
  snapshotLayout,
} from "../plugins/editor/snapshot-layout";
import type { NoteSettings } from "../shared/host";

/** The longest the snapshot stays over an editor whose features are still loading (ms). */
const LONGEST_COVER_MS = 2000;

type Opening = Pick<NoteSettings, "preset" | "mode" | "editor" | "features"> & {
  openingSelection?: { anchor: number; head: number; topLine?: number };
};

/**
 * Whether the editor will draw what the snapshot drew. It will not when the
 * note opens somewhere other than its top (a search match; a restored view
 * is the page's loader's to see) or with settings other than the host
 * assumed when it built the snapshot (an Obsidian vault's own settings reach
 * the host after the page is set).
 */
export function snapshotMatches(snapshot: HTMLElement, note: Opening): boolean {
  if (!opensAtTop(note.openingSelection)) {
    return false;
  }
  const layout = snapshotLayout(note, platformOf(navigator.platform));
  return layout?.key === snapshot.dataset.layout;
}

/**
 * Keeps the snapshot only while it shows what the editor will draw: it goes
 * at once when `snapshotMatches` says it does not (the editor is about to
 * mount), otherwise once the editor beneath it has loaded every feature (so
 * its gutters and chrome have taken their places) and painted, or after a
 * while whatever happens: it must never cover a working editor for long.
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
  void Promise.race([featuresLoaded, timeout]).then(() =>
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        snapshot.remove();
      }),
    ),
  );
}

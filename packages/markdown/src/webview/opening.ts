import { features } from "../plugins/catalog";
import type { SettledGutters } from "../plugins/editor/snapshot-layout";
import { BLOCK_RENDERER_KINDS } from "../shared/first-view";
import type { NoteSettings } from "../shared/host";

/**
 * The opening: from the moment the editor mounts until its features have
 * loaded and what they draw has been revealed. `parent` carries the class
 * `is-opening` meanwhile, and opening.css animates only under it, so the
 * widgets CodeMirror mounts again while the reader scrolls never animate.
 * Nothing waits on it: the class is set and cleared, and no work, input or
 * scrolling depends on the reveal having ended.
 */

export const OPENING_CLASS = "is-opening";

/**
 * The gutter columns the note will have, as classes on the opening parent:
 * opening.css keeps room for each until it has mounted, so the text does not
 * move when the line numbers, change bars and fold markers arrive.
 */
const GUTTER_CLASSES = {
  lineNumbers: "opens-with-line-numbers",
  gitGutter: "opens-with-git-gutter",
  folding: "opens-with-fold-gutter",
} as const;

/** How long a reveal lasts (ms); `--mw-reveal-ms` in opening.css is the same. */
export const REVEAL_MS = 100;

/** The class goes this long after the editor mounts at the latest (ms). */
export const LONGEST_OPENING_MS = 3000;

interface Marked {
  readonly classList: Pick<DOMTokenList, "add" | "remove">;
}

type Schedule = (run: () => void, ms: number) => void;

const inTime: Schedule = (run, ms) => void setTimeout(run, ms);

/** Marks `parent` as opening, before the editor's first frame. */
export function beginOpening(parent: Marked, gutters: SettledGutters): void {
  parent.classList.add(OPENING_CLASS);
  for (const [column, name] of Object.entries(GUTTER_CLASSES)) {
    if (gutters[column as keyof SettledGutters]) {
      parent.classList.add(name);
    }
  }
}

/**
 * Clears the mark a reveal after the features have loaded, so what they
 * mounted last has finished its reveal; or `LONGEST_OPENING_MS` after the
 * editor mounted, whatever the features do.
 */
export function endOpening(
  parent: Marked,
  featuresLoaded: Promise<unknown>,
  schedule: Schedule = inTime,
): void {
  const end = () =>
    parent.classList.remove(OPENING_CLASS, ...Object.values(GUTTER_CLASSES));
  const revealed = () => schedule(end, REVEAL_MS);
  featuresLoaded.then(revealed, revealed);
  schedule(end, LONGEST_OPENING_MS);
}

/**
 * The kinds of block widget a note's features will draw once they have loaded
 * (the Properties sheet, callouts, tables, display math, diagrams, embeds), so
 * Live Preview holds their places until then (livePreview/pending-blocks.ts).
 * `defaults` says whether a feature with no setting is on. The sheet is only
 * awaited where Properties shows it: not hidden, not as source.
 */
export function expectedBlockKinds(
  settings: NoteSettings["features"],
  defaults = true,
): string[] {
  const defaultOn = new Map(
    features.map((manifest) => [manifest.id, manifest.defaultEnabled]),
  );
  const isOn = (id: string) =>
    settings?.[id]?.enabled ?? (defaults && (defaultOn.get(id) ?? false));
  const showsSheet =
    (settings?.properties?.config.display ?? "visible") === "visible";
  return Object.entries(BLOCK_RENDERER_KINDS)
    .filter(([id]) => isOn(id) && (id !== "properties" || showsSheet))
    .map(([, kind]) => kind);
}

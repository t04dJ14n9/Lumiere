/**
 * The opening: from the moment the editor mounts until its features have
 * loaded and what they draw has been revealed. `parent` carries the class
 * `is-opening` meanwhile, and opening.css animates only under it, so the
 * widgets CodeMirror mounts again while the reader scrolls never animate.
 * Nothing waits on it: the class is set and cleared, and no work, input or
 * scrolling depends on the reveal having ended.
 */

export const OPENING_CLASS = "is-opening";

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
export function beginOpening(parent: Marked): void {
  parent.classList.add(OPENING_CLASS);
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
  const end = () => parent.classList.remove(OPENING_CLASS);
  const revealed = () => schedule(end, REVEAL_MS);
  featuresLoaded.then(revealed, revealed);
  schedule(end, LONGEST_OPENING_MS);
}

import type { PageRect } from "../shared/geometry";

/**
 * The word under the pointer, laid out where it is drawn in its page, while
 * Look Up is on (see look-up.ts). The page shows it as hidden text
 * (look-up-word.tsx) for the system's own Look Up to find.
 */
export interface LookUpTarget {
  pageIndex: number;
  /** Left, top, right, bottom in points. */
  box: PageRect;
  /** The text of the word's glyphs, as the PDF has it. */
  text: string;
}

let current: LookUpTarget | undefined;
const listeners = new Set<() => void>();

export function lookUpTarget(): LookUpTarget | undefined {
  return current;
}

/** Show `target` (a new object for the same word changes nothing), or none. */
export function setLookUpTarget(target: LookUpTarget | undefined): void {
  if (isSameTarget(current, target)) {
    return;
  }
  current = target;
  for (const listener of listeners) {
    listener();
  }
}

export function onLookUpTargetChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function isSameTarget(
  a: LookUpTarget | undefined,
  b: LookUpTarget | undefined,
): boolean {
  if (!a || !b) {
    return a === b;
  }
  return (
    a.pageIndex === b.pageIndex &&
    a.text === b.text &&
    a.box.every((edge, index) => edge === b.box[index])
  );
}

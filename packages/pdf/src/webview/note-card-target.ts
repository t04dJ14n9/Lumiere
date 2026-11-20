/** The note card's class (note-card.tsx): what pointer and copy handlers recognise. */
export const NOTE_CARD_CLASS = "note-card";

/** Whether an event happened inside a note card. */
export function isInNoteCard(target: EventTarget | null): boolean {
  return (elementOf(target)?.closest(`.${NOTE_CARD_CLASS}`) ?? null) !== null;
}

/** The element an event target is, or the one a text node is in. */
function elementOf(target: EventTarget | null): Element | null {
  if (target instanceof Element) {
    return target;
  }
  return target instanceof Node ? target.parentElement : null;
}

/** The attribute a note icon (note-badges.tsx) names its mark by. */
export const NOTE_KEY_ATTRIBUTE = "data-note-key";

/** The mark a note icon under the pointer stands for, if the pointer is on one. */
export function noteKeyOfBadge(target: EventTarget | null): string | undefined {
  return (
    elementOf(target)
      ?.closest(`[${NOTE_KEY_ATTRIBUTE}]`)
      ?.getAttribute(NOTE_KEY_ATTRIBUTE) ?? undefined
  );
}

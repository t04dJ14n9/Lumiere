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

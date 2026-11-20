/**
 * When a mark's note card shows, like VS Code's own hovers: only once the
 * pointer rests on the mark, so passing over the page shows nothing, and it
 * stays while the pointer crosses into the card to read it or follow a link.
 * Marks are named by a key (`annotationKey`); the viewer reports which one is
 * under the pointer and draws `onChange`'s.
 */

/** How long the pointer rests on a mark before its note shows. */
export const NOTE_OPEN_DELAY_MS = 350;
/** How long the card waits, after the pointer left mark and card, to close. */
export const NOTE_CLOSE_DELAY_MS = 250;

export interface NoteHoverOptions {
  schedule: (run: () => void, ms: number) => { cancel: () => void };
  /** The mark whose note now shows, or undefined for none. */
  onChange: (key: string | undefined) => void;
}

export interface NoteHover {
  /** The mark with a note under the pointer, or undefined. */
  pointerOver(key: string | undefined): void;
  cardEntered(): void;
  cardLeft(): void;
  /** Close now (a press, a scroll, Escape), and forget a pending one. */
  dismiss(): void;
  shown(): string | undefined;
  dispose(): void;
}

type Schedule = NoteHoverOptions["schedule"];

/** One timer at a time: setting it again replaces what was waiting. */
function timerSlot(schedule: Schedule) {
  let cancel: (() => void) | undefined;
  let tag: string | undefined;
  return {
    /** What the waiting timer is for, if one waits. */
    tag: () => (cancel ? (tag ?? "") : undefined),
    set(run: () => void, ms: number, label?: string): void {
      cancel?.();
      tag = label;
      cancel = schedule(() => {
        cancel = undefined;
        run();
      }, ms).cancel;
    },
    clear(): void {
      cancel?.();
      cancel = undefined;
    },
  };
}

export function createNoteHover(options: NoteHoverOptions): NoteHover {
  let shown: string | undefined;
  let overCard = false;
  const opening = timerSlot(options.schedule);
  const closing = timerSlot(options.schedule);
  const stop = (): void => {
    opening.clear();
    closing.clear();
  };
  const show = (key: string | undefined): void => {
    if (shown !== key) {
      shown = key;
      options.onChange(key);
    }
  };
  const closeLater = (): void => {
    if (shown !== undefined && !overCard && closing.tag() === undefined) {
      closing.set(() => show(undefined), NOTE_CLOSE_DELAY_MS);
    }
  };
  const openLater = (key: string): void => {
    if (opening.tag() !== key) {
      opening.set(
        () => {
          closing.clear();
          show(key);
        },
        NOTE_OPEN_DELAY_MS,
        key,
      );
    }
  };
  return {
    pointerOver(key) {
      if (key !== undefined && key === shown) {
        stop();
      } else if (key === undefined) {
        opening.clear();
        closeLater();
      } else {
        // From one mark straight onto another: its note replaces this one
        // when it opens, without the card closing in between.
        openLater(key);
      }
    },
    cardEntered() {
      overCard = true;
      stop();
    },
    cardLeft() {
      overCard = false;
      closeLater();
    },
    dismiss() {
      stop();
      overCard = false;
      show(undefined);
    },
    shown: () => shown,
    dispose: stop,
  };
}

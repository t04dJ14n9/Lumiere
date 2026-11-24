/**
 * When a mark's note card shows, like VS Code's own hovers: only once the
 * pointer rests on the mark, so passing over the page shows nothing, and it
 * stays while the pointer crosses into the card to read it or follow a link.
 * While the note is being written (Edit Note…), it stays until the edit
 * ends, whatever the pointer does. Marks are named by a key
 * (`annotationKey`); the viewer reports which one is under the pointer and
 * draws `onChange`'s.
 */

/** How long the pointer rests on a mark before its note shows. */
export const NOTE_OPEN_DELAY_MS = 350;
/** How long the card waits, after the pointer left mark and card, to close. */
export const NOTE_CLOSE_DELAY_MS = 250;

export interface NoteHoverOptions {
  schedule: (run: () => void, ms: number) => { cancel: () => void };
  /** The mark whose note now shows (undefined for none), and whether it is being written. */
  onChange: (key: string | undefined, editing: boolean) => void;
  /**
   * Ends the note being written, keeping its text. Asked before another
   * mark's note opens for writing, so the text written is not lost.
   */
  commitEdit?: () => void;
}

export interface NoteHover {
  /** The mark with a note under the pointer, or undefined. */
  pointerOver(key: string | undefined): void;
  cardEntered(): void;
  cardLeft(): void;
  /** Close now (a press, a scroll, Escape), and forget a pending one. */
  dismiss(): void;
  /**
   * Show this mark's note at once, to read (a press on its note icon). It
   * then stays and closes as a hover's does; a note being written is left
   * as it is.
   */
  open(key: string): void;
  /** Show this mark's note at once, to be written; another being written is committed first. */
  edit(key: string): void;
  /** The note is written (or not): a hover again, or closed with `close`. */
  endEdit(options?: { close?: boolean }): void;
  shown(): string | undefined;
  editing(): boolean;
  dispose(): void;
}

export function createNoteHover(options: NoteHoverOptions): NoteHover {
  return new NoteHoverController(options);
}

/**
 * The text a finished edit keeps: undefined when the writer left it as the
 * editor started, so a note changed elsewhere meanwhile is not written back.
 */
export function changedText(started: string, text: string): string | undefined {
  return text === started ? undefined : text;
}

type Schedule = NoteHoverOptions["schedule"];

/** One timer at a time: setting it again replaces what was waiting. */
class TimerSlot {
  private cancelWaiting: (() => void) | undefined;
  private label: string | undefined;

  constructor(private readonly schedule: Schedule) {}

  /** What the waiting timer is for ("" when unlabelled), or undefined when none waits. */
  tag(): string | undefined {
    return this.cancelWaiting ? (this.label ?? "") : undefined;
  }

  set(run: () => void, ms: number, label?: string): void {
    this.clear();
    this.label = label;
    this.cancelWaiting = this.schedule(() => {
      this.cancelWaiting = undefined;
      run();
    }, ms).cancel;
  }

  clear(): void {
    this.cancelWaiting?.();
    this.cancelWaiting = undefined;
  }
}

class NoteHoverController implements NoteHover {
  private key: string | undefined;
  private writing = false;
  private overCard = false;
  private readonly opening: TimerSlot;
  private readonly closing: TimerSlot;

  constructor(private readonly options: NoteHoverOptions) {
    this.opening = new TimerSlot(options.schedule);
    this.closing = new TimerSlot(options.schedule);
  }

  pointerOver(key: string | undefined): void {
    if (this.writing) {
      return;
    }
    if (key !== undefined && key === this.key) {
      this.dispose();
    } else if (key === undefined) {
      this.opening.clear();
      this.closeLater();
    } else if (this.opening.tag() !== key) {
      // From one mark straight onto another: its note replaces this one
      // when it opens, without the card closing in between.
      this.opening.set(
        () => {
          this.closing.clear();
          this.show(key, false);
        },
        NOTE_OPEN_DELAY_MS,
        key,
      );
    }
  }

  cardEntered(): void {
    this.overCard = true;
    this.dispose();
  }

  cardLeft(): void {
    this.overCard = false;
    this.closeLater();
  }

  dismiss(): void {
    if (!this.writing) {
      this.dispose();
      this.overCard = false;
      this.show(undefined, false);
    }
  }

  open(key: string): void {
    if (!this.writing) {
      this.dispose();
      this.overCard = false;
      this.show(key, false);
    }
  }

  edit(key: string): void {
    if (this.writing && this.key !== key) {
      this.options.commitEdit?.();
    }
    this.dispose();
    this.overCard = false;
    this.show(key, true);
  }

  endEdit(options: { close?: boolean } = {}): void {
    if (this.writing) {
      this.show(options.close ? undefined : this.key, false);
    }
  }

  shown(): string | undefined {
    return this.key;
  }

  editing(): boolean {
    return this.writing;
  }

  /** Stop every timer. */
  dispose(): void {
    this.opening.clear();
    this.closing.clear();
  }

  private show(key: string | undefined, writing: boolean): void {
    if (this.key !== key || this.writing !== writing) {
      this.key = key;
      this.writing = writing;
      this.options.onChange(key, writing);
    }
  }

  private closeLater(): void {
    if (
      this.key !== undefined &&
      !this.writing &&
      !this.overCard &&
      this.closing.tag() === undefined
    ) {
      this.closing.set(() => this.show(undefined, false), NOTE_CLOSE_DELAY_MS);
    }
  }
}

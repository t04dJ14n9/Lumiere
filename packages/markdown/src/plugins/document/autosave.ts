import type { Logger } from "@workshop/core";
import type { HostDocument, HostSettings } from "../../shared/host";

/** How long a note rests after its last edit before it is saved, as in Obsidian. */
export const AUTOSAVE_DELAY_MS = 2000;

export interface AutosaveOptions {
  document: HostDocument;
  settings: Pick<HostSettings, "forNote">;
  /** The document's one save path (`Session.save`): VS Code still does the write. */
  save: () => Promise<boolean>;
  logger: Logger;
}

/**
 * Saves one note a moment after its last edit while a panel has it open.
 * Edits only ever start the countdown; what decides whether it saves is read
 * when it ends, so a setting changed meanwhile applies, and a note saved by
 * hand in the meantime is simply found clean.
 *
 * A failed save is not tried again by itself: VS Code reports it (a file that
 * changed on disk becomes its conflict dialog), and saving again with nothing
 * new to save would only repeat the dialog. The next edit starts afresh.
 */
export class Autosave {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private saving = false;
  /** The countdown ended while a save was running: save again after it. */
  private deferred = false;
  private stopped = false;

  constructor(private readonly options: AutosaveOptions) {}

  /** The note's text changed. */
  edited(): void {
    if (!this.stopped) {
      this.arm();
    }
  }

  /** The last panel closed, or the plugin stopped. */
  dispose(): void {
    this.stopped = true;
    clearTimeout(this.timer);
    this.timer = undefined;
  }

  private arm(): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.countdownEnded(), AUTOSAVE_DELAY_MS);
  }

  private countdownEnded(): void {
    this.timer = undefined;
    if (!this.isDue()) {
      return;
    }
    if (this.saving) {
      this.deferred = true;
      return;
    }
    void this.saveNote();
  }

  /**
   * Whether the note is ours to save. With VS Code's own `files.autoSave` on
   * it saves the note itself, and a second saver would only race it. An
   * untitled note's save asks where to put it. Settings that a host does not
   * report (a fake in a test) leave the note alone.
   */
  private isDue(): boolean {
    const { document, settings } = this.options;
    if (!document.isDirty || document.isUntitled) {
      return false;
    }
    const editor = settings.forNote(document).editor;
    return editor?.autosave === true && editor.filesAutoSave === "off";
  }

  private async saveNote(): Promise<void> {
    this.saving = true;
    this.deferred = false;
    const saved = await this.options.save().catch((error: unknown) => {
      this.options.logger.warn("Autosave failed", error);
      return false;
    });
    this.saving = false;
    // Only a save that worked is followed by another. A countdown that began
    // after this one's edits is already running and keeps its own time.
    if (saved && this.deferred && this.timer === undefined && !this.stopped) {
      this.arm();
    }
  }
}

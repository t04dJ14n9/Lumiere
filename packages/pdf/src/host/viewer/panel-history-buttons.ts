import type { HostMessage } from "../../shared/messages";

/**
 * Whether there is a place to go Back to and Forward to, as the history of
 * this editor says (`pdfHistory`): the title buttons and the viewer's own
 * buttons are enabled by it. A rebuilt page is told again after it loads.
 */
export class HistoryButtons {
  private state = { back: false, forward: false };

  constructor(
    private readonly host: {
      post(message: HostMessage): void;
      changed(): void;
    },
  ) {}

  get back(): boolean {
    return this.state.back;
  }

  get forward(): boolean {
    return this.state.forward;
  }

  /** What a rebuilt page is told. */
  get current(): { back: boolean; forward: boolean } {
    return this.state;
  }

  set(back: boolean, forward: boolean): void {
    if (back === this.state.back && forward === this.state.forward) {
      return;
    }
    this.state = { back, forward };
    this.host.post({ type: "historyState", back, forward });
    this.host.changed();
  }
}

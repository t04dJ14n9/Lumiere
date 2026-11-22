import type { HostMessage } from "../../shared/messages";
import type { ViewerPanelOptions } from "./panel-types";
import {
  DEFAULT_SIDE_PANEL,
  sameSidePanelState,
  type SidePanelState,
} from "../../shared/side-panel";

/** What the side panel's state needs of the panel that holds it. */
export interface SidePanelHost {
  post(message: HostMessage): void;
  /** The state changed: menus and the title button read it. */
  changed(): void;
  /** Give the keyboard back to the viewer, which a title button took it from. */
  refocus(): void;
}

/**
 * The side panel of one PDF editor: open or closed, how wide, which tab. It
 * lives here, with the editor, rather than in the page: the page is rebuilt
 * whenever the editor is hidden and shown again or moved to another window,
 * and the title button and the command read the state without asking it.
 * The viewer sends each choice the reader makes; a command changes it here
 * and tells the viewer.
 */
export class PanelSidePanel {
  private state: SidePanelState;

  constructor(
    private readonly options: Pick<
      ViewerPanelOptions,
      "sidePanel" | "saveSidePanel"
    >,
    private readonly host: SidePanelHost,
  ) {
    this.state = options.sidePanel ?? DEFAULT_SIDE_PANEL;
  }

  get current(): SidePanelState {
    return this.state;
  }

  /** The reader opened, closed, resized or switched it in the viewer, which has it already. */
  chosenInViewer(state: SidePanelState): void {
    this.set(state, false);
  }

  /** A command or title button turned it on or off. */
  toggle(): void {
    this.set({ ...this.state, open: !this.state.open }, true);
    this.host.refocus();
  }

  private set(state: SidePanelState, tellViewer: boolean): void {
    if (sameSidePanelState(state, this.state)) {
      return;
    }
    this.state = state;
    if (tellViewer) {
      this.host.post({ type: "sidePanel", state });
    }
    this.options.saveSidePanel?.(state);
    this.host.changed();
  }
}

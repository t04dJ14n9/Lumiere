import { useSyncExternalStore } from "react";
import {
  DEFAULT_SIDE_PANEL,
  parseSidePanelState,
  sameSidePanelState,
  type SidePanelState,
} from "../../shared/side-panel";
import { postToHost } from "../host";

/**
 * The side panel's state in this page. The extension keeps the truth for the
 * editor (`PanelSidePanel`): a load brings it, a command changes it, and the
 * reader's choices are sent back. It lives here, outside the components,
 * because the viewer is made anew for every load of the file, and a panel
 * the reader had open must not close because the PDF was rebuilt.
 */
let state: SidePanelState | undefined;
/** What the extension has: a choice not yet sent is what differs from it. */
let told: SidePanelState | undefined;
const listeners = new Set<() => void>();

/**
 * A load says how the editor left the panel. A page that already has a state
 * keeps it: its own choice may still be on its way to the extension, and a
 * load that left before the choice arrived would put the old one back.
 */
export function prepareSidePanel(fromHost: unknown): void {
  if (state === undefined) {
    state = parseSidePanelState(fromHost) ?? DEFAULT_SIDE_PANEL;
    told = state;
  }
}

export function sidePanelState(): SidePanelState {
  return state ?? DEFAULT_SIDE_PANEL;
}

/** The extension changed it (Toggle Side Panel). */
export function rememberSidePanel(fromHost: unknown): void {
  const next = parseSidePanelState(fromHost);
  if (next) {
    state = next;
    told = next;
    notify();
  }
}

/**
 * The reader's choice. A width being dragged shows at once and is told to the
 * extension (`commit`) only when the drag ends, not on every pixel.
 */
export function chooseSidePanel(
  change: Partial<SidePanelState>,
  options: { commit?: boolean } = {},
): void {
  const next = { ...sidePanelState(), ...change };
  if (!sameSidePanelState(next, sidePanelState())) {
    state = next;
    notify();
  }
  if (options.commit !== false && told && !sameSidePanelState(next, told)) {
    told = next;
    postToHost({ type: "sidePanel", state: next });
  }
}

function notify(): void {
  for (const listener of listeners) {
    listener();
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useSidePanelState(): SidePanelState {
  return useSyncExternalStore(subscribe, sidePanelState);
}

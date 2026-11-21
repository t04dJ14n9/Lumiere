import type { Disposer } from "@workshop/core";
import type { HostCommands } from "../../shared/host";
import { contributionId } from "../../shared/setting-schema";

/**
 * How the switcher's choice opens. Obsidian's switcher takes Enter, Mod+Enter
 * (a new tab), Mod+Alt+Enter (to the right), Shift+Enter (create the typed
 * name) and Mod+Shift+Enter (create it in a new tab). VS Code tells a quick
 * pick nothing about the keys that accepted it, so each modifier key is a
 * key binding of its own, live only while the switcher is open, that notes
 * how to open and then accepts the selected row.
 */
export interface Acceptance {
  /** `tab`: a tab of its own that stays open; `side`: the group beside. */
  place: "here" | "tab" | "side";
  /** Create a note named by the query, whatever row is selected. */
  isCreate: boolean;
}

export const ENTER: Acceptance = { place: "here", isCreate: false };

/** True while the switcher's quick pick is shown; the keys' `when`. */
export const SWITCHER_OPEN_CONTEXT = contributionId("quickSwitcherOpen");

/** The commands the modifier keys run, by local id. */
export const ACCEPT_COMMANDS: readonly (Acceptance & { id: string })[] = [
  { id: "quickSwitcher.openInNewTab", place: "tab", isCreate: false },
  { id: "quickSwitcher.openToSide", place: "side", isCreate: false },
  { id: "quickSwitcher.create", place: "here", isCreate: true },
  { id: "quickSwitcher.createInNewTab", place: "tab", isCreate: true },
];

/** VS Code's command that accepts the open quick pick's selected row. */
const ACCEPT_SELECTED = "workbench.action.acceptSelectedQuickOpenItem";

/**
 * The modifier keys' commands and the acceptance the last one noted. Each
 * switcher run starts with `begin` and reads `end` once its pick resolves:
 * the key's command notes the acceptance before it accepts the row, so it is
 * in place when the pick resolves.
 */
export class AcceptKeys {
  private pending: Acceptance | undefined;

  constructor(private readonly commands: HostCommands) {}

  /** Register the commands; returns their disposers. */
  register(): Disposer[] {
    return ACCEPT_COMMANDS.map(({ id, place, isCreate }) =>
      this.commands.register(contributionId(id), () => {
        this.pending = { place, isCreate };
        return this.commands.execute(ACCEPT_SELECTED);
      }),
    );
  }

  /** Mark the switcher open, so the keys apply, and forget any earlier key. */
  async begin(): Promise<void> {
    this.pending = undefined;
    await this.setOpen(true);
  }

  /** Mark the switcher closed and take how its choice opens. */
  async end(): Promise<Acceptance> {
    const acceptance = this.pending ?? ENTER;
    this.pending = undefined;
    await this.setOpen(false);
    return acceptance;
  }

  /** Hosts without context keys (host-node) ignore it; never fail the switcher. */
  private async setOpen(isOpen: boolean): Promise<void> {
    await this.commands
      .execute("setContext", SWITCHER_OPEN_CONTEXT, isOpen)
      .catch(() => undefined);
  }
}

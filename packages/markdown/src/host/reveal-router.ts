import type {
  RevealPanel,
  NavigationTarget,
  NavigationIntent,
  PanelShell,
} from "../shared/host";
import { CancelToken } from "../shared/rpc/lifecycle";
import { silentLogger } from "@workshop/core";
import type { Disposer, Logger } from "@workshop/core";

/** How long a reveal waits for its editor's Links plugin to register it. */
const REGISTRATION_TIMEOUT_MS = 15000;

/**
 * No URI mailbox: the native opener assigns one exact panel before delivery.
 * A reveal that comes to nothing is logged with the panel id: the user sees
 * only a note that opened without moving to the heading.
 */
export class RevealRouter {
  private readonly panels = new Map<string, RevealPanel>();
  private readonly changed = new Set<() => void>();
  private latest = 0;
  private token = new CancelToken();
  constructor(private readonly logger: Logger = silentLogger) {}
  begin(): { requestId: number; token: CancelToken } {
    this.token.cancel();
    this.token = new CancelToken();
    return { requestId: ++this.latest, token: this.token };
  }
  register(panel: RevealPanel): () => void {
    this.panels.set(panel.id, panel);
    for (const changed of this.changed) {
      changed();
    }
    return () => {
      if (this.panels.get(panel.id) === panel) {
        this.panels.delete(panel.id);
      }
    };
  }
  async deliver(
    intent: NavigationIntent,
    id: string,
    target: NavigationTarget,
  ): Promise<boolean> {
    const panel = intent.token.cancelled
      ? undefined
      : await this.destination(id, intent.token);
    if (!panel || intent.token.cancelled) {
      this.logUndelivered(intent, id);
      return false;
    }
    try {
      const applied = await panel.reveal(
        { ...target, requestId: intent.requestId },
        intent.token,
      );
      const isCurrent = this.panels.get(id) === panel;
      if (!applied || !isCurrent || intent.token.cancelled) {
        this.logRefused(intent, id);
        return false;
      }
      return true;
    } catch (error) {
      if (intent.token.cancelled) {
        this.logUndelivered(intent, id);
        return false;
      }
      throw error;
    }
  }
  private logUndelivered(intent: NavigationIntent, id: string): void {
    if (intent.token.cancelled) {
      this.logger.debug("Reveal cancelled by a newer navigation", id);
      return;
    }
    // Usually the Links plugin is off for this note: it registers reveals.
    this.logger.warn("No editor registered to reveal the target in time", id);
  }
  private logRefused(intent: NavigationIntent, id: string): void {
    if (intent.token.cancelled) {
      this.logUndelivered(intent, id);
      return;
    }
    this.logger.debug("The editor did not reveal the target", id);
  }
  private destination(
    id: string,
    token: NavigationIntent["token"],
  ): Promise<RevealPanel | undefined> {
    const ready = this.panels.get(id);
    if (ready) {
      return Promise.resolve(ready);
    }
    // Vault initialization may still be starting this exact panel's links plugin.
    return new Promise((resolve) => {
      let stop: Disposer = () => {};
      const finish = (panel?: RevealPanel) => {
        clearTimeout(timer);
        this.changed.delete(check);
        void stop();
        resolve(panel);
      };
      const check = () => {
        const panel = this.panels.get(id);
        if (panel) {
          finish(panel);
        }
      };
      const timer = setTimeout(() => finish(), REGISTRATION_TIMEOUT_MS);
      this.changed.add(check);
      stop = token.onCancel(() => finish());
      check();
    });
  }
}

/** Select once from native shells; never guess among same-URI split panes. */
export function chooseRevealPanel(
  panels: readonly PanelShell[],
  before: ReadonlySet<string>,
  target: { uri: string; side: boolean; column: number },
): PanelShell | undefined {
  const candidates = panels.filter(
    (panel) => panel.document.uri === target.uri,
  );
  const created = candidates.filter((panel) => !before.has(panel.id));
  const reused = candidates.filter((panel) =>
    target.side
      ? panel.column !== target.column
      : panel.column === target.column,
  );
  const pool = created.length > 0 ? created : reused;
  // Unique panel identity is enough. Requiring active() broke Outline clicks:
  // focus is in the tree, so the webview is inactive even though this tab is
  // still the only destination for the URI.
  return pool.length === 1 ? pool[0] : undefined;
}

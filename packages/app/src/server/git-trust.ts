/**
 * Which vaults the reader lets git run in (host-node's `GitTrust`). Git runs
 * a repository's own configuration, and a vault from someone else can name
 * programs there (a filter, a diff driver). So the first time git is wanted
 * in a vault, the window asks; until the reader allows it, blame, the change
 * gutter and staging are off there. "Allow" is remembered in `git-trust.json`;
 * "Not Now" lasts until the server restarts, so a vault is never stuck
 * without a way back.
 */
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { GitTrust } from "@workshop/host-node";
import { saveFile } from "./json-file";

export class GitTrustStore implements GitTrust {
  private trusted = new Set<string>();
  /** Vaults waiting for the reader's answer, in the order they were wanted. */
  private readonly asking = new Set<string>();
  /** Answered "Not Now" in this run. */
  private readonly declined = new Set<string>();
  private readonly listeners = new Set<() => void>();
  private readonly askListeners = new Set<() => void>();
  private writing: Promise<void> = Promise.resolve();

  /** `file`: where the trusted vaults are remembered. */
  constructor(private readonly file: string) {}

  async load(): Promise<void> {
    try {
      const saved: unknown = JSON.parse(await readFile(this.file, "utf8"));
      this.trusted = new Set(
        Array.isArray(saved)
          ? saved.filter((item): item is string => typeof item === "string")
          : [],
      );
    } catch {
      this.trusted = new Set();
    }
  }

  /** A workspace root's URI: trusted, or asked about once and false meanwhile. */
  isTrusted(root: string): boolean {
    const vault = vaultPath(root);
    if (vault === undefined) {
      return false;
    }
    if (this.trusted.has(vault)) {
      return true;
    }
    if (!this.declined.has(vault) && !this.asking.has(vault)) {
      this.asking.add(vault);
      this.emit(this.askListeners);
    }
    return false;
  }

  onDidChange(listener: () => void): () => void {
    return subscribe(this.listeners, listener);
  }

  /** The window should ask (GET /api/git-trust): a vault was added to `waiting`. */
  onAsk(listener: () => void): () => void {
    return subscribe(this.askListeners, listener);
  }

  /** The vaults whose answer git waits for. */
  waiting(): readonly string[] {
    return [...this.asking];
  }

  /** The reader's answer for `vault`, from the window (POST /api/git-trust). */
  async answer(vault: string, allow: boolean): Promise<void> {
    if (!this.asking.delete(vault)) {
      throw new Error(`Git did not ask about ${vault}`);
    }
    if (!allow) {
      this.declined.add(vault);
      this.emit(this.askListeners);
      return;
    }
    this.declined.delete(vault);
    this.trusted.add(vault);
    const text = JSON.stringify([...this.trusted], null, 2) + "\n";
    // One write at a time, each of the latest set.
    this.writing = this.writing
      .catch(() => {})
      .then(() => saveFile(this.file, text));
    await this.writing;
    this.emit(this.askListeners);
    this.emit(this.listeners);
  }

  private emit(listeners: ReadonlySet<() => void>): void {
    for (const listener of listeners) {
      listener();
    }
  }
}

/** The vault's path, as the window names it; undefined for a URI that is no file. */
function vaultPath(root: string): string | undefined {
  try {
    return fileURLToPath(root);
  } catch {
    return undefined;
  }
}

function subscribe(
  listeners: Set<() => void>,
  listener: () => void,
): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

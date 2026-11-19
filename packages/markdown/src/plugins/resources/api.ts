import type { LinkSyntax } from "../../shared/vault-path";
import type { DiffSide } from "../../shared/git";
import type { BaseNoteEntry } from "../../markdown/bases";

export type { BaseNoteEntry } from "../../markdown/bases";

export interface Resource {
  kind: "note" | "base" | "image" | "audio" | "video" | "pdf" | "file";
  source: string;
  url: string;
  text?: string;
  entries?: BaseNoteEntry[];
  thisEntry?: BaseNoteEntry;
  /** A base's snapshot version (`BaseSnapshots`); the page fills `entries`. */
  snapshot?: number;
  /** A base's entries that changed since the snapshot the page holds. */
  changed?: BaseNoteEntry[];
}
export interface Resources {
  /** Known source-note allowlist (owning doc and nested Markdown notes). */
  authorize?(source: string): Promise<void>;
  /** Vault containment for a target that is not itself a known source note. */
  authorizeTarget?(target: string): Promise<void>;
  /**
   * A base's reply leaves out what the page already holds when `snapshot`
   * names the version of the panel's base snapshot it has.
   */
  load(
    target: string,
    source?: string,
    syntax?: LinkSyntax,
    snapshot?: number,
  ): Promise<Resource>;
  peek?(
    target: string,
    source?: string,
    syntax?: LinkSyntax,
  ): Resource | undefined;
}
declare module "@workshop/core" {
  interface Services {
    resources: Resources;
  }
  interface Events {
    /**
     * Vault files a note shows were rewritten (a sketch saved, say): what
     * was resolved before points at their old versions. Listeners drop it;
     * the emitter then emits `render/changed` to show the new ones.
     * @mode emit
     */
    "resources/changed": () => void;
    /**
     * Files a note could not show before are in the vault now (synced, or
     * written by another app or a plugin). Embeds that said they could not
     * be found load again.
     * @mode emit
     */
    "resources/found": () => void;
    /**
     * Vault files the note shows changed (edited in another editor,
     * rewritten by another app, moved or removed), by URI. The resolved
     * resources are dropped first; embeds showing them load them again.
     * @mode emit
     */
    "resources/modified": (sources: readonly string[]) => void;
  }
}

export interface DiffResources {
  forSide(side: DiffSide): Promise<{
    root: string;
    load(target: string): Promise<string>;
  }>;
}
declare module "@workshop/core" {
  interface Services {
    diffResources: DiffResources;
  }
}

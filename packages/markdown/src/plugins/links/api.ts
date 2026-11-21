import { StateEffect, StateField, type EditorState } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import type { Infer } from "@workshop/core";
import type { request as requestSchema } from "./protocol";
import { unresolvedKey } from "./target";

/** Where a followed link opens: here, in a new tab (`tab`) or to the side. */
export interface LinkPlace {
  tab?: boolean;
  side?: boolean;
}

export interface LinksService {
  /**
   * Follow the link (or tag) at the focused editor's caret, including a
   * projected cell's, here or at `place`. False when the editor does not
   * have the focus or nothing at its caret follows.
   */
  follow(view: EditorView, place?: LinkPlace): boolean;
}
export type LinkRequest = Infer<typeof requestSchema> & {
  source: string;
  editorId?: string;
};
declare module "@workshop/core" {
  interface Services {
    links: LinksService;
  }
  interface Events {
    /** @mode bail */ "links/open": (
      request: LinkRequest,
    ) => Promise<true> | undefined;
    /**
     * Follow Link, Open Link in New Tab or Open Link to Side found no link at
     * `at`: a plugin whose token is there follows it (Tags searches a tag),
     * as Obsidian's commands follow any clickable token. @mode bail
     */
    "links/followToken": (state: EditorState, at: number) => true | undefined;
    /** @mode bail */ "link/click": (
      request: Infer<typeof requestSchema>,
    ) => true | undefined;
  }
}

export const setUnresolved = StateEffect.define<ReadonlySet<string>>();

/** The host's unresolved link paths for this note, as `unresolvedKey`s. */
export const unresolvedLinks = StateField.define<ReadonlySet<string>>({
  create: () => new Set(),
  update(value, transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(setUnresolved)) {
        value = effect.value;
      }
    }
    return value;
  },
});

export const setKnownNotes = StateEffect.define<ReadonlySet<string>>();

/** Vault note lookup keys for optimistic unresolved styling. */
export const knownNotes = StateField.define<ReadonlySet<string>>({
  create: () => new Set(),
  update(value, transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(setKnownNotes)) {
        value = effect.value;
      }
    }
    return value;
  },
});

export function isUnresolved(state: EditorState, href: string): boolean {
  const key = unresolvedKey(href);
  if (key === "") {
    return false;
  }
  if (state.field(unresolvedLinks, false)?.has(key)) {
    return true;
  }
  const known = state.field(knownNotes, false);
  if (!known || known.size === 0) {
    return false;
  }
  if (known.has(key)) {
    return false;
  }
  const slash = key.lastIndexOf("/");
  if (slash >= 0 && known.has(key.slice(slash + 1))) {
    return false;
  }
  return true;
}

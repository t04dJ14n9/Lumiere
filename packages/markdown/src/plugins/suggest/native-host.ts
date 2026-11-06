import type { Context, Plugin } from "@workshop/core";
import { linkTrigger, type LinkTrigger } from "../../markdown/link-trigger";
import type { TextCompletion, TextCompletionProvider } from "../../shared/host";
import type { VaultIndex } from "../vault/api";
import type {} from "../../shared/pdf-outlines";
import type { Suggestion } from "./protocol";
import { SuggestionIndex } from "./sources";

/**
 * Window half: the suggestions of `[[` in VS Code's text editor, from the
 * index, ranking and insertion text the Lumia editor uses.
 */
export const nativeSuggestHost: Plugin = {
  name: "suggest",
  inject: {
    required: ["vaults", "settings", "hostDocuments"],
    optional: ["pdfOutlines"],
  },
  apply(ctx) {
    if (!ctx.hostDocuments.registerCompletions) {
      return;
    }
    const complete = nativeCompletions(ctx);
    ctx.effect(() => ctx.hostDocuments.registerCompletions!({ complete }));
  },
};

function nativeCompletions(ctx: Context): TextCompletionProvider["complete"] {
  const indexOf = suggestionIndexes(ctx);
  return async ({ uri, before }, token) => {
    const trigger = linkTrigger(before);
    if (!trigger) {
      return [];
    }
    await ctx.settings.effective.prepare(uri);
    const note = ctx.settings.forNote(await ctx.hostDocuments.open(uri));
    const links = note.features?.links;
    if (
      note.preset !== "obsidian" ||
      note.features?.suggest?.enabled === false ||
      links?.enabled === false
    ) {
      return [];
    }
    const located = await ctx.vaults.locate(uri);
    // `suggestionIndexes` registers effects, which a stopped plugin refuses.
    if (!located || token.cancelled || !ctx.isLive) {
      return [];
    }
    const index = indexOf(located.vault.index);
    await index.prepare(located.path, trigger);
    if (token.cancelled || !ctx.isLive) {
      return [];
    }
    return index
      .query(located.path, trigger, links?.config.useWikilinks !== false)
      .map((item) => completion(item, { trigger, before }));
  };
}

/**
 * One index per vault, reset when the vault changes, as the panel half does.
 * It has no way to read a note's text, so it offers only the blocks that
 * already have an id: giving another block one would edit a second file.
 * A PDF's bookmarks come from `pdfOutlines` where the host has one.
 */
function suggestionIndexes(ctx: Context) {
  const indexes = new Map<VaultIndex, SuggestionIndex>();
  return (vault: VaultIndex): SuggestionIndex => {
    const known = indexes.get(vault);
    if (known) {
      return known;
    }
    const outlines = ctx.pdfOutlines;
    const index = new SuggestionIndex(
      vault,
      undefined,
      outlines && ((file) => outlines.sections(file.uri)),
    );
    ctx.effect(() => vault.onDidChange((change) => index.invalidate(change)));
    ctx.effect(() => vault.onDidResolve(() => index.invalidate()));
    indexes.set(vault, index);
    return index;
  };
}

/**
 * Accepting works as in the Lumia editor: the link is finished with `]]`,
 * reusing one that follows the caret; an alias being typed stays and only
 * the link is finished; a Markdown link replaces the whole `[[…`.
 */
function completion(
  item: Suggestion,
  where: { trigger: LinkTrigger; before: string },
): TextCompletion {
  const { trigger, before } = where;
  const entry = { label: item.label, detail: item.detail, absorbs: "]]" };
  if (trigger.keepTyped) {
    return { ...entry, insert: "]]", replaceFrom: trigger.from };
  }
  if (item.replaceLink) {
    const opening = before.slice(0, trigger.from).lastIndexOf("[[");
    return { ...entry, insert: item.insert, replaceFrom: opening };
  }
  return { ...entry, insert: `${item.insert}]]`, replaceFrom: trigger.from };
}

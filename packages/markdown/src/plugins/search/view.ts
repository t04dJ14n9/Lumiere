import type { Context, Plugin } from "@workshop/core";
import type { TreeHandle } from "../../shared/host";
import type { Vault } from "../vault/api";
import { SEARCH_REFRESH_DELAY_MS } from "./host";
import { SearchResultsTree } from "./results-tree";
import { VaultSearch } from "./vault-search";
import {
  CLEAR_COMMAND,
  OPEN_RESULT_COMMAND,
  RESULTS_SHOWN_CONTEXT,
  SEARCH_COMMAND,
  SEARCH_VIEW_ID,
} from "./view-ids";

/**
 * The window half of `search`: **Search Vault…** and the Explorer's Vault
 * Search view, Obsidian's search pane over the active note's vault (the
 * workspace's when no note is open), with the query syntax of query blocks.
 * The editor half in `host.ts` runs per panel; both follow the same switch.
 */
export const vaultSearchHost: Plugin = {
  name: "search",
  inject: {
    required: [
      "vaults",
      "views",
      "hostCommands",
      "dialogs",
      "activeEditor",
      "extensions",
    ],
  },
  apply(ctx) {
    const results = new SearchResultsTree();
    const tree = ctx.views.tree(SEARCH_VIEW_ID, results);
    ctx.effect(() => () => tree.dispose());
    const search = createSearch(ctx, tree, results);
    registerSearchCommands(ctx, search);
    registerResultRows(ctx);
    registerRefresh(ctx, tree, search);
  },
};

function createSearch(
  ctx: Context,
  tree: TreeHandle,
  results: SearchResultsTree,
): VaultSearch {
  // Captured while live: a search can end after the plugin stopped.
  const { activeEditor, vaults, hostCommands } = ctx;
  const search = new VaultSearch({
    tree,
    results,
    vault: async (): Promise<Vault | undefined> => {
      const note = activeEditor.note();
      const located = note ? await vaults.locate(note) : undefined;
      return located?.vault ?? (await vaults.forWorkspace());
    },
    read: (uri) => vaults.text(uri),
    workers: ctx.extensions.workers,
    showsResults: (isShown) =>
      void hostCommands
        .execute("setContext", RESULTS_SHOWN_CONTEXT, isShown)
        .catch(() => undefined),
  });
  ctx.effect(() => () => {
    search.dispose();
    void hostCommands
      .execute("setContext", RESULTS_SHOWN_CONTEXT, undefined)
      .catch(() => undefined);
  });
  return search;
}

function registerSearchCommands(ctx: Context, search: VaultSearch): void {
  const { dialogs, hostCommands } = ctx;
  ctx.effect(() =>
    hostCommands.register(SEARCH_COMMAND, async () => {
      const query = (
        await dialogs.input({
          prompt: "Search the vault, with Obsidian's search syntax",
          value: search.lastQuery,
          validate: (value) =>
            value.trim() ? undefined : "Type something to search for.",
        })
      )?.trim();
      if (!query) {
        return;
      }
      // VS Code's own command for a contributed view; other hosts may have
      // none, and their tree panel shows the results where it is.
      void hostCommands
        .execute(`${SEARCH_VIEW_ID}.focus`)
        .catch(() => undefined);
      await search.search(query);
    }),
  );
  ctx.effect(() => hostCommands.register(CLEAR_COMMAND, () => search.clear()));
}

/** A row's command carries the note's URI and, for a match line, its offset. */
function registerResultRows(ctx: Context): void {
  const { vaults } = ctx;
  ctx.effect(() =>
    ctx.hostCommands.register(OPEN_RESULT_COMMAND, (uri, offset) =>
      vaults.open(
        String(uri),
        typeof offset === "number" ? { offset } : undefined,
      ),
    ),
  );
}

/**
 * Results follow the vault as Obsidian's search pane does: once the index
 * has been quiet for a second (it resolves after every typing pause), the
 * query runs again. A hidden view is not searched; it catches up when shown.
 */
function registerRefresh(
  ctx: Context,
  tree: TreeHandle,
  search: VaultSearch,
): void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let isStale = false;
  ctx.effect(() => () => clearTimeout(timer));
  ctx.on("vault/resolved", () => {
    clearTimeout(timer);
    if (!tree.visible) {
      isStale = true;
      return;
    }
    timer = setTimeout(() => void search.refresh(), SEARCH_REFRESH_DELAY_MS);
  });
  ctx.effect(() =>
    tree.onVisibilityChanged((visible) => {
      if (visible && isStale) {
        isStale = false;
        void search.refresh();
      }
    }),
  );
}

import type { Context, Plugin } from "@workshop/core";
import type { PanelShell } from "../../shared/host";
import type {} from "../vault/api";
import { protocol } from "./protocol";
import { SearchWorker } from "./runner";
import { searchVault } from "./query";
import { resolveSearchOpen } from "./open";
export const searchHost: Plugin<{ panel: PanelShell }> = {
  name: "search",
  inject: { required: ["rpc", "vault", "vaults", "extensions"] },
  apply(ctx) {
    ctx.effect(() =>
      ctx.rpc.handle(protocol, "query", async (request, token) => {
        const worker = new SearchWorker(ctx.extensions.workers, request.query, {
          token,
        });
        try {
          return await searchVault({
            vault: ctx.vault,
            source: request.source,
            worker,
            token,
            read: (uri) => ctx.vaults.text(uri),
            ...(request.id
              ? {
                  onPartial: (snapshot) =>
                    ctx.rpc.notify(protocol, "partial", {
                      id: request.id!,
                      results: snapshot.results,
                      unreadable: snapshot.unreadable,
                    }),
                }
              : {}),
          });
        } finally {
          await worker.dispose();
        }
      }),
    );
    ctx.effect(() =>
      ctx.rpc.handle(protocol, "open", async (target) => {
        const resolved = resolveSearchOpen(ctx.vault, target);
        if (!resolved) {
          return false;
        }
        await ctx.vaults.open(resolved.uri, resolved.options);
        return true;
      }),
    );
    registerRefreshNotice(ctx);
  },
};

/**
 * Pause after the index last resolved before blocks search again. The index
 * resolves after every typing pause in any open note (about 50 ms), and
 * each `changed` restarts every query block's whole-vault search.
 */
export const SEARCH_REFRESH_DELAY_MS = 1000;

function registerRefreshNotice(ctx: Context): void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  ctx.effect(() => () => clearTimeout(timer));
  ctx.effect(() =>
    ctx.vault.onDidResolve(() => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        timer = undefined;
        ctx.rpc.notify(protocol, "changed", {});
      }, SEARCH_REFRESH_DELAY_MS);
    }),
  );
}

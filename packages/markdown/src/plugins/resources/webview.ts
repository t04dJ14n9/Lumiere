import type { Context, Plugin } from "@workshop/core";
import { RecentlyUsed } from "../../shared/recently-used";
import { splitLinktext, type LinkSyntax } from "../../shared/vault-path";
import type { Resource } from "./api";
import { protocol } from "./protocol";
import { PageBaseSnapshot } from "./page-base-snapshot";

const RESOURCE_CACHE_LIMIT = 256;

function isCacheableResource(resource: Resource): boolean {
  return resource.kind !== "note" && resource.kind !== "base";
}

function makeResourceKey(
  target: string,
  source?: string,
  syntax?: LinkSyntax,
): string {
  return `${syntax ?? "markdown"}\0${source ?? ""}\0${target}`;
}

export const resourcesWebview: Plugin = {
  name: "resources",
  inject: { required: ["rpc"] },
  provides: ["resources"],
  apply(ctx) {
    const cache = new RecentlyUsed<string, Resource>(RESOURCE_CACHE_LIMIT);
    const loads = sharedLoads(ctx);
    const forget = () => {
      cache.clear();
      loads.clear();
    };

    ctx.effect(() => forget);
    // Each URL carries the file's mtime when it was resolved (`?v=`), so a
    // rewritten file needs resolving again to show.
    ctx.on("resources/changed", forget);
    // Nothing that failed was cached, so there is nothing to drop.
    ctx.effect(() =>
      ctx.rpc.on(protocol, "found", () => ctx.emit("resources/found")),
    );
    // A changed image has a new `?v=` mtime: what was resolved is stale.
    ctx.effect(() =>
      ctx.rpc.on(protocol, "changed", ({ sources }) => {
        forget();
        ctx.emit("resources/modified", sources);
      }),
    );

    ctx.provide("resources", {
      peek: (target, source, syntax) =>
        cache.get(makeResourceKey(target, source, syntax)),
      load: async (target, source, syntax) => {
        const key = makeResourceKey(target, source, syntax);
        const cached = cache.get(key);
        if (cached !== undefined) {
          return cached;
        }
        const resolved = await loads.load(target, source, syntax);
        if (isCacheableResource(resolved)) {
          cache.set(key, resolved);
        }
        return resolved;
      },
    });
  },
};

/**
 * Loads of the same file share one request while it runs: twenty
 * `![[Big#Section]]` embeds ask for Big's text once. The host answers by
 * the link's file, whatever its heading or block, and the embed picks its
 * section from the text.
 */
function sharedLoads(ctx: Context) {
  const running = new Map<string, Promise<Resource>>();
  // Every base embed of this panel shares one copy of the vault snapshot.
  const bases = new PageBaseSnapshot();
  return {
    load(target: string, source?: string, syntax?: LinkSyntax) {
      const key = makeResourceKey(splitLinktext(target).path, source, syntax);
      const shared = running.get(key);
      if (shared) {
        return shared;
      }
      const snapshot = bases.have;
      const load = ctx.rpc
        .call(protocol, "load", {
          target,
          ...(source === undefined ? {} : { source }),
          ...(syntax === undefined ? {} : { syntax }),
          ...(snapshot === undefined ? {} : { snapshot }),
        })
        .then((resource) => bases.take(resource));
      running.set(key, load);
      const settle = () => {
        if (running.get(key) === load) {
          running.delete(key);
        }
      };
      load.then(settle, settle);
      return load;
    },
    /** A file changed: a load already running may answer its old version. */
    clear: () => running.clear(),
  };
}

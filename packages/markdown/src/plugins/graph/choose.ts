import type { Context } from "@workshop/core";
import { nameOf } from "../../shared/vault-path";
import type { Vault } from "../vault/api";
import { selectScope } from "./scope";
import type { GraphScope } from "./scope";
import { t } from "@workshop/l10n";

export interface HeldScope {
  vault: Vault;
  scope: GraphScope;
  focusPath?: string;
}

/** The graph scope for one vault: all of its notes. */
export function vaultScope(vault: { index: { root: string } }): GraphScope {
  const root = vault.index.root;
  return {
    id: encodeURIComponent(root),
    name: folderName(root),
    vaultRoot: root,
  };
}

function folderName(root: string): string {
  try {
    return nameOf(decodeURIComponent(new URL(root).pathname)) || root;
  } catch {
    return nameOf(root) || root;
  }
}

/** Resolve the vault for this open. Dismissing the picker leaves the previous scope. */
export async function resolveScope(input: {
  ctx: Context;
  explicit: boolean;
  current?: HeldScope;
}): Promise<HeldScope | undefined | "dismissed"> {
  const located = await locateNote(input.ctx);
  const decision = selectScope({
    explicit: input.explicit,
    hasCurrent: !input.explicit && input.current !== undefined,
    ...(located ? { owner: vaultScope(located.vault) } : {}),
    choices: input.ctx.vaults.all().map(vaultScope),
  });
  if (decision.kind === "keep") {
    return input.current;
  }
  if (decision.kind === "empty") {
    return undefined;
  }
  if (decision.kind === "use") {
    return hold(input.ctx, decision.scope, located?.path);
  }
  const picked = await input.ctx.dialogs.pick({
    placeholder: t("Choose a vault to graph"),
    items: (query) => scopeItems(decision.choices, query),
  });
  if (!picked?.item) {
    return "dismissed";
  }
  return hold(input.ctx, picked.item.value, located?.path);
}

function scopeItems(choices: readonly GraphScope[], query: string) {
  const needle = query.trim().toLowerCase();
  return choices
    .filter((scope) =>
      `${scope.name} ${scope.vaultRoot}`.toLowerCase().includes(needle),
    )
    .map((scope) => ({
      label: scope.name,
      description: scope.vaultRoot,
      value: scope,
    }));
}

async function locateNote(ctx: Context) {
  const note = ctx.activeEditor.note();
  if (typeof note !== "string" || note.length === 0) {
    return undefined;
  }
  const located = await ctx.vaults.locate(note);
  if (!located || typeof located.path !== "string") {
    return undefined;
  }
  return located;
}

function hold(
  ctx: Context,
  scope: GraphScope,
  path: string | undefined,
): HeldScope | undefined {
  const vault = ctx.vaults
    .all()
    .find((candidate) => candidate.index.root === scope.vaultRoot);
  if (!vault) {
    return undefined;
  }
  return { vault, scope, ...(path ? { focusPath: path } : {}) };
}

import type { Plugin } from "@workshop/core";
import type { PanelShell } from "../../shared/host";
import { exceedsDiffLimits } from "../../shared/diff";
import type { DiffSide } from "../../shared/git-diff";
import type { GitAccess, GitRef } from "../../shared/git";
import { protocol } from "./protocol";

/**
 * Per-file mutation lock shared by every panel of that file. Not an SCM
 * transaction: one in-flight Stage/Revert per path, released when it finishes
 * or when its panel closes. Each entry names its owner, so only that panel
 * frees it: another panel's release, or the owner's own refused second
 * request, must not leave a lock nobody frees until restart.
 */
const pendingFiles = new Map<string, object>();

function mutationHold(uri: string, owner: object, hold: boolean): boolean {
  if (!hold) {
    if (pendingFiles.get(uri) === owner) {
      pendingFiles.delete(uri);
    }
    return true;
  }
  if (pendingFiles.has(uri)) {
    return false;
  }
  pendingFiles.set(uri, owner);
  return true;
}

function sideFromKind(kind: string): DiffSide {
  if (kind === "HEAD") {
    return { kind: "HEAD", oid: "HEAD" };
  }
  if (kind === "INDEX") {
    return { kind: "INDEX", fingerprint: "index" };
  }
  if (kind === "WORKTREE") {
    return { kind: "WORKTREE" };
  }
  if (kind === "empty") {
    return { kind: "empty" };
  }
  return { kind: "revision", ref: kind, oid: kind };
}

/** Save, then stage; nothing is staged unless the buffer reached the disk. */
async function saveAndStage(
  panel: PanelShell,
  git: GitAccess,
  report: (message: string) => void,
): Promise<boolean> {
  const saved = await panel.document.save().catch(() => false);
  if (!saved) {
    report("The note could not be saved, so nothing was staged.");
    return false;
  }
  try {
    return await git.stage(panel.document.uri);
  } catch (error) {
    report(
      `Staging failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    return false;
  }
}

/** Reads the note's git baseline through VS Code's git extension; never shells out. */
export const gitGutterHost: Plugin<{ panel: PanelShell }> = {
  name: "gitGutter",
  inject: { required: ["dialogs", "git", "rpc"] },
  apply(ctx, { panel }) {
    const git = ctx.git;
    const uri = panel.document.uri;
    registerBaseline(ctx, git, uri);
    registerStage(ctx, git, panel);
    registerMutationLock(ctx, uri);
    registerOpenFullDiff(ctx, uri);
    watchRepository(ctx, git);
  },
};

function registerBaseline(
  ctx: Parameters<NonNullable<typeof gitGutterHost.apply>>[0],
  git: GitAccess,
  uri: string,
): void {
  const sent = sentBaselines();
  ctx.effect(() =>
    ctx.rpc.handle(protocol, "baseline", async ({ ref, known }) => {
      const result = await git.baseline(uri, ref);
      if (result.status !== "ok") {
        return { status: result.status };
      }
      const { text, label } = result.baseline;
      if (exceedsDiffLimits(text)) {
        return { status: "tooLarge" as const };
      }
      const identity = sent.identify(ref, label, text);
      if (known === identity) {
        return { status: "unchanged" as const, identity };
      }
      return { status: "ok" as const, text, label, identity };
    }),
  );
}

/**
 * The last baseline this panel's editor was sent. Every repository event
 * makes the editor ask again, and most (another file staged, a fetch) leave
 * this note's baseline as it was: then the answer is `unchanged`, with no
 * copy of the text and no recompute in the editor. The identity is unique
 * to this host plugin, so an editor never mistakes another's for its own.
 */
function sentBaselines() {
  const instance = Math.random().toString(36).slice(2, 10);
  let count = 0;
  let last:
    { identity: string; ref: GitRef; label: string; text: string } | undefined;
  return {
    identify(ref: GitRef, label: string, text: string): string {
      if (last?.ref !== ref || last.label !== label || last.text !== text) {
        count += 1;
        last = { identity: `${instance}-${count}`, ref, label, text };
      }
      return last.identity;
    },
  };
}

function registerStage(
  ctx: Parameters<NonNullable<typeof gitGutterHost.apply>>[0],
  git: GitAccess,
  panel: PanelShell,
): void {
  ctx.effect(() =>
    ctx.rpc.handle(protocol, "stage", async () => {
      return saveAndStage(panel, git, (message) => ctx.dialogs.error(message));
    }),
  );
}

function registerMutationLock(
  ctx: Parameters<NonNullable<typeof gitGutterHost.apply>>[0],
  uri: string,
): void {
  const owner = {};
  ctx.effect(() => () => {
    mutationHold(uri, owner, false);
  });
  ctx.effect(() =>
    ctx.rpc.handle(protocol, "mutationLock", async ({ hold }) =>
      mutationHold(uri, owner, hold),
    ),
  );
}

function registerOpenFullDiff(
  ctx: Parameters<NonNullable<typeof gitGutterHost.apply>>[0],
  uri: string,
): void {
  ctx.effect(() =>
    ctx.rpc.handle(
      protocol,
      "openFullDiff",
      async ({ baseKind, targetKind }) => {
        ctx.emit("git-diff:open-full", {
          fileUri: uri,
          base: sideFromKind(baseKind),
          target: sideFromKind(targetKind),
        });
        return true;
      },
    ),
  );
}

function watchRepository(
  ctx: Parameters<NonNullable<typeof gitGutterHost.apply>>[0],
  git: GitAccess,
): void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const rpc = ctx.rpc;
  ctx.effect(() => () => clearTimeout(timer));
  ctx.effect(() =>
    git.onDidChange(() => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        void Promise.resolve(rpc.notify(protocol, "changed", {})).catch(
          () => undefined,
        );
      }, 150);
    }),
  );
}

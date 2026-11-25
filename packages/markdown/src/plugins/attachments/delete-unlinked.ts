import type { Context } from "@workshop/core";
import type { AfterDelete } from "../../shared/host";
import type { Vault, VaultFile, Vaults } from "../vault/api";
import { unlinkedAttachments } from "./unlinked";
import { t } from "@workshop/l10n";

const SETTING = "attachments.deleteUnlinkedAttachments";

/**
 * How long a deletion waits for the index to finish parsing. VS Code holds
 * the deletion until its participants answer, so a slow scan gives up well
 * before its own limit; an index still parsing is not trusted to say which
 * attachments no other note uses.
 */
const SETTLE_LIMIT_MS = 5_000;

/** What to delete once the notes are gone, and how the setting said to go about it. */
interface Plan {
  mode: string;
  /** The deleted note's URI: the setting is resource-scoped. */
  resource: string;
  files: readonly VaultFile[];
}

/**
 * Obsidian's Delete attachments when deleting files: when notes are deleted in
 * VS Code, offer to delete the attachments only they linked. The plan is made
 * while the notes still exist (their links leave the index with them); the
 * offer comes after, as in Obsidian, so declining never keeps a note.
 */
export function registerDeleteUnlinked(ctx: Context): void {
  ctx.effect(() =>
    ctx.hostDocuments.onWillDelete((uris) => planDeletion(ctx, uris)),
  );
}

async function planDeletion(
  ctx: Context,
  uris: readonly string[],
): Promise<AfterDelete | undefined> {
  const resource = uris[0];
  if (resource === undefined) {
    return undefined;
  }
  await ctx.settings.effective.prepare(resource);
  const mode = ctx.settings.get<string>(SETTING, "ask", resource);
  if (mode === "never") {
    return undefined;
  }
  const files = await freedAttachments(ctx.vaults, uris);
  if (files.length === 0) {
    return undefined;
  }
  return () =>
    offerDeletion(ctx, { mode, resource, files }).catch((error: unknown) => {
      ctx.dialogs.error(
        t("Could not delete the attachments: {0}", messageOf(error)),
      );
    });
}

/** The attachments only the deleted notes of an indexed vault used. */
async function freedAttachments(
  vaults: Vaults,
  uris: readonly string[],
): Promise<readonly VaultFile[]> {
  const vault = vaults
    .all()
    .find((open) => open.pathOf(uris[0]!) !== undefined);
  if (!vault || !(await settledWithin(vault, SETTLE_LIMIT_MS))) {
    return [];
  }
  const notes = uris.flatMap((uri) => vault.pathOf(uri) ?? []);
  return unlinkedAttachments(vault.index, notes);
}

async function settledWithin(
  vault: Pick<Vault, "settled">,
  limitMs: number,
): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const limit = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => resolve(false), limitMs);
  });
  try {
    return await Promise.race([vault.settled().then(() => true), limit]);
  } finally {
    clearTimeout(timer);
  }
}

/** Asks unless the setting says `always`; Always and Never Delete also stop the asking. */
async function offerDeletion(ctx: Context, plan: Plan): Promise<void> {
  if (plan.mode !== "always") {
    // The buttons are translated, so the answer is compared with the same text.
    const deleteNow = t("Delete");
    const always = t("Always Delete");
    const never = t("Never Delete");
    const answer = await ctx.dialogs.ask(question(plan.files), [
      deleteNow,
      always,
      never,
    ]);
    if (answer === never || answer === always) {
      const mode = answer === never ? "never" : "always";
      await ctx.settings.access.update(SETTING, mode, plan.resource);
    }
    if (answer !== deleteNow && answer !== always) {
      return;
    }
  }
  for (const file of plan.files) {
    await trash(ctx, file);
  }
}

/** One file to the trash; a failure is reported and the others still go. */
async function trash(ctx: Context, file: VaultFile): Promise<void> {
  try {
    await ctx.workspace.files.remove(file.uri, { trash: true });
  } catch (error) {
    ctx.dialogs.error(
      t("Could not delete {0}: {1}", file.path, messageOf(error)),
    );
  }
}

function question(files: readonly VaultFile[]): string {
  const shown = files.slice(0, 5).map((file) => file.path);
  const more = files.length - shown.length;
  const names = shown.join(", ");
  if (files.length === 1) {
    return t("Delete 1 attachment that no other note uses? {0}", names);
  }
  return more > 0
    ? t(
        "Delete {0} attachments that no other note uses? {1} and {2} more",
        files.length,
        names,
        more,
      )
    : t(
        "Delete {0} attachments that no other note uses? {1}",
        files.length,
        names,
      );
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

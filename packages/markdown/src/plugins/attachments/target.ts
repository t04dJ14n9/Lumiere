import type { Context } from "@workshop/core";
import type { SaveAttachmentInput } from "../../attachments";
import { asString } from "../../shared/values";
import type { EditorPanel } from "../editor/api";

/** Where a note's attachments go and how its embeds are written. */
export type AttachmentTarget = Omit<
  SaveAttachmentInput,
  "ext" | "bytes" | "text" | "now" | "stem"
>;

/** The note's attachment target, or undefined when it is in no vault. */
export async function attachmentTarget(
  ctx: Context,
  panel: EditorPanel,
): Promise<AttachmentTarget | undefined> {
  const located = await ctx.vaults.locate(panel.document.uri);
  if (!located) {
    return undefined;
  }
  const links = ctx.settings.forNote(panel.document).features?.links?.config;
  return {
    files: ctx.workspace.files,
    root: located.vault.index.root,
    notePath: located.path,
    attachmentFolder: asString(links?.attachmentFolder) ?? "",
    useWikilinks: links?.useWikilinks !== false,
    format: linkFormat(links?.newLinkFormat),
    vaultPaths: located.vault.index.files().map((file) => file.path),
  };
}

function linkFormat(value: unknown): "shortest" | "relative" | "absolute" {
  return value === "relative" || value === "absolute" ? value : "shortest";
}

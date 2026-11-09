import type { Context } from "@workshop/core";
import { SourceCoordinates } from "../../shared/document/coordinates";
import type { Dialogs, HostDocument, HostDocuments } from "../../shared/host";
import type { Editors } from "../editor/api";
import { protocol as editorProtocol } from "../editor/protocol";
import type { VaultFile, Vaults } from "../vault/api";
import {
  headingAt,
  headingLinkEdits,
  type RenamedHeading,
} from "./heading-rename";
import { sourceText } from "./source-text";
import { contributionId } from "../../shared/setting-schema";

interface Services {
  /** Undefined when the window has no Lumiere editors. */
  editors: Editors | undefined;
  dialogs: Dialogs;
  vaults: Vaults;
  hostDocuments: HostDocuments;
}

/** Characters that would break a `[[Note#Heading]]` link to the heading. */
const BREAKS_LINKS = /[#|^[\]]/u;

/** Why a new heading name will not do, or undefined when it will. */
export function headingNameProblem(value: string): string | undefined {
  if (!value.trim()) {
    return "A heading needs a name.";
  }
  return BREAKS_LINKS.test(value)
    ? "A heading name cannot contain # | ^ [ or ]."
    : undefined;
}

/**
 * Obsidian's Rename heading: rename the heading at the caret in the active
 * note, and update every link to it, in the note and in the notes linking to
 * it (through the vault's backlinks).
 */
export async function renameHeading(ctx: Services): Promise<void> {
  const panel = ctx.editors?.active();
  const caret = await panel?.rpc
    .call(editorProtocol, "captureSelection", {})
    .catch(() => undefined);
  const text = editorText(panel?.document.getText() ?? "");
  const heading = caret && headingAt(text, caret.from);
  if (!panel || !heading) {
    ctx.dialogs.inform("Put the caret on a heading to rename it.");
    return;
  }
  const name = (
    await ctx.dialogs.input({
      prompt: "Rename heading",
      value: heading.name,
      validate: headingNameProblem,
    })
  )?.trim();
  const located = await ctx.vaults.locate(panel.document.uri);
  const path = located?.vault.pathOf(panel.document.uri);
  if (!name || name === heading.name || !located || path === undefined) {
    return;
  }
  const renamed: RenamedHeading = { path, text, heading, name };
  await applyRename(ctx, panel.document, renamed, located.vault);
}

/**
 * Rename in `document`, then in the notes linking to it. The offsets in
 * `renamed` belong to the note as it was when the name was asked for, so an
 * edit made meanwhile refuses the rename rather than land them in the wrong
 * place. This note goes first, with no await since that check, so its offsets
 * cannot go stale; the other notes are read afresh as each is updated.
 */
async function applyRename(
  ctx: Services,
  document: HostDocument,
  renamed: RenamedHeading,
  vault: Vault,
): Promise<void> {
  if (editorText(document.getText()) !== renamed.text) {
    ctx.dialogs.inform(
      "The note changed while the heading was being renamed. Try again.",
    );
    return;
  }
  const { heading, name, path, text } = renamed;
  const isApplied = await ctx.hostDocuments.apply(document, [
    { from: heading.nameFrom, to: heading.nameTo, insert: name },
    ...headingLinkEdits(text, path, renamed, resolver(vault)),
  ]);
  if (isApplied) {
    await updateLinks(ctx, vault, renamed);
  }
}

/**
 * A note's text with LF line ends, the coordinates `hostDocuments.apply`
 * takes offsets in; offsets read from the source text of a CRLF note do not
 * fit it.
 */
function editorText(source: string): string {
  return new SourceCoordinates(source).editor.toString();
}

type Vault = NonNullable<Awaited<ReturnType<Vaults["locate"]>>>["vault"];

function resolver(vault: Vault) {
  return (linkpath: string, source: string, syntax: "wikilink" | "markdown") =>
    vault.index.resolveLink(linkpath, source, syntax)?.path;
}

/**
 * Update the links to the heading in every other note that links here. One
 * note failing does not stop the notes after it; the failures are reported
 * together at the end.
 */
async function updateLinks(
  ctx: Services,
  vault: Vault,
  renamed: RenamedHeading,
): Promise<void> {
  const sources = new Set(
    vault.index.backlinks(renamed.path).map((link) => link.path),
  );
  sources.delete(renamed.path);
  const failed: string[] = [];
  for (const source of sources) {
    const file = vault.index.file(source);
    if (file?.extension !== "md") {
      continue;
    }
    if (!(await updateLinksIn(ctx, vault, renamed, file))) {
      failed.push(source);
    }
  }
  if (failed.length > 0) {
    ctx.dialogs.error(
      `The heading was renamed, but its links could not be updated in ${failed.join(", ")}.`,
    );
  }
}

/** Update the links in one note; false when it could not be updated. */
async function updateLinksIn(
  ctx: Services,
  vault: Vault,
  renamed: RenamedHeading,
  file: VaultFile,
): Promise<boolean> {
  try {
    const text = editorText(
      await sourceText(ctx.vaults, ctx.hostDocuments, file.uri),
    );
    if (
      headingLinkEdits(text, file.path, renamed, resolver(vault)).length === 0
    ) {
      return true;
    }
    const document = await ctx.hostDocuments.open(file.uri);
    // The note can change while it is read and opened, so the offsets come
    // from the text the document has now, with no await before they apply.
    const edits = headingLinkEdits(
      editorText(document.getText()),
      file.path,
      renamed,
      resolver(vault),
    );
    return (
      edits.length === 0 || (await ctx.hostDocuments.apply(document, edits))
    );
  } catch {
    return false;
  }
}

/** Register the command; it reads the active editor when it runs. */
export function registerRenameHeading(ctx: Context, services: Services): void {
  ctx.effect(() =>
    ctx.hostCommands.register(contributionId("renameHeading"), () =>
      renameHeading(services),
    ),
  );
}

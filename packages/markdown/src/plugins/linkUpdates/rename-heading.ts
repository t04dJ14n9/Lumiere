import type { Context } from "@workshop/core";
import { SourceCoordinates } from "../../shared/document/coordinates";
import type { Dialogs, HostDocument, HostDocuments } from "../../shared/host";
import type { Editors } from "../editor/api";
import { protocol as editorProtocol } from "../editor/protocol";
import type { VaultFile, Vaults } from "../vault/api";
import {
  headingAt,
  headingLinkEdits,
  renamedHeadingFragment,
  type HeadingToRename,
  type RenamedHeading,
} from "./heading-rename";
import { rewriteCanvasHeading } from "./canvas";
import { sourceText } from "./source-text";
import { contributionId } from "../../shared/setting-schema";
import { isMarkdownPath } from "../../shared/vault-path";
import { t } from "@workshop/l10n";

interface Services {
  /** Undefined when the window has no Lumiere editors. */
  editors: Editors | undefined;
  dialogs: Dialogs;
  vaults: Vaults;
  hostDocuments: HostDocuments;
}

/**
 * Why `value` will not do as a new name for `heading` in the note `text`, or
 * undefined when it will. Obsidian takes any name that is not empty; here a
 * name is also refused when the links rewritten for it could not reach the
 * heading (`renamedHeadingFragment`), rather than break them. The current
 * name is let through: keeping it renames nothing.
 */
export function headingNameProblem(
  text: string,
  heading: HeadingToRename,
  value: string,
): string | undefined {
  const name = value.trim();
  if (!name) {
    return "A heading needs a name.";
  }
  if (name === heading.name) {
    return undefined;
  }
  const fragment = renamedHeadingFragment(text, heading, name);
  return "problem" in fragment ? fragment.problem : undefined;
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
    ctx.dialogs.inform(t("Put the caret on a heading to rename it."));
    return;
  }
  const name = (
    await ctx.dialogs.input({
      prompt: t("Rename heading"),
      value: heading.name,
      validate: (value) => headingNameProblem(text, heading, value),
    })
  )?.trim();
  const located = await ctx.vaults.locate(panel.document.uri);
  const path = located?.vault.pathOf(panel.document.uri);
  if (!name || name === heading.name || !located || path === undefined) {
    return;
  }
  // The prompt refuses such a name; a host that lets one through still
  // writes no link that misses the heading.
  const fragment = renamedHeadingFragment(text, heading, name);
  if ("problem" in fragment) {
    ctx.dialogs.inform(fragment.problem);
    return;
  }
  const renamed: RenamedHeading = {
    path,
    text,
    heading,
    name,
    subpath: fragment.subpath,
  };
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
      t("The note changed while the heading was being renamed. Try again."),
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
  // Canvases are not in the backlinks: each one is read for its links.
  for (const file of vault.index.files()) {
    if (file.extension === "canvas") {
      sources.add(file.path);
    }
  }
  sources.delete(renamed.path);
  const failed: string[] = [];
  const unsaved: string[] = [];
  for (const source of sources) {
    const file = vault.index.file(source);
    if (!file || !(isMarkdownPath(file.path) || file.extension === "canvas")) {
      continue;
    }
    const outcome = await updateLinksIn(ctx, vault, renamed, file);
    if (outcome === "failed") {
      failed.push(source);
    } else if (outcome === "unsaved") {
      unsaved.push(source);
    }
  }
  if (failed.length > 0) {
    ctx.dialogs.error(
      t(
        "The heading was renamed, but its links could not be updated in {0}.",
        failed.join(", "),
      ),
    );
  }
  if (unsaved.length > 0) {
    ctx.dialogs.error(
      t(
        "The heading's links were updated in {0}, but could not be saved.",
        unsaved.join(", "),
      ),
    );
  }
}

/** Whether one note's links were updated, and saved when they should be. */
type LinkUpdate = "updated" | "unsaved" | "failed";

/**
 * Update the links in one note. A note that had no unsaved changes is saved
 * afterwards, as a file rename's link updates are, so the rename leaves no
 * note edited out of sight; one with unsaved changes is left for its writer.
 */
/** The edits a heading rename makes to one file: a note's links, or a canvas rewritten whole. */
function renameEdits(
  text: string,
  file: VaultFile,
  renamed: RenamedHeading,
  resolve: Parameters<typeof headingLinkEdits>[3],
): ReturnType<typeof headingLinkEdits> {
  if (file.extension !== "canvas") {
    return headingLinkEdits(text, file.path, renamed, resolve);
  }
  const next = rewriteCanvasHeading(text, file.path, renamed, resolve);
  return next === undefined ? [] : [{ from: 0, to: text.length, insert: next }];
}

async function updateLinksIn(
  ctx: Services,
  vault: Vault,
  renamed: RenamedHeading,
  file: VaultFile,
): Promise<LinkUpdate> {
  try {
    const text = editorText(
      await sourceText(ctx.vaults, ctx.hostDocuments, file.uri),
    );
    if (renameEdits(text, file, renamed, resolver(vault)).length === 0) {
      return "updated";
    }
    const document = await ctx.hostDocuments.open(file.uri);
    // The note can change while it is read and opened, so the offsets come
    // from the text the document has now, with no await before they apply.
    const edits = renameEdits(
      editorText(document.getText()),
      file,
      renamed,
      resolver(vault),
    );
    if (edits.length === 0) {
      return "updated";
    }
    const isClean = !document.isDirty;
    if (!(await ctx.hostDocuments.apply(document, edits))) {
      return "failed";
    }
    const isSaved = !isClean || (await document.save().catch(() => false));
    return isSaved ? "updated" : "unsaved";
  } catch {
    return "failed";
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

import type { Context } from "@workshop/core";
import type { HostServices } from "../../shared/host";
import {
  MARKDOWN_EDITOR,
  MARKDOWN_WORKSPACE_EDITOR_KEY,
} from "../../shared/editor-provider";
import { contributionId } from "../../shared/setting-schema";
import { t } from "@workshop/l10n";

const { viewType, filenamePatterns: markdownPatterns } = MARKDOWN_EDITOR;
const NATIVE_TEXT_EDITOR = "default";

/**
 * Open Markdown in Lumiere directly, so VS Code hands a note to Lumiere without
 * first opening it in its text editor (about 75 ms of a cold open). Other
 * patterns are kept.
 */
export function withMarkdownLumiere(existing: unknown): Record<string, string> {
  const associations: Record<string, string> = {};
  if (existing && typeof existing === "object" && !Array.isArray(existing)) {
    for (const [pattern, editor] of Object.entries(existing)) {
      if (typeof editor === "string") {
        associations[pattern] = editor;
      }
    }
  }
  for (const pattern of markdownPatterns) {
    associations[pattern] = viewType;
  }
  return associations;
}

function opensMarkdownHere(
  existing: unknown,
  storage: HostServices["storage"],
): boolean {
  return (
    storage.get(MARKDOWN_WORKSPACE_EDITOR_KEY, false) &&
    !!existing &&
    typeof existing === "object" &&
    markdownPatterns.every(
      (pattern) => (existing as Record<string, unknown>)[pattern] === viewType,
    )
  );
}

/** Lumiere's earlier route (#458): Markdown through the text editor, then reclaimed. */
function opensThroughText(
  existing: unknown,
  storage: HostServices["storage"],
): boolean {
  if (
    !storage.get(MARKDOWN_WORKSPACE_EDITOR_KEY, false) ||
    !existing ||
    typeof existing !== "object" ||
    Array.isArray(existing)
  ) {
    return false;
  }
  const associations = existing as Record<string, unknown>;
  // A workspace often records only `*.md`. Either pattern is that route.
  return markdownPatterns.some(
    (pattern) => associations[pattern] === NATIVE_TEXT_EDITOR,
  );
}

async function migrateTextRoute(
  host: Pick<HostServices, "settings" | "storage">,
): Promise<void> {
  const existing = host.settings.editorAssociations.read();
  if (!opensThroughText(existing, host.storage)) {
    return;
  }
  await host.settings.editorAssociations.write(withMarkdownLumiere(existing));
}

/**
 * DESIGN §25.2: Lumiere is Markdown's default editor; this records it for one
 * workspace, so notes open in it there even when the user settings keep VS
 * Code's text editor (`"*.md": "default"`).
 */
export async function useForMarkdownInWorkspace(
  host: Pick<HostServices, "settings" | "dialogs" | "storage">,
): Promise<void> {
  const associations = host.settings.editorAssociations;
  const existing = associations.read();
  if (existing === undefined) {
    host.dialogs.error(
      t(
        "Open a folder or workspace first: the association is saved in the workspace settings.",
      ),
    );
    return;
  }
  if (opensMarkdownHere(existing, host.storage)) {
    host.dialogs.inform(
      t("Markdown files in this workspace already open in Lumiere."),
    );
    return;
  }
  await host.storage.update(MARKDOWN_WORKSPACE_EDITOR_KEY, true);
  await associations.write(withMarkdownLumiere(existing));
  host.dialogs.inform(
    t(
      "Markdown files in this workspace now open in Lumiere. Use Open as Text or Reopen Editor With… for the text editor.",
    ),
  );
}

export function registerMarkdownAssociation(ctx: Context): void {
  ctx.track(migrateTextRoute(ctx));
  ctx.effect(() =>
    ctx.hostCommands.register(contributionId("useForMarkdownInWorkspace"), () =>
      useForMarkdownInWorkspace(ctx),
    ),
  );
}

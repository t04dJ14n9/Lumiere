import * as vscode from "vscode";
import {
  MARKDOWN_EDITOR,
  MARKDOWN_WORKSPACE_EDITOR_KEY,
} from "../shared/editor-provider";

const NATIVE_TEXT_EDITOR = "default";

/**
 * Whether this workspace uses Lumiere's earlier text-first route (#458): only
 * one where the old Use Lumiere for Markdown command recorded it. Lumiere is
 * now Markdown's default editor, so `"*.md": "default"` on its own is how
 * someone keeps VS Code's text editor; it is never healed into that route.
 */
export function usesTextFirstRoute(
  memory: vscode.Memento | undefined,
): boolean {
  return memory?.get(MARKDOWN_WORKSPACE_EDITOR_KEY, false) ?? false;
}

/**
 * Whether Markdown still opens in the text editor first, to be reclaimed. Use
 * Lumiere for Markdown now associates Lumiere directly, and then a text tab is one
 * someone chose, not a note on its way to Lumiere.
 */
export function routesMarkdownThroughText(
  associations: unknown = workbenchAssociations(),
): boolean {
  return markdownOpensAsDefaultText(associations);
}

function workbenchAssociations(): unknown {
  return vscode.workspace
    .getConfiguration("workbench")
    .get("editorAssociations");
}

function markdownOpensAsDefaultText(associations: unknown): boolean {
  if (!associations || typeof associations !== "object") {
    return false;
  }
  const map = associations as Record<string, unknown>;
  const patterns = MARKDOWN_EDITOR.filenamePatterns;
  // At least one Markdown pattern routes through text; none still force the
  // custom editor (a partial `*.md`-only workspace settings write still heals).
  return (
    patterns.some((pattern) => map[pattern] === NATIVE_TEXT_EDITOR) &&
    patterns.every(
      (pattern) =>
        map[pattern] === undefined || map[pattern] === NATIVE_TEXT_EDITOR,
    )
  );
}

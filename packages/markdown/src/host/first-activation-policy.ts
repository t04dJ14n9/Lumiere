import type { TabKind } from "./reclaim-policy";

/** Workspace state: Lumiere has once reopened the notes left in the text editor. */
export const FIRST_ACTIVATION_KEY = "lumiere.markdown.firstActivationReopened";

/** An open tab, as the first activation needs to judge it. */
export interface OpenTab<T> {
  tab: T;
  uri: string;
  kind: TabKind;
  isDirty: boolean;
  /** The active tab of the active group. */
  isActive: boolean;
}

export interface FirstActivationRules {
  /** A Markdown file on disk (not untitled, not a diff side, not git:). */
  isNote(uri: string): boolean;
  /** No association keeps the note in VS Code's text editor. */
  isLumieres(uri: string): boolean;
  /** Opened as text on purpose (Open as Text, a kept reader text, a handoff). */
  isOptedOut(uri: string): boolean;
}

/**
 * The notes to reopen in Lumiere the first time it activates in a workspace.
 * A Codespace or a restored window can open a note before Lumiere has
 * installed or started; it lands in the text editor and nothing moves it
 * later, because reclaim only judges tab changes after activation. Only once
 * per workspace: after that, a text tab is the reader's choice.
 *
 * Only clean text tabs of notes Lumiere owns qualify: a dirty buffer, a diff,
 * or a note opened as text on purpose stays. The active tab comes last, so it
 * is the one left in front.
 */
export function notesToReopen<T>(
  tabs: readonly OpenTab<T>[],
  rules: FirstActivationRules,
): OpenTab<T>[] {
  const chosen = tabs.filter(
    (tab) =>
      tab.kind === "text" &&
      !tab.isDirty &&
      rules.isNote(tab.uri) &&
      rules.isLumieres(tab.uri) &&
      !rules.isOptedOut(tab.uri),
  );
  return [
    ...chosen.filter((tab) => !tab.isActive),
    ...chosen.filter((tab) => tab.isActive),
  ];
}

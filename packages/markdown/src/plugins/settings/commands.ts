/** The extension's id in the Settings UI search (`@ext:`). */
import { t } from "@workshop/l10n";

/**
 * A command that flips one boolean setting. `key` is the same key the
 * Settings UI shows, so the two never disagree: the command reads and writes
 * the setting, and keeps no state of its own. The key must be a boolean
 * setting in package.json (a unit test checks every one), and its default is
 * the schema's, not a copy here.
 */
export interface SettingToggle {
  readonly command: string;
  readonly key: string;
  /** A function: the label is translated when shown, not when the module loads. */
  readonly label: () => string;
}

export const toggles: readonly SettingToggle[] = [
  {
    command: "toggleLineNumbers",
    key: "plugins.lineNumbers.enabled",
    label: () => t("Line numbers"),
  },
  {
    command: "toggleReadableLineWidth",
    key: "editor.readableLineLength",
    label: () => t("Readable line width"),
  },
  {
    command: "toggleMermaid",
    key: "plugins.diagrams.enabled",
    label: () => t("Mermaid diagrams"),
  },
  {
    command: "toggleInlineTitle",
    key: "plugins.inlineTitle.enabled",
    label: () => t("Inline title"),
  },
  {
    command: "toggleInlineGitChanges",
    key: "plugins.gitInline.enabled",
    label: () => t("Inline git changes"),
  },
  {
    command: "toggleVim",
    key: "plugins.vim.enabled",
    label: () => t("Vim mode"),
  },
  {
    command: "toggleSpellcheck",
    key: "plugins.spellcheck.enabled",
    label: () => t("Spellcheck"),
  },
];

/** The note font size setting, a number in package.json. */
export const FONT_SIZE_KEY = "editor.fontSize";

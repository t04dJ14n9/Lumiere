import { Schema } from "@workshop/core";
import type { Infer } from "@workshop/core";

const modes = Schema.union([
  "off",
  "afterDelay",
  "onFocusChange",
  "onWindowChange",
]);

/**
 * VS Code's `files.autoSave` as it applies to Markdown files. Any mode but
 * "off" means VS Code saves the note itself, so the document plugin does not.
 * An invalid hand-edited value falls back to "off", as it does in VS Code.
 */
export const filesAutoSave = new Schema<Infer<typeof modes>>((value) => {
  try {
    return modes.parse(value);
  } catch {
    return "off";
  }
}, {}).default("off");

export const autosaveNativeKeys = { filesAutoSave: "files.autoSave" } as const;

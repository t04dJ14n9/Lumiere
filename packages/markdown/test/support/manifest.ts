import { readFileSync } from "node:fs";
import path from "node:path";

/** What tests read from the extension manifest. */
export interface ExtensionManifest {
  activationEvents?: string[];
  contributes: {
    commands: { command: string; title: string; category?: string }[];
    configuration: { title: string; properties: Record<string, unknown> }[];
    keybindings: {
      command: string;
      key?: string;
      mac?: string;
      when?: string;
    }[];
    menus: Record<string, { command: string; when?: string; group?: string }[]>;
    views?: Record<string, { id: string; name: string; when?: string }[]>;
    customEditors: { viewType: string }[];
  };
}

/**
 * The extension's package.json at the repository root, as VS Code shows it
 * in English: each `%key%` replaced by its text from package.nls.json.
 */
export function extensionManifest(): ExtensionManifest {
  const root = path.resolve(__dirname, "../../../..");
  const nls = JSON.parse(
    readFileSync(path.join(root, "package.nls.json"), "utf8"),
  ) as Record<string, string>;
  return JSON.parse(
    readFileSync(path.join(root, "package.json"), "utf8"),
    (_key, value: unknown) => {
      const key = typeof value === "string" && /^%[^%\s]+%$/u.exec(value)?.[0];
      return key ? (nls[key.slice(1, -1)] ?? value) : value;
    },
  ) as ExtensionManifest;
}

/** Every contributed setting, across the manifest's settings sections. */
export function contributedProperties<T = unknown>(): Record<string, T> {
  return Object.assign(
    {},
    ...extensionManifest().contributes.configuration.map(
      (section) => section.properties,
    ),
  ) as Record<string, T>;
}

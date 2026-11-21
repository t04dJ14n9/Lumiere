/**
 * Lumière's Command Palette outside VS Code: filters contributed commands by
 * their `commandPalette` when-clause (`when.ts`), active editor state, plugin
 * context keys and settings, and runs a chosen command through `HostCommands`.
 */
import type { HostSettings } from "@workshop/markdown/portable";
import type { ContextKeys } from "./context-menu";
import type { PanelHub } from "./panels";
import type { NodeHostCommands } from "./services";
import { evaluateWhen, settingOfKey } from "./when";

/** One command from `package.json`, with its `commandPalette` when-clause (`assets.mjs`). */
export interface CommandContribution {
  readonly command: string;
  readonly title: string;
  readonly category?: string;
  readonly when?: string;
}

/** A command currently available in the Command Palette. */
export interface PaletteCommand {
  readonly command: string;
  readonly title: string;
  readonly category?: string;
}

/** The commands whose clause holds and that a plugin has registered. */
export function paletteCommands(
  contributions: readonly CommandContribution[],
  lookup: (key: string) => unknown,
  isRegistered: (command: string) => boolean = () => true,
): PaletteCommand[] {
  const seen = new Set<string>();
  const items: PaletteCommand[] = [];
  for (const item of contributions) {
    if (
      !seen.has(item.command) &&
      isRegistered(item.command) &&
      evaluateWhen(item.when, lookup)
    ) {
      seen.add(item.command);
      items.push({
        command: item.command,
        title: item.title,
        ...(item.category ? { category: item.category } : {}),
      });
    }
  }
  return items;
}

export interface CommandPaletteOptions {
  readonly contributions: readonly CommandContribution[];
  readonly keys: ContextKeys;
  readonly settings: HostSettings;
  readonly panels: Pick<PanelHub, "active">;
  readonly commands: NodeHostCommands;
  readonly viewType: string;
  readonly log: (message: string) => void;
}

export interface CommandPalette {
  list(): readonly PaletteCommand[];
  run(command: string): Promise<boolean>;
}

export function createCommandPalette(
  options: CommandPaletteOptions,
): CommandPalette {
  const lookup = (key: string): unknown => {
    if (key === "activeCustomEditorId") {
      return options.panels.active() ? options.viewType : undefined;
    }
    const setting = settingOfKey(key);
    if (setting !== undefined) {
      return options.settings.get(setting, undefined);
    }
    return options.keys.get(key);
  };
  const list = () =>
    paletteCommands(options.contributions, lookup, (id) =>
      options.commands.has(id),
    );
  return {
    list,
    async run(command: string): Promise<boolean> {
      // Only what the palette shows runs: a page is same-origin with the
      // embedder and could otherwise run any registered command, setContext
      // included. Without a command list nothing runs.
      if (!list().some((item) => item.command === command)) {
        return false;
      }
      try {
        await options.commands.execute(command);
        return true;
      } catch (error) {
        options.log(`${command} failed: ${String(error)}`);
        return false;
      }
    },
  };
}

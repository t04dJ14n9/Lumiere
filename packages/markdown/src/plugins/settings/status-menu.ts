import { t } from "@workshop/l10n";
import type { PickItem } from "../../shared/host";
import { toggles } from "./commands";

/** What a menu row runs: one of Lumiere's commands, by its short id. */
export interface MenuChoice {
  command: string;
}

export interface MenuState {
  /** A toggle's boolean setting as it applies to the active note. */
  isOn(key: string): boolean;
  /** The active note's mode, when a note is active and has reported it. */
  mode?: "source" | "livePreview";
}

/**
 * The status bar gear's menu: the common switches with their state first,
 * then the ways to every other setting. Each row runs an existing command,
 * so a switch here writes exactly what its palette command writes.
 */
export function settingsMenuItems(state: MenuState): PickItem<MenuChoice>[] {
  const quick = t("Quick toggles");
  const rows: PickItem<MenuChoice>[] = [];
  if (state.mode) {
    rows.push(
      toggleRow(t("Source mode"), state.mode === "source", "toggleSourceMode"),
    );
  }
  for (const toggle of toggles) {
    rows.push(
      toggleRow(toggle.label(), state.isOn(toggle.key), toggle.command),
    );
  }
  for (const row of rows) {
    row.group = quick;
  }
  const more = t("All settings");
  return [
    ...rows,
    {
      label: t("Change Setting…"),
      group: more,
      value: { command: "changeSetting" },
    },
    {
      label: t("Manage Plugins"),
      group: more,
      value: { command: "managePlugins" },
    },
    {
      label: t("Open Settings"),
      group: more,
      value: { command: "openSettings" },
    },
  ];
}

function toggleRow(
  label: string,
  on: boolean,
  command: string,
): PickItem<MenuChoice> {
  return {
    label: `${on ? "$(check)" : "$(blank)"} ${label}`,
    description: on ? t("On") : t("Off"),
    value: { command },
  };
}

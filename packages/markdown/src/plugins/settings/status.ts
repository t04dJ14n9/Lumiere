import type { Context } from "@workshop/core";
import { t } from "@workshop/l10n";
import type { StatusHandle } from "../../shared/host";
import { contributionId } from "../../shared/setting-schema";
import type {} from "../editor/api";
import { protocol as editorProtocol } from "../editor/protocol";
import { isSettingOn, type Editing } from "./edit";
import { settingsMenuItems, type MenuChoice } from "./status-menu";

const VIM_KEY = "plugins.vim.enabled";

/** The Vim entry's text: its state is in the words, as VS Code shows no checkbox. */
export function vimStatusText(on: boolean): { text: string; tooltip: string } {
  return on
    ? {
        text: `$(keyboard) ${t("Vim")}`,
        tooltip: t("Vim mode is on. Click to turn it off."),
      }
    : {
        text: `$(keyboard) ${t("Vim off")}`,
        tooltip: t("Vim mode is off. Click to turn it on."),
      };
}

/**
 * The Vim switch and the settings gear on the status bar, while a note is the
 * active tab. The Vim plugin itself may be off, so its switch lives here;
 * the Vim plugin's own entry (on the left) shows its mode while it is on.
 */
export function registerSettingsStatus(ctx: Context, editing: Editing): void {
  const views = ctx.views;
  const editors = ctx.editors;
  ctx.effect(() =>
    ctx.hostCommands.register(contributionId("statusMenu"), () =>
      openSettingsMenu(ctx, editing),
    ),
  );
  if (!views?.statusBar || !editors) {
    return;
  }
  const vim = views.status("lumiere.markdown.vimToggle", 97);
  const gear = views.status("lumiere.markdown.settingsMenu", 96);
  ctx.effect(() => () => {
    vim.dispose();
    gear.dispose();
  });
  const render = () =>
    showEntries(editors.active() !== undefined, editing, {
      vim,
      gear,
    });
  ctx.effect(() => ctx.settings.onChange(render));
  ctx.on("editor/activeChanged", render);
  ctx.on("editor/opened", render);
  ctx.on("editor/closed", render);
  render();
}

function showEntries(
  isNoteActive: boolean,
  editing: Editing,
  entries: { vim: StatusHandle; gear: StatusHandle },
): void {
  if (!isNoteActive) {
    entries.vim.hide();
    entries.gear.hide();
    return;
  }
  const { text, tooltip } = vimStatusText(isSettingOn(editing, VIM_KEY));
  entries.vim.show(text, tooltip, contributionId("toggleVim"));
  entries.gear.show(
    "$(gear)",
    t("Lumiere settings"),
    contributionId("statusMenu"),
  );
}

async function openSettingsMenu(ctx: Context, editing: Editing): Promise<void> {
  const mode = await activeMode(ctx);
  const picked = await editing.dialogs.pick<MenuChoice>({
    placeholder: t("Lumiere settings"),
    items: () =>
      settingsMenuItems({
        isOn: (key) => isSettingOn(editing, key),
        ...(mode && { mode }),
      }),
  });
  const choice = picked?.item?.value;
  if (choice) {
    await ctx.hostCommands.execute(contributionId(choice.command));
  }
}

/** The active note's mode, or undefined when no note is active or it cannot say. */
async function activeMode(
  ctx: Context,
): Promise<"source" | "livePreview" | undefined> {
  const panel = ctx.editors?.active();
  if (!panel) {
    return undefined;
  }
  try {
    return (await panel.rpc.call(editorProtocol, "captureView", {})).mode;
  } catch {
    return undefined;
  }
}

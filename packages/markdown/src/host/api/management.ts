import type { Uri } from "vscode";
import type { Context } from "@workshop/core";
import type { PickItem } from "../../shared/host";
import { contributionId } from "../../shared/setting-schema";
import type { ApiPlatform } from "./platform";
import type {
  MarkdownWorkshopApi,
  PluginDescriptor,
  PluginState,
} from "./types";
import { t } from "@workshop/l10n";

/** What choosing a row of Show Plugin Status opens. */
export interface PluginStatusTarget {
  readonly id: string;
  /** The setting that turns the plugin on or off; core plugins have none. */
  readonly setting?: string;
}

const order: Record<PluginState["state"], number> = {
  failed: 0,
  pending: 1,
  loading: 2,
  active: 3,
  disabled: 4,
};
const icons: Record<PluginState["state"], string> = {
  failed: "$(error)",
  pending: "$(clock)",
  loading: "$(loading~spin)",
  active: "$(pass)",
  disabled: "$(circle-slash)",
};

function stateText(state: PluginState): string {
  switch (state.state) {
    case "failed":
      return t("Failed");
    case "pending":
      return state.waitingFor.length
        ? t("Waiting for {0}", state.waitingFor.join(", "))
        : t("Waiting");
    case "loading":
      return t("Loading");
    case "active":
      return t("Active");
    case "disabled":
      return t("Disabled");
  }
}

function kindText(kind: PluginDescriptor["kind"]): string {
  switch (kind) {
    case "core":
      return t("core");
    case "feature":
      return t("feature");
    case "external":
      return t("external");
  }
}

function settingOf(descriptor: PluginDescriptor): string | undefined {
  if (descriptor.kind === "feature") {
    return contributionId(`plugins.${descriptor.id}.enabled`);
  }
  if (descriptor.kind === "external") {
    return contributionId("plugins.external");
  }
  return undefined;
}

/**
 * One row per plugin of an editor (DESIGN §5.7): problems first, so a failed
 * or blocked plugin is never below the fold, then catalog order.
 */
export function pluginStatusItems(
  catalog: readonly PluginDescriptor[],
  states: readonly PluginState[],
): PickItem<PluginStatusTarget>[] {
  const rows = states.flatMap((state, index) => {
    const descriptor = catalog.find((item) => item.id === state.id);
    return descriptor ? [{ state, descriptor, index }] : [];
  });
  rows.sort(
    (a, b) => order[a.state.state] - order[b.state.state] || a.index - b.index,
  );
  return rows.map(({ state, descriptor }) => {
    const setting = settingOf(descriptor);
    return {
      label: `${icons[state.state]} ${descriptor.title}`,
      description: t("{0} · {1}", stateText(state), kindText(descriptor.kind)),
      detail: state.error ?? descriptor.description,
      value: setting ? { id: descriptor.id, setting } : { id: descriptor.id },
    };
  });
}

async function showPluginStatus(
  ctx: Context,
  api: MarkdownWorkshopApi,
  platform: ApiPlatform,
): Promise<void> {
  const editor = api.getActiveEditor();
  if (!editor) {
    ctx.dialogs.inform(t("Open a note in Lumiere to see its plugin states."));
    return;
  }
  const items = pluginStatusItems(
    api.getPluginCatalog(),
    api.getPlugins(editor.editorId),
  );
  const chosen = await ctx.dialogs.pick({
    placeholder: t(
      "Plugins in {0}: choose one to open its setting",
      basename(editor.uri),
    ),
    items: (query) => filterItems(items, query),
  });
  const setting = chosen?.item?.value.setting;
  if (setting) {
    await platform.settings(editor.uri, setting);
  }
}

function filterItems<T>(
  items: readonly PickItem<T>[],
  query: string,
): PickItem<T>[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return items.filter((item) => {
    const text = `${item.label} ${item.description ?? ""}`.toLowerCase();
    return words.every((word) => text.includes(word));
  });
}

function basename(uri: Uri): string {
  return uri.path.split("/").pop() ?? uri.toString();
}

/** Manage Plugins and Show Plugin Status (DESIGN §6.5). */
export function registerPluginManagement(
  ctx: Context,
  api: MarkdownWorkshopApi,
  platform: ApiPlatform,
): void {
  ctx.effect(() =>
    ctx.hostCommands.register(contributionId("managePlugins"), () =>
      api.openPluginSettings(api.getActiveEditor()?.uri),
    ),
  );
  ctx.effect(() =>
    ctx.hostCommands.register(contributionId("showPluginStatus"), () =>
      showPluginStatus(ctx, api, platform),
    ),
  );
}

import type { Context, Plugin } from "@workshop/core";
import type { PickItem } from "../../shared/host";
import { contributionId } from "../../shared/setting-schema";
import type { Vault, Vaults } from "../vault/api";
import { AcceptKeys, type Acceptance } from "./accept";
import { switcherItems } from "./ranking";
import type { SwitcherTarget } from "./ranking";
import { readRecent, rememberOpen } from "./recent";
import { t } from "@workshop/l10n";

/** **Lumiere: Quick Switcher**: open or create a note by name. */
export const quickSwitcherHost: Plugin = {
  name: "quickSwitcher",
  inject: {
    required: [
      "dialogs",
      "settings",
      "navigation",
      "vaults",
      "hostCommands",
      "activeEditor",
      "storage",
    ],
  },
  apply(ctx) {
    const keys = new AcceptKeys(ctx.hostCommands);
    ctx.on("editor/opened", (panel) => {
      void rememberOpen(ctx.storage, panel.document.uri);
    });
    ctx.effect(() => {
      const disposers = keys.register();
      return async () => {
        await Promise.all(disposers.map((dispose) => dispose()));
      };
    });
    ctx.effect(() =>
      ctx.hostCommands.register(contributionId("quickSwitcher"), () =>
        runSwitcher(ctx, keys),
      ),
    );
  },
};

/** Ask for a note, then open or create it as the accepting key says. */
async function runSwitcher(ctx: Context, keys: AcceptKeys): Promise<void> {
  const active = ctx.activeEditor.note();
  const vault = await switcherVault(ctx.vaults, active);
  if (!vault) {
    ctx.dialogs.error(t("Open a folder to use the quick switcher."));
    return;
  }
  // Keep the initiating note through the picker, even if focus changes.
  const source = active ?? `${vault.index.root}/`;
  await ctx.settings.effective.prepare(source);
  const recent = readRecent(ctx.storage);
  const showUnsupportedFiles = Boolean(
    ctx.settings.get("vault.showUnsupportedFiles", false, source),
  );
  await keys.begin();
  let result: { item?: PickItem<SwitcherTarget>; query: string } | undefined;
  let acceptance: Acceptance;
  try {
    result = await ctx.dialogs.pick({
      placeholder: t("Find or create a note…"),
      items: (query) =>
        switcherItems(vault.index, query, { recent, showUnsupportedFiles }),
    });
  } finally {
    acceptance = await keys.end();
  }
  const opener = new SwitcherOpener(ctx, vault, source, acceptance);
  const query = result?.query.trim() ?? "";
  if (acceptance.isCreate) {
    // Shift+Enter: the typed name, whatever row is selected.
    if (query) {
      await opener.create(query);
    }
  } else if (result?.item) {
    await opener.open(result.item.value);
  } else if (query) {
    await opener.create(query);
  }
}

/** Opens or creates the chosen note where the accepting key says. */
class SwitcherOpener {
  constructor(
    private readonly ctx: Context,
    private readonly vault: Vault,
    private readonly source: string,
    private readonly acceptance: Acceptance,
  ) {}

  async open(target: SwitcherTarget): Promise<void> {
    if (target.kind !== "note") {
      await this.create(
        target.kind === "create" ? target.name : target.linkpath,
      );
      return;
    }
    // Attachments open in other editors, which do not report it: remember
    // them here so an empty query lists them, as Obsidian's does.
    await rememberOpen(this.ctx.storage, target.file.uri);
    await this.ctx.vaults.open(target.file.uri, this.place());
  }

  async create(name: string): Promise<void> {
    const uri = await this.ctx.navigation.resolve({
      root: this.vault.index.root,
      source: this.source,
      path: name,
      create: true,
      folderNote: "",
    });
    if (uri) {
      await this.ctx.vaults.open(uri, this.place());
    }
  }

  private place(): { side?: boolean; tab?: boolean } {
    const { place } = this.acceptance;
    if (place === "here") {
      return {};
    }
    return place === "side" ? { side: true } : { tab: true };
  }
}

async function switcherVault(
  vaults: Vaults,
  active: string | undefined,
): Promise<Vault | undefined> {
  const located = active ? await vaults.locate(active) : undefined;
  return located?.vault ?? (await vaults.forWorkspace());
}

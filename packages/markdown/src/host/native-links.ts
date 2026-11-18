import { parseNativeLineFragment } from "../shared/native-links";
import { contributionId } from "../shared/setting-schema";
import type { NavigationIntent } from "../shared/host";
import { contained } from "./navigation";
import type { NativeNavigation } from "./navigation";
import { openNativeLineRange } from "./open-native-line";
import { registerSourceLinks, type LinkRun } from "./source-links";
import * as vscode from "vscode";
import { findVaultRoot, foldersUpTo } from "../plugins/vault/roots";

export function registerNativeLinks(navigation: NativeNavigation) {
  const intents = new WeakMap<LinkRun, NavigationIntent>();
  return registerSourceLinks({
    command: contributionId("openNativeLink"),
    accepts: (path) => /\.(md|markdown)$/i.test(path),
    authorize: contained,
    root: vaultRoot,
    begin() {
      const intent = navigation.begin!();
      const run = {
        current: () => !intent.token.cancelled,
        cancel: () => intent.token.cancel(),
      };
      intents.set(run, intent);
      return run;
    },
    async open(target, root, column, run) {
      const intent = intents.get(run)!;
      const lines = parseNativeLineFragment(target.fragment);
      if (lines) {
        await openNativeLineRange(navigation, {
          target: target.with({ fragment: "" }),
          lines,
          column,
          intent: { ...intent, column },
        });
        return;
      }
      await navigation.open(
        root.toString(),
        target.with({ fragment: "" }).toString(),
        target.fragment,
        "here",
        undefined,
        { ...intent, column },
      );
    },
  });
}

/** The note's vault, as the Lumiere view finds it: the nearest root marker. */
async function vaultRoot(
  source: vscode.Uri,
  workspace: vscode.Uri,
): Promise<vscode.Uri> {
  const markers = vscode.workspace
    .getConfiguration("lumiere.markdown", source)
    .get<string[]>("vault.rootMarkers", [".obsidian"]);
  const root = await findVaultRoot(
    foldersUpTo(source.toString(), workspace.toString()),
    async (folder) => {
      const found = await Promise.all(
        markers.map((marker) =>
          vscode.workspace.fs
            .stat(vscode.Uri.joinPath(vscode.Uri.parse(folder), marker))
            .then(
              () => true,
              () => false,
            ),
        ),
      );
      return found.includes(true);
    },
  );
  return root ? vscode.Uri.parse(root) : workspace;
}

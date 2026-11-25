import { isMarpDocument, setMarpEnabled } from "../../markdown/marp";
import { MARKDOWN_EDITOR } from "../../shared/editor-provider";
import { replaceAllEdit } from "../../shared/text-edit";
import type { HostDocument, TextEdit } from "../../shared/host";
import { isKept, rememberDeck } from "./keep";
import type { KeepStorage } from "./keep";
import { shouldOpenMarpAsText } from "./redirect";
import { t } from "@workshop/l10n";

export const MARP_EXTENSION = "marp-team.marp-vscode";

export interface MarpActions {
  readonly storage?: KeepStorage;
  execute(id: string, ...args: unknown[]): Promise<unknown>;
  reveal?(uri: string): Promise<void>;
  apply(document: HostDocument, edits: readonly TextEdit[]): Promise<boolean>;
  ask(message: string, actions: readonly string[]): Promise<string | undefined>;
  clipboardWrite(text: string): Promise<void>;
  inform(message: string): void;
  error(message: string): void;
  trusted(): boolean | undefined;
  marpInstalled(): boolean;
}

export async function previewDeck(
  actions: MarpActions,
  uri: string,
): Promise<void> {
  await actions.execute("markdown.showPreviewToSide", uri);
  if (!actions.marpInstalled()) {
    actions.inform(
      t(
        "Opened the Markdown preview. Install Marp for VS Code to render slides.",
      ),
    );
  }
}

export async function exportDeck(
  actions: MarpActions,
  uri: string,
): Promise<void> {
  if (actions.trusted() === false) {
    actions.error(t("Marp export needs a trusted workspace."));
    return;
  }
  if (!actions.marpInstalled()) {
    await offerMarpInstall(actions);
    return;
  }
  if (!actions.reveal) {
    actions.error(t("Cannot show the text editor for export."));
    return;
  }
  await actions.reveal(uri);
  await actions.execute("markdown.marp.export");
}

export async function toggleMarp(
  actions: MarpActions,
  document: HostDocument,
): Promise<void> {
  const source = document.getText();
  const next = setMarpEnabled(source, !isMarpDocument(source));
  if (next === source) {
    actions.inform(
      isMarpDocument(source)
        ? t("Marp is already on.")
        : t("Marp is already off."),
    );
    return;
  }
  const applied = await actions.apply(document, [replaceAllEdit(source, next)]);
  if (!applied) {
    actions.error(t("Could not update the Marp frontmatter."));
  }
}

export async function keepDeck(
  actions: MarpActions,
  uri: string,
): Promise<void> {
  await rememberDeck(actions.storage, uri);
  await actions.execute("vscode.openWith", uri, MARKDOWN_EDITOR.viewType);
  actions.inform(t("This deck stays in Lumiere."));
}

export function redirectToTextEditor(input: {
  readonly mode: unknown;
  readonly text: string;
  readonly uri: string;
  readonly storage?: KeepStorage;
}): boolean {
  return shouldOpenMarpAsText({
    mode: typeof input.mode === "string" ? input.mode : "workbench",
    isMarp: isMarpDocument(input.text),
    allowed: isKept(input.storage, input.uri),
  });
}

async function offerMarpInstall(actions: MarpActions): Promise<void> {
  const install = t("Install Marp for VS Code");
  const answer = await actions.ask(t("Export needs Marp for VS Code."), [
    install,
  ]);
  if (answer === install) {
    await actions.execute("workbench.extensions.search", MARP_EXTENSION);
  }
}

/**
 * Lumiere: Markdown Editor and PDF Reader. The composition root of the extension: one
 * plugin tree (see @workshop/core) for both products, its output channel,
 * and the services every plugin may inject from the root. Each product adds
 * its own plugins; deactivation stops them all, last started first.
 */
import { env, l10n, window, workspace, type ExtensionContext } from "vscode";
import { configureL10n } from "@workshop/l10n";
import { createRoot, type RootContext } from "@workshop/core";
import {
  outputLogger,
  pluginRank,
  startMarkdown,
  type MarkdownWorkshopApi,
} from "@workshop/markdown/host";
import { createPdfOutlines, startPdf } from "@workshop/pdf/host";
import { markdownNoteSelections } from "./note-selections";

let root: RootContext | undefined;

export async function activate(
  context: ExtensionContext,
): Promise<MarkdownWorkshopApi> {
  const started = performance.now();
  // VS Code's display language: its bundle for Lumiere's own text, shared
  // with every module and handed to each webview page.
  configureL10n(l10n.bundle, env.language);
  const channel = window.createOutputChannel("Lumiere", { log: true });
  context.subscriptions.push(channel);
  const debugLogging = () =>
    workspace.getConfiguration("lumiere.markdown").get("debug.logging", false);
  root = createRoot({
    rank: pluginRank,
    logger: outputLogger(channel, debugLogging),
  });
  root.provide("extensionContext", context);
  root.provide("outputChannel", channel);
  // Provided before PDF starts, so its agent bridge does not restart when
  // Lumiere's API arrives.
  const markdown: { api?: MarkdownWorkshopApi } = {};
  root.provide(
    "noteSelections",
    markdownNoteSelections(() => markdown.api),
  );
  // Lumiere reads PDF bookmarks, for `[[paper.pdf#`, with the viewer's PDFium.
  // Provided before Lumiere starts, so its editor host does not restart when it
  // arrives.
  const outlines = createPdfOutlines(context, channel);
  context.subscriptions.push({ dispose: () => outlines.dispose() });
  root.provide("pdfOutlines", outlines);
  startPdf(root);
  const api = await startMarkdown(root, context);
  markdown.api = api;
  await root.settled();
  channel.info(`Activated in ${Math.round(performance.now() - started)} ms`);
  return api;
}

/** VS Code awaits this (unlike subscriptions' disposal), so teardown completes. */
export async function deactivate(): Promise<void> {
  const stopping = root;
  root = undefined;
  await stopping?.dispose();
}

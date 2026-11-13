import { webviewLogging } from "../plugins/editor/logging";
import { pluginRank } from "../plugins/catalog";
import { pluginReporting } from "./plugin-reporting";
import { preloadChromeFeatures, preloadPaintFeatures } from "./features";
import { runFeaturePhases } from "./feature-phases";
import { headerParts } from "../markdown/properties/header-parts";
import { registerEditorSettings } from "./editor-settings";
import { settleSnapshot } from "./snapshot";
import { createRoot, type RootContext } from "@workshop/core";
import type { Infer } from "@workshop/core";
import type { viewState } from "../plugins/editor/protocol";
import type { Endpoint } from "../shared/rpc/endpoint";
import { protocol } from "../plugins/editor/protocol";
import { documentWebview } from "../plugins/document/webview";
import { markersWebview } from "../plugins/markers/webview";
import { editorWebview } from "../plugins/editor/webview";
import { dialectWebview } from "../plugins/dialect/webview";
import { commandsWebview } from "../plugins/commands/webview";
import { livePreviewWebview } from "../plugins/livePreview/webview";
import { renderWebview } from "../plugins/render/webview";
import { resourcesWebview } from "../plugins/resources/webview";
import type { featureSettings } from "../shared/features";

type FeatureSettings = Infer<typeof featureSettings>;
type Configure = ReturnType<typeof pluginReporting>;

export async function bootstrap(
  rpc: Endpoint,
  parent: HTMLElement,
  presentation: {
    saved?: unknown;
    persist?: (state: Infer<typeof viewState>) => void;
  } = {},
  logging = webviewLogging((record) => rpc.notify(protocol, "log", record)),
) {
  const init = await rpc.call(protocol, "ready", {});
  performance.mark("mw:ready");
  logging.configure(init.debugLogging);
  const root = createRoot({
    logger: logging.logger,
    rank: pluginRank,
  });
  root.provide("rpc", rpc);
  root.effect(() => rpc.on(protocol, "configureLogging", logging.configure));
  root.plugin(documentWebview, init);
  root.plugin(dialectWebview);
  const editor = root.plugin(editorWebview, {
    ...init,
    parent,
    ...presentation,
    mode: init.preset === "minimal" ? "source" : init.mode,
  });
  root.plugin(commandsWebview);
  root.plugin(markersWebview);
  if (init.preset === "obsidian") {
    root.plugin(resourcesWebview);
    root.plugin(renderWebview, { trusted: init.trusted });
    root.plugin(livePreviewWebview, { mode: init.mode });
  }
  registerEditorSettings(root, rpc, editor);
  const configure = pluginReporting(root, rpc);
  // Chrome (Properties + lineNumbers) must not share the settle-window wire
  // with tables/callouts (wave 13, not the closed #288). Only a note with a
  // frontmatter fence needs the sheet graph (~490 KB of YAML and markdown-it)
  // that early; other notes fetch Properties after `mw:first-paint`, so those
  // chunks cannot compete with the entry's static graph for the loader.
  const chromeChunks = preloadChrome(init);
  const startPaint =
    init.preset === "obsidian"
      ? () => preloadPaintFeatures(init.features, true)
      : (): Promise<void> => Promise.resolve();
  await root.settled();
  const failed = [...root.plugins].find((fiber) => fiber.state === "failed");
  if (failed) {
    throw failed.error;
  }
  performance.mark("mw:plugins");
  const featuresLoaded = scheduleFeaturePhases({
    root,
    configure,
    chromeChunks,
    startPaint,
    features: init.features,
    defaults: init.preset === "obsidian",
  });
  settleSnapshot(parent, init, featuresLoaded);
  rpc.notify(protocol, "initialized", {});
  return root;
}

/** The settle window's chrome chunks; Properties only for a note with frontmatter. */
function preloadChrome(init: { preset: string; text: string }): Promise<void> {
  return init.preset !== "obsidian"
    ? Promise.resolve()
    : preloadChromeFeatures(headerParts(init.text) !== undefined);
}

/**
 * Glyphs first (rAF), then Properties + lineNumbers as soon as chrome chunks
 * are ready — without waiting on tables/tags. Paint structure fetch starts on
 * this same frame (after chrome had the settle window alone) and configures
 * next.
 */
function scheduleFeaturePhases(options: {
  root: RootContext;
  configure: Configure;
  chromeChunks: Promise<void>;
  startPaint: () => Promise<void>;
  features: FeatureSettings;
  defaults: boolean;
}): Promise<void> {
  const { root, configure, chromeChunks, startPaint, features, defaults } =
    options;
  // Settles once every phase has run (or failed): the snapshot's cue to go.
  let finish!: () => void;
  const finished = new Promise<void>((resolve) => {
    finish = resolve;
  });
  requestAnimationFrame(() => {
    performance.mark("mw:first-paint");
    // A task later, not in this frame: the page lists the first view's chunks
    // as modulepreload hints, so they are usually fetched by now and the
    // phases would run in this task, before the browser paints the glyphs
    // (building the sheet of a note with 100 properties takes ~70 ms).
    setTimeout(() => {
      runFeaturePhases({
        chromeChunks,
        startPaint,
        configure: (phase) => configure(features, defaults, phase),
        mark: (name) => performance.mark(name),
        preloaded: document.querySelector('link[rel="modulepreload"]') !== null,
      })
        .catch((error: unknown) =>
          root.logger.error("Deferred features failed", error),
        )
        .finally(finish);
    }, 0);
  });
  return finished;
}

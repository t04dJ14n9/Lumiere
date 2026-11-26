import { protocol as modeProtocol } from "./protocol";
import { bindCaller } from "@workshop/core";
import type { CallerBound, Context, Plugin } from "@workshop/core";
import { pointerSelectionTracking } from "../../webview/ui/pointer-selection";
import { fenceGuardSelectionSupport } from "../../webview/ui/fence-click-guard";
import type { LivePreview } from "./api";
import { clickPositionSync, pointerDragPosition } from "./click-position";
import { ruleClick } from "./rule-click";
import { renderedPosition } from "./rendered-position";
import { Compartment } from "@codemirror/state";
import { keymap } from "@codemirror/view";
import type {} from "../editor/api";
import type {} from "../commands/api";
import type {} from "./api";
import {
  blockRenderers,
  inlineRenderers,
  persistentNodesCarry,
} from "./registry";
import {
  blockIndex,
  visiblePosition,
  renderRevision,
  refreshRender,
} from "./blocks";
import { blockDecorations, blockViewportSupport } from "./viewport-decorations";
import { documentTree, documentTreeParser } from "./document-tree";
import { forgetSheetHeights } from "../../markdown/properties/sheet-height-memory";
import { endPendingBlocks, pendingBlocks } from "./pending-blocks";
import { hybridInline } from "./inline-plugin";
import { headingDragStart } from "./heading-drag";
import type {} from "../render/api";
import {
  evictMarkdownBlockDomPool,
  MarkdownBlock,
} from "../../webview/ui/markdown-widget";
import { markdownBlockWidthTracker } from "../../webview/ui/markdown-block-height";
import {
  escapeBlock,
  verticalBlock,
  moveTo,
  renderedWidgets,
  revealedSourceBlocks,
  foldedRanges,
} from "./motion";
import { sourceVisibleAt } from "./source-visibility";
import { editorFocusTracking } from "./editor-focus-tracking";
export const livePreviewWebview: Plugin<{
  mode: "source" | "livePreview";
  /** Kinds of block whose renderers are still to load: their places are held until they do. */
  opening?: readonly string[];
}> = {
  name: "livePreview",
  inject: { required: ["editor", "commands", "render"], optional: ["rpc"] },
  provides: ["livePreview"],
  apply(ctx, config) {
    // One extension flush for engine + fallback block renderers (4 extends).
    const batch = ctx.editor.batch ?? ((fn) => fn());
    batch(() => {
      const service = registerEngine(ctx, config.mode, modeReporter(ctx));
      ctx.provide("livePreview", service);
      registerRenderInvalidation(ctx, service);
      registerFallbackBlocks(ctx);
      registerPendingBlocks(ctx, config.opening ?? []);
      registerModeCommand(ctx, service);
    });
  },
};

function registerEngine(
  ctx: Context,
  initialMode: "source" | "livePreview",
  reportMode: (mode: "source" | "livePreview") => void,
): LivePreview {
  const view = ctx.editor.view;
  const compartment = new Compartment();
  let mode = ctx.editor.mode ?? initialMode;
  reportMode(mode);
  const extension = engineExtensions(ctx);
  ctx.effect(() =>
    ctx.editor.extend(compartment.of(mode === "source" ? [] : extension)),
  );
  const service: LivePreview & CallerBound<LivePreview> = {
    [bindCaller](caller) {
      const owner = caller.owner;
      return {
        ...service,
        get mode() {
          return service.mode;
        },
        block: (renderer) =>
          ctx.editor.extend(blockRenderers.of(renderer), { owner }),
        inline: (renderer) =>
          ctx.editor.extend(inlineRenderers.of(renderer), { owner }),
      };
    },
    inlineExtensions: () => [documentTree, persistentNodesCarry, hybridInline],
    position: renderedPosition,
    visiblePosition,
    verticalPosition: verticalBlock,
    renderedWidgets,
    revealedSourceBlocks,
    foldedRanges,
    sourceVisibleAt,
    block(renderer: Parameters<typeof blockRenderers.of>[0]) {
      return ctx.editor.extend(blockRenderers.of(renderer));
    },
    inline(renderer: Parameters<typeof inlineRenderers.of>[0]) {
      return ctx.editor.extend(inlineRenderers.of(renderer));
    },
    get mode() {
      return mode;
    },
    setMode(next: "source" | "livePreview") {
      mode = next;
      ctx.editor.mode = next;
      reportMode(next);
      view.dispatch({
        effects: compartment.reconfigure(mode === "source" ? [] : extension),
      });
    },
  };
  return service;
}

function registerRenderInvalidation(ctx: Context, service: LivePreview): void {
  const view = ctx.editor.view;
  ctx.on("render/changed", () => {
    evictMarkdownBlockDomPool(ctx.render);
    const effect = refreshRender.of(null);
    if (!ctx.editor.dispatchEffect?.(effect)) {
      view.dispatch({ effects: effect });
    }
  });
  ctx.on("editor/modeRestored", (next) => service.setMode(next));
}

function registerFallbackBlocks(ctx: Context): void {
  // Code blocks and thematic breaks are decorated source lines instead
  // (code-lines.ts, inline.ts), so revealing them never moves the text.
  ctx.effect(() =>
    ctx.editor.extend(
      blockRenderers.of({
        kind: "HTMLBlock",
        nodes: ["HTMLBlock"],
        editing: "reveal",
        match: (node) => node.name === "HTMLBlock",
        // Replace whole lines, including up to three spaces of indentation.
        range: (node, state) => ({
          from: state.doc.lineAt(node.from).from,
          to: node.to,
        }),
        widget: (block) => new MarkdownBlock(block, ctx.render),
      }),
      { slot: "base" },
    ),
  );
}

/**
 * Holds the places of the blocks that features still to load will draw, so
 * the note shows no raw source for them and nothing below them jumps; once
 * every feature has loaded, a block whose renderer never came shows its source.
 */
function registerPendingBlocks(ctx: Context, kinds: readonly string[]): void {
  if (kinds.length === 0) {
    return;
  }
  ctx.effect(() => ctx.editor.extend(pendingBlocks(kinds), { slot: "base" }));
  ctx.on("editor/featuresLoaded", () => {
    forgetSheetHeights();
    const effect = endPendingBlocks();
    if (!ctx.editor.dispatchEffect?.(effect)) {
      ctx.editor.view.dispatch({ effects: effect });
    }
  });
}

/** Tells the host the panel's mode, for its status bar entry. */
function modeReporter(ctx: Context) {
  return (mode: "source" | "livePreview") =>
    ctx.rpc?.notify(modeProtocol, "mode", { mode });
}

function registerModeCommand(ctx: Context, service: LivePreview): void {
  ctx.effect(() =>
    ctx.commands.register("editor:toggle-source", () => {
      service.setMode(service.mode === "source" ? "livePreview" : "source");
      return true;
    }),
  );
}

function engineExtensions(ctx: Context) {
  return [
    documentTree,
    documentTreeParser,
    markdownBlockWidthTracker,
    renderRevision,
    editorFocusTracking,
    pointerSelectionTracking,
    fenceGuardSelectionSupport,
    clickPositionSync,
    pointerDragPosition,
    ruleClick,
    headingDragStart,
    persistentNodesCarry,
    hybridInline,
    blockIndex,
    ...blockViewportSupport,
    blockDecorations((error) =>
      ctx.logger.error("Block renderer failed", error),
    ),
    keymap.of([
      { key: "Escape", run: moveTo(escapeBlock) },
      { key: "ArrowDown", run: moveTo((state) => verticalBlock(state, 1)) },
      { key: "ArrowUp", run: moveTo((state) => verticalBlock(state, -1)) },
    ]),
  ];
}

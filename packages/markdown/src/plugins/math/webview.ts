import type { Context, Infer, Plugin } from "@workshop/core";
import type {} from "../editor/api";
import type {} from "../commands/api";
import type {} from "../formatting/api";
import type { RenderPass } from "../render/api";
import { MarkdownBlock } from "../../webview/ui/markdown-widget";
import { sanitizeGraphics } from "../../webview/ui/graphics";
import { inlineMathEdit, mathBlockEdit } from "./commands";
import { mathBlockRange, mathBody } from "./source";
import { blockPreviewPlacement, decorateMath } from "./editing-preview";
import { errorMessage } from "../../shared/errors";
import { decodeDataValue } from "../../markdown/html/helpers";
import { config } from "./manifest";
import { loadOnceUnlessFailed } from "../../shared/load-once";
interface MathMount {
  macros: Record<string, string>;
}

export interface MathJaxModule {
  ensureBrowser(): Promise<void>;
  setUserMacros(raw: Record<string, string> | undefined): void;
  typeset(expression: string, display: boolean): Promise<string>;
  typesetSync(expression: string, display: boolean): string | undefined;
}
let mathjaxMod: MathJaxModule | undefined;
let mathjaxLoadStarted = false;
// A failed load (a chunk that did not arrive) is tried again by the next
// formula, not remembered for the rest of the session.
let loadMathJax = mathJaxLoader();

function mathJaxLoader(): () => Promise<MathJaxModule> {
  return loadOnceUnlessFailed(() => {
    mathjaxLoadStarted = true;
    return import("./mathjax").then((mod) => {
      mathjaxMod = mod;
      return mod;
    });
  });
}

/** Test hook to prime the MathJax module reference for synchronous postProcess tests. */
export function primeMathJaxForTest(mod: MathJaxModule | undefined): void {
  mathjaxMod = mod;
  mathjaxLoadStarted = mod !== undefined;
  loadMathJax = mod ? () => Promise.resolve(mod) : mathJaxLoader();
}

/** Test hook: true once apply/typeset has started a MathJax dynamic import. */
export function mathJaxLoadStartedForTest(): boolean {
  return mathjaxLoadStarted;
}

const mounts = new WeakMap<Context, MathMount>();

export const mathWebview: Plugin<Infer<typeof config>> = {
  name: "math",
  config,
  inject: {
    required: ["editor", "commands", "livePreview", "render"],
    optional: ["formatting"],
  },
  // Features re-renders after settings change; rebuild MathJax macros first.
  reconfigure(ctx, options) {
    const mount = mounts.get(ctx);
    if (!mount) {
      return false;
    }
    mount.macros = options.macros;
    if (mathjaxMod) {
      mathjaxMod.setUserMacros(mount.macros);
    } else {
      void loadMathJax().then(({ setUserMacros }) =>
        setUserMacros(mount.macros),
      );
    }
    return true;
  },
  apply(ctx, options) {
    const mount: MathMount = { macros: options.macros };
    mounts.set(ctx, mount);
    // Defer MathJax until the first math block (typesetNode), like lazy Mermaid.
    const cleanups = registerMathCleanup(ctx);
    registerTypesetting(ctx, cleanups, mount);
    registerMathRenderers(ctx);
    registerMathCommands(ctx);
  },
};

function registerMathRenderers(ctx: Context): void {
  const editing = { reveal: "click", select: mathBody } as const;
  ctx.effect(() =>
    ctx.livePreview.block({
      kind: "math",
      nodes: ["MathBlock"],
      editing: "reveal",
      // As in Obsidian (#698 item 23): the source shows only while the editor
      // has focus, and the formula is typeset again after it as it is edited.
      revealsOnlyWhileFocused: true,
      editingPreview: {
        sourceClass: "md-math-source",
        isBlock: (state, block) =>
          blockPreviewPlacement(state.doc, block) === "block",
      },
      match: (node) => node.name === "MathBlock",
      range: (node, state) => mathBlockRange(node, state.doc),
      widget: (block) => new MarkdownBlock(block, ctx.render, editing),
    }),
  );
  ctx.effect(() =>
    ctx.livePreview.inline({
      // Block math too: its revealed source is marked like inline math.
      nodes: ["InlineMath", "MathBlock"],
      decorate: (node, cx) => decorateMath(cx, node, ctx.render),
    }),
  );
}

function registerMathCleanup(ctx: Context): Set<() => void> {
  const cleanups = new Set<() => void>();
  ctx.effect(() => () => {
    for (const cleanup of cleanups) {
      cleanup();
    }
    cleanups.clear();
  });
  return cleanups;
}

function registerTypesetting(
  ctx: Context,
  cleanups: Set<() => void>,
  mount: MathMount,
): void {
  ctx.on("render/postProcess", (pass) => {
    for (const node of pass.container.querySelectorAll<HTMLElement>(
      "[data-math]",
    )) {
      typesetNode({ node, pass, cleanups, logger: ctx.logger, mount });
    }
  });
}

function registerMathCommands(ctx: Context): void {
  const view = ctx.editor.view;
  // Inline math toggles like bold: the word at the caret, each line of a
  // selection, or off again, through the formatting plugin when it runs
  // (whose wrap refuses a read-only editor itself).
  ctx.effect(() =>
    ctx.commands.register("editor:toggle-inline-math", () => {
      if (ctx.formatting) {
        return ctx.formatting.wrap("$", view);
      }
      if (view.state.readOnly) {
        return false;
      }
      view.dispatch(inlineMathEdit(view.state));
      return true;
    }),
  );
  ctx.effect(() =>
    ctx.commands.register("editor:insert-mathblock", () => {
      // CodeMirror leaves readOnly to commands: a dispatch would still edit.
      if (view.state.readOnly) {
        return false;
      }
      view.dispatch(mathBlockEdit(view.state));
      return true;
    }),
  );
}

interface TypesetOptions {
  node: HTMLElement;
  pass: RenderPass;
  cleanups: Set<() => void>;
  logger: Context["logger"];
  mount: MathMount;
}

function applyMathResult(
  node: HTMLElement,
  pass: RenderPass,
  expression: string,
  html: string,
): void {
  node.innerHTML = sanitizeGraphics(html);
  node.setAttribute("aria-label", expression);
  pass.measure();
}

function applyMathError(
  node: HTMLElement,
  logger: Context["logger"],
  error: unknown,
): void {
  node.classList.add("render-error");
  node.title = errorMessage(error);
  logger.warn("Math rendering failed", error);
}

function tryTypesetSync(
  options: TypesetOptions,
  expression: string,
  display: boolean,
  isActive: () => boolean,
): boolean {
  if (!mathjaxMod) {
    return false;
  }
  mathjaxMod.setUserMacros(options.mount.macros);
  try {
    const html = mathjaxMod.typesetSync(expression, display);
    if (html === undefined) {
      return false;
    }
    if (isActive()) {
      applyMathResult(options.node, options.pass, expression, html);
    }
    return true;
  } catch (error) {
    if (isActive()) {
      applyMathError(options.node, options.logger, error);
    }
    return true;
  }
}

function typesetNode(options: TypesetOptions): void {
  const { node, pass, cleanups, logger, mount } = options;
  const original = node.textContent;
  // A disposed pass must not receive the result of a lazy MathJax load.
  let active = true;
  const cleanup = () => {
    active = false;
    node.textContent = original;
    cleanups.delete(cleanup);
  };
  cleanups.add(cleanup);
  pass.onDispose(cleanup);
  const expression = decodeDataValue(node.dataset.math ?? "");
  const display = node.dataset.display === "true";
  if (tryTypesetSync(options, expression, display, () => active)) {
    return;
  }
  void loadMathJax()
    .then(({ typeset, setUserMacros }) => {
      setUserMacros(mount.macros);
      return typeset(expression, display);
    })
    .then((html) => {
      if (active) {
        applyMathResult(node, pass, expression, html);
      }
    })
    .catch((error) => {
      if (active) {
        applyMathError(node, logger, error);
      }
    });
}

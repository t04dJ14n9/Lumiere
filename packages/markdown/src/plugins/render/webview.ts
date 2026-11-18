import type {} from "../editor/api";
import { sanitizerOptions } from "./sanitizer-options";
import type { Context, Plugin } from "@workshop/core";
import type {} from "../dialect/api";
import type { RenderPass, RenderService } from "./api";
import { createRenderPass } from "./pass";
import { constrainRemoteContent } from "./security";
import { decodeDataValue } from "../../markdown/html/helpers";

export const renderWebview: Plugin<{ trusted: boolean }> = {
  name: "render",
  inject: { required: ["markdown", "editor"] },
  provides: ["render"],
  apply(ctx, config) {
    const passes = new Set<RenderPass>();
    registerPassCleanup(ctx, passes);
    ctx.provide(
      "render",
      renderService({ ctx, trusted: config.trusted, passes }),
    );
  },
};

function registerPassCleanup(ctx: Context, passes: Set<RenderPass>): void {
  ctx.effect(() => async () => {
    for (const pass of passes) {
      await pass.dispose();
    }
  });
}

type MaybeSyncPromise = Promise<void> & { readonly sync?: true };

function renderService({
  ctx,
  trusted,
  passes,
}: {
  ctx: Context;
  trusted: boolean;
  passes: Set<RenderPass>;
}): RenderService {
  // DOMPurify is ~70 KB and no rendered block needs it before first paint:
  // render.into already gates every block on the round-1 lazy renderer. Start
  // the import at apply so the chunk downloads in the settle window, but keep
  // it off the entry's static graph. executeRenderPass awaits it beside
  // renderer.ready().
  const sanitizer = import("dompurify").then(({ default: createDOMPurify }) => {
    const purifier = createDOMPurify(window);
    // Once: options passed with every call are parsed again on every call,
    // about half of what sanitizing a table cell costs.
    purifier.setConfig(sanitizerOptions(trusted));
    return (html: string): string => purifier.sanitize(html);
  });
  return {
    trusted,
    into(container, source, context = {}) {
      const pass = createRenderPass({ container, source, context, passes });
      container.classList.add("markdown-rendered");
      if (context.documentUri) {
        container.dataset.noteSource = context.documentUri;
      }
      return executeRenderPass({ ctx, trusted, sanitizer, pass, context });
    },
  };
}

function executeRenderPass({
  ctx,
  trusted,
  sanitizer,
  pass,
  context,
}: {
  ctx: Context;
  trusted: boolean;
  sanitizer: Promise<(html: string) => string>;
  pass: RenderPass;
  context: NonNullable<Parameters<RenderService["into"]>[2]>;
}): Promise<RenderPass> {
  const { container, source } = pass;
  const finishPostProcess = (): Promise<RenderPass> => {
    if (context.signal?.aborted) {
      return pass.dispose().then(() => pass);
    }
    const post = ctx.serial("render/postProcess", pass) as MaybeSyncPromise;
    if (post.sync) {
      renderFences(ctx, pass);
      pass.measure();
      return Promise.resolve(pass);
    }
    return post.then(() => {
      if (!context.signal?.aborted) {
        renderFences(ctx, pass);
      }
      pass.measure();
      return pass;
    });
  };
  const finishBody = async (): Promise<RenderPass> => {
    if (context.signal?.aborted) {
      return pass.dispose().then(() => pass);
    }
    // The renderer (round 1, 221 KB) and DOMPurify (69 KB) are both lazy
    // chunks fetched in the settle window; DOMPurify is smaller, so awaiting
    // it in parallel cannot delay the first rendered block or the first frame.
    const [sanitize] = await Promise.all([
      sanitizer,
      ctx.markdown.renderer.ready(),
    ]);
    if (context.signal?.aborted) {
      return pass.dispose().then(() => pass);
    }
    container.innerHTML = ctx.markdown.renderer.renderMarkdown(
      pass.displaySource ?? source,
      { sanitize, strictLineBreaks: ctx.editor.settings.strictLineBreaks },
    );
    constrainRemoteContent(container, trusted);
    return finishPostProcess();
  };
  try {
    const pre = ctx.serial("render/preProcess", pass) as MaybeSyncPromise;
    return pre.sync ? finishBody() : pre.then(finishBody);
  } catch (error) {
    return Promise.reject(error);
  }
}

function renderFences(ctx: Context, pass: RenderPass): void {
  for (const element of pass.container.querySelectorAll<HTMLElement>(
    "[data-fence]",
  )) {
    ctx.bail(
      "render/fence",
      {
        language: element.dataset.fence ?? "",
        source: decodeDataValue(element.dataset.source ?? ""),
        element,
      },
      pass,
    );
  }
}

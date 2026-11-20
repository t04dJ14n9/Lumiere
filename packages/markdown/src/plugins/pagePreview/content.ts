import { noteFragment } from "../../markdown/metadata/fragments";
import { attr, escape } from "../../markdown/html/helpers";
import type { RenderPass, RenderService } from "../render/api";
import type { Resource } from "../resources/api";

export function notePreview(text: string, href: string, source: string) {
  const fragment = href.split("#").slice(1).join("#");
  const selection = noteFragment(text, fragment);
  if (!selection) {
    throw new Error("Section not found.");
  }
  return {
    text: previewPrefix(selection.text),
    context: {
      documentUri: source,
      documentText: text,
      sourceLine: text.slice(0, selection.from).split("\n").length - 1,
      taskLineCount: 0,
      ancestry: [source + "#" + fragment],
    },
  };
}

/**
 * A preview shows about this much of a note or section: far more than its
 * popup holds without scrolling. Rendering a whole long note (with every
 * embed in it) for a hover cost as much as opening it.
 */
export const PREVIEW_LIMIT = 12_000;

/**
 * The beginning of `text` a preview renders: all of it when short, else up
 * to the last blank line within PREVIEW_LIMIT, moved back before a code
 * block or display formula the cut would leave open (it would swallow the
 * rest as code), and marked as cut with `…`.
 */
function previewPrefix(text: string): string {
  if (text.length <= PREVIEW_LIMIT) {
    return text;
  }
  let end = text.slice(0, PREVIEW_LIMIT).lastIndexOf("\n\n");
  if (end < PREVIEW_LIMIT / 2) {
    end = PREVIEW_LIMIT;
  }
  end = Math.min(end, openBlockStart(text.slice(0, end)) ?? end);
  return `${text.slice(0, end).trimEnd()}\n\n…`;
}

/** Where a fenced code block or `$$` formula still open at the end of `text` starts. */
function openBlockStart(text: string): number | undefined {
  let open: { fence: string; from: number } | undefined;
  let from = 0;
  for (const line of text.split("\n")) {
    const fence = /^ {0,3}(`{3,}|~{3,}|\$\$)/.exec(line)?.[1];
    if (fence && !open) {
      const closesOnItsLine =
        fence === "$$" && line.trim().indexOf("$$", 2) >= 0;
      open = closesOnItsLine ? undefined : { fence, from };
    } else if (fence && open && fence.startsWith(open.fence.slice(0, 2))) {
      open = fence.length >= open.fence.length ? undefined : open;
    }
    from += line.length + 1;
  }
  return open?.from;
}

/** Previews share the render pipeline but never authorize task edits. */
export async function renderPreview(options: {
  body: HTMLElement;
  resource: Resource;
  href: string;
  source?: string;
  wiki?: boolean;
  render: RenderService;
}): Promise<RenderPass | undefined> {
  const { body, resource, href, source, wiki, render } = options;
  if (resource.kind === "note" && resource.text !== undefined) {
    const preview = notePreview(resource.text, href, resource.source);
    return render.into(body, preview.text, preview.context);
  }
  if (["image", "pdf", "audio", "video", "base"].includes(resource.kind)) {
    return render.into(
      body,
      `<span${wiki ? ' data-wiki="true"' : ""}${attr("data-resource", href)}>${escape(href)}</span>`,
      {
        ...(source === undefined ? {} : { documentUri: source }),
        taskLineCount: 0,
      },
    );
  }
  body.classList.add("mod-empty");
  body.textContent = `${resource.kind.toUpperCase()} attachment — use Open to view it.`;
  return undefined;
}

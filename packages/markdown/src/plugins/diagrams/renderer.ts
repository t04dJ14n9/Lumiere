import type { Logger } from "@workshop/core";
import {
  RENDER_PENDING_ATTRIBUTE,
  type Fence,
  type RenderPass,
} from "../render/api";
import {
  sanitizeGraphics,
  type SanitizeGraphicsOptions,
} from "../../webview/ui/graphics";
import { errorMessage } from "../../shared/errors";
import { createMermaidTrust, type MermaidTrust } from "./trust";
import { MermaidQueue } from "./mount-queue";
import { bindDiagramInspector } from "./diagram-dialog";
import { defaultSankeyNodeColors } from "./sankey";
import { mermaidTransaction } from "./mermaid-session";
import {
  readMermaidPalette,
  mermaidConfiguration,
  mermaidCacheKey,
  categoryColors,
  type MermaidPalette,
} from "./theme";
import { t } from "@workshop/l10n";

interface MermaidAppearance {
  trusted: boolean;
  palette: MermaidPalette;
}

export interface MermaidLinkPlace {
  side: boolean;
  tab: boolean;
}

export type MermaidLinkOpen = (
  target: string,
  place: MermaidLinkPlace,
  pass: RenderPass,
) => void;

function createMermaidStagingElement(): HTMLElement | undefined {
  if (typeof document === "undefined" || !document.body) {
    return undefined;
  }
  const stage = document.createElement("div");
  stage.className = "mermaid";
  const width =
    document.querySelector<HTMLElement>(".cm-content")?.clientWidth || 720;
  stage.style.cssText =
    `visibility:hidden;position:fixed;left:-9999px;top:0;` +
    `width:${width}px;contain:layout style paint;pointer-events:none;`;
  document.body.append(stage);
  return stage;
}

export class DiagramRenderer {
  private readonly prefix = `mw-${Array.from(crypto.getRandomValues(new Uint32Array(2)), (value) => value.toString(16)).join("-")}`;
  private sequence = 0;
  private readonly mermaidOwner = Symbol("diagram-renderer");
  private readonly cleanups = new Set<() => void>();
  private readonly trust: MermaidTrust;
  private readonly openLink: MermaidLinkOpen | undefined;
  private readonly sanitize:
    ((html: string, options?: SanitizeGraphicsOptions) => string) | undefined;
  private readonly queue: MermaidQueue;

  constructor(
    private readonly logger: Logger,
    trust: MermaidTrust = createMermaidTrust(),
    openLink?: MermaidLinkOpen,
    sanitize?: (html: string, options?: SanitizeGraphicsOptions) => string,
  ) {
    this.trust = trust;
    this.openLink = openLink;
    this.sanitize = sanitize;
    this.queue = new MermaidQueue({
      render: (source) => this.renderMermaidSvg(source),
      cacheKey: (source) => this.cacheKeyFor(source),
      prepare: (source) => this.prepareMermaid(source),
    });
  }

  render(fence: Fence, pass: RenderPass): void {
    const original = fence.element.innerHTML;
    const events = new AbortController();
    let failure: HTMLElement | undefined;
    let cancelSchedule = () => {};
    const cleanup = () => {
      cancelSchedule();
      events.abort();
      fence.element.removeAttribute?.(RENDER_PENDING_ATTRIBUTE);
      fence.element.innerHTML = original;
      failure?.remove();
      this.cleanups.delete(cleanup);
    };
    this.cleanups.add(cleanup);
    fence.element.setAttribute?.(RENDER_PENDING_ATTRIBUTE, "");
    cancelSchedule = this.queue.schedule(fence.element, fence.source, {
      onSvg: (svg) => {
        fence.element.removeAttribute(RENDER_PENDING_ATTRIBUTE);
        fence.element.innerHTML = svg;
        fence.element.setAttribute("aria-label", t("Mermaid diagram"));
        if (this.openLink) {
          wireMermaidInternalLinks(
            fence.element,
            (target, place) => this.openLink?.(target, place, pass),
            events.signal,
          );
        }
        bindDiagramInspector(fence.element, events.signal);
        pass.measure();
      },
      onError: (error) => {
        fence.element.removeAttribute(RENDER_PENDING_ATTRIBUTE);
        // Obsidian-style guarded chrome: title, error, Allow, and source.
        failure = showMermaidGuard(fence.element, error, fence.source, {
          showAllow: !this.trust.isTrusted(),
          onAllow: () => {
            this.trust.allow();
            failure?.remove();
            failure = undefined;
            this.render(fence, pass);
          },
        });
        pass.measure();
        this.logger.warn("Diagram rendering failed", error);
      },
    });
    pass.onDispose(cleanup);
  }

  dispose(): void {
    this.queue.dispose();
    for (const cleanup of this.cleanups) {
      cleanup();
    }
    this.cleanups.clear();
  }

  /** Scheduled jobs keep the palette/trust associated with their cache key. */
  private prepareMermaid(source: string) {
    const appearance = {
      trusted: this.trust.isTrusted(),
      palette: readMermaidPalette(),
    };
    return {
      key: mermaidCacheKey(source, appearance.trusted, appearance.palette),
      render: () => this.renderMermaidSvg(source, appearance),
    };
  }

  private cacheKeyFor(source: string): string {
    return mermaidCacheKey(
      source,
      this.trust.isTrusted(),
      readMermaidPalette(),
    );
  }

  private renderMermaidSvg(
    source: string,
    appearance: MermaidAppearance = {
      trusted: this.trust.isTrusted(),
      palette: readMermaidPalette(),
    },
  ): Promise<string> {
    const key = mermaidCacheKey("", appearance.trusted, appearance.palette);
    return mermaidTransaction(this.mermaidOwner, key, (initialize) =>
      this.drawMermaidSvg(source, appearance, initialize),
    );
  }

  private async drawMermaidSvg(
    source: string,
    appearance: MermaidAppearance,
    initialize: boolean,
  ): Promise<string> {
    const { default: mermaid } = await import("mermaid");
    // Trust enables HTML labels, not loose Mermaid security or unsanitized output.
    const { trusted, palette } = appearance;
    const configuration = mermaidConfiguration(palette, trusted);
    if (initialize) {
      mermaid.initialize(configuration);
    }
    const stage = createMermaidStagingElement();
    let isSankey = false;
    try {
      isSankey = mermaid.detectType(source) === "sankey";
      const id = `${this.prefix}-${++this.sequence}`;
      const limit = mermaid.mermaidAPI.getSiteConfig().maxTextSize ?? 50_000;
      // Raw length bounds cleaned length. For larger raw documents, only the
      // ordinary guarded renderer may decide whether the cleaned CSV fits.
      let result =
        isSankey && source.length > limit
          ? await mermaid.render(id, source, stage)
          : undefined;
      if (!result || result.diagramType === "sankey") {
        if (isSankey) {
          // Bars have no outline: each node takes the next category color.
          const nodeColors = await defaultSankeyNodeColors(
            mermaid,
            source,
            categoryColors(palette),
          );
          mermaid.mermaidAPI.updateSiteConfig({ sankey: { nodeColors } });
        }
        result = await mermaid.render(id, source, stage);
      }
      // Keep <foreignObject> whatever the trust: journey sections and event
      // modeling boxes draw their labels there even with htmlLabels off. DOMPurify still strips active content inside it.
      if (this.sanitize) {
        return this.sanitize(result.svg, { allowForeignObject: true });
      }
      return typeof window !== "undefined"
        ? sanitizeGraphics(result.svg, { allowForeignObject: true })
        : result.svg;
    } finally {
      stage?.remove();
      if (isSankey) {
        // Do not leak per-diagram nodes/directives into the next render.
        mermaid.initialize(configuration);
      }
    }
  }
}

/** Where a Mermaid internal-link click or key press opens the note. */
export function placeOfMermaidClick(event: {
  metaKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
}): MermaidLinkPlace {
  const mod = Boolean(event.metaKey || event.ctrlKey);
  return { side: mod && Boolean(event.altKey), tab: false };
}

/**
 * Extract the target note name for a Mermaid `.internal-link` SVG node.
 * Prefers explicit link attributes, then the rendered node label text, and
 * falls back to `data-id` or the Mermaid flowchart/state/class node ID.
 */
export function mermaidInternalLinkTarget(node: Element): string | undefined {
  return (
    trimmedAttr(node, "data-href") ??
    trimmedAttr(node, "href") ??
    mermaidNodeLabelText(node) ??
    trimmedAttr(node, "data-id") ??
    nodeIdFallback(trimmedAttr(node, "id") ?? "")
  );
}

function trimmedAttr(node: Element, name: string): string | undefined {
  return node.getAttribute(name)?.trim() || undefined;
}

function mermaidNodeLabelText(node: Element): string | undefined {
  const text =
    node.querySelector?.(".label")?.textContent ??
    node.querySelector?.("text")?.textContent ??
    node.textContent;
  return text?.trim() || undefined;
}

function nodeIdFallback(rawId: string): string | undefined {
  for (const marker of ["-flowchart-", "-state-", "-classId-"]) {
    const start = rawId.indexOf(marker);
    const dash = rawId.lastIndexOf("-");
    if (start >= 0 && dash > start + marker.length - 1) {
      return rawId.slice(start + marker.length, dash).trim() || undefined;
    }
  }
  for (const prefix of ["flowchart-", "state-", "classId-"]) {
    const dash = rawId.lastIndexOf("-");
    if (rawId.startsWith(prefix) && dash >= prefix.length) {
      return rawId.slice(prefix.length, dash).trim() || undefined;
    }
  }
  return undefined;
}

/**
 * Wire `.internal-link` nodes inside a rendered Mermaid SVG container so
 * clicking or pressing Enter/Space opens the target note via the links service.
 */
export function wireMermaidInternalLinks(
  host: ParentNode,
  open: (target: string, place: MermaidLinkPlace) => void,
  signal?: AbortSignal,
): number {
  let wired = 0;
  for (const node of host.querySelectorAll(".internal-link")) {
    if (hasInternalLinkAncestor(node, host)) {
      continue;
    }
    const target = mermaidInternalLinkTarget(node);
    if (!target) {
      continue;
    }
    bindMermaidInternalLinkNode(node, target, open, signal);
    wired++;
  }
  return wired;
}

function hasInternalLinkAncestor(node: Element, host: ParentNode): boolean {
  const ancestor = node.parentElement?.closest?.(".internal-link");
  return Boolean(ancestor && ancestor !== host && host.contains?.(ancestor));
}

function bindMermaidInternalLinkNode(
  node: Element,
  target: string,
  open: (target: string, place: MermaidLinkPlace) => void,
  signal?: AbortSignal,
): void {
  node.setAttribute("data-href", target);
  node.setAttribute("data-wiki", "true");
  node.setAttribute("role", "link");
  node.setAttribute("tabindex", "0");
  const options = signal ? { signal } : undefined;
  node.addEventListener(
    "mousedown",
    (event) => {
      if ((event as MouseEvent).button !== 0) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
    },
    options,
  );
  node.addEventListener(
    "click",
    (event) => {
      const mouse = event as MouseEvent;
      if (mouse.button !== 0) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      open(target, placeOfMermaidClick(mouse));
    },
    options,
  );
  node.addEventListener(
    "keydown",
    (event) => {
      const key = event as KeyboardEvent;
      if (key.key !== "Enter" && key.key !== " ") {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      open(target, placeOfMermaidClick(key));
    },
    options,
  );
}

export interface MermaidGuardOptions {
  /** Obsidian shows Allow until the vault is trusted. */
  showAllow?: boolean;
  onAllow?: () => void;
}

/**
 * Obsidian `mermaid-wrapper.is-guarded` chrome when a diagram cannot render
 * (REA app.css ~11494). Allow mirrors `mermaid-vault-trust` + post-processor refresh.
 */
export function showMermaidGuard(
  element: HTMLElement,
  error: unknown,
  source: string,
  options: MermaidGuardOptions = {},
): HTMLElement {
  const doc = element.ownerDocument;
  const wrap = doc.createElement("div");
  wrap.className = "mermaid-wrapper is-guarded";
  wrap.setAttribute("role", "status");

  const header = doc.createElement("div");
  header.className = "mermaid-guard-header";
  const text = doc.createElement("div");
  text.className = "mermaid-guard-text";
  const title = doc.createElement("div");
  title.className = "mermaid-guard-title";
  title.textContent = t("Mermaid could not draw this diagram");
  const description = doc.createElement("div");
  description.className = "mermaid-guard-description";
  description.textContent = errorMessage(error);
  text.append(title, description);
  header.append(text);

  if (options.showAllow && options.onAllow) {
    const actions = doc.createElement("div");
    actions.className = "mermaid-guard-actions";
    const allow = doc.createElement("button");
    allow.type = "button";
    allow.textContent = t("Allow");
    allow.setAttribute(
      "aria-label",
      t("Allow Mermaid HTML labels for this vault"),
    );
    allow.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      options.onAllow?.();
    });
    actions.append(allow);
    header.append(actions);
  }

  const sourceBox = doc.createElement("div");
  sourceBox.className = "mermaid-guard-source";
  const pre = doc.createElement("pre");
  const code = doc.createElement("code");
  code.className = "language-mermaid";
  code.textContent = source;
  pre.append(code);
  sourceBox.append(pre);

  wrap.append(header, sourceBox);
  element.replaceChildren(wrap);
  element.removeAttribute("aria-label");
  return wrap;
}

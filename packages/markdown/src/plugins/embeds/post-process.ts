import type { RenderPass, RenderService } from "../render/api";
import type { Resource, Resources } from "../resources/api";
import { mediaKind } from "../../shared/media-kinds";
import { mediaRecovery } from "./webm";
import { ImageLoadError, missingEmbedText, noteName } from "./missing";
import { ImageStandIns } from "./stand-in";
import { inspectImage } from "./image-dialog";
import { IMAGE_EMBED, mountImageEmbedActions } from "./embed-actions";
import { embeddedNote, MissingSection, RefusedEmbed } from "./note";
import { renderBaseEmbed } from "./base-embed";
import { mountPdfEmbed } from "./pdf-embed";
import { EmbedLives } from "./embed-lives";
import { vaultEmbedResource } from "./resource-cache";
import { NearViewport, waitsUntilNear } from "./near-viewport";

interface EmbedOptions {
  pass: RenderPass;
  render: RenderService;
  resources: Resources;
  open(target: string, wiki: boolean): void;
}

/** True when the resource element came from a wikilink embed (`![[...]]`). */
export function embedIsWiki(node: { dataset: { wiki?: string } }): boolean {
  return node.dataset.wiki === "true";
}

/** A render pass's embeds, as the plugin keeps them. */
export interface PassEmbeds {
  /** Load again the embeds whose file could not be loaded: it may be there now. */
  retryMissing(): void;
  /** Load again the embeds showing these files (URIs): they changed. */
  reload(sources: ReadonlySet<string>): void;
  dispose(): void;
}

/** Resolve placeholders with pass-owned cancellation and native source identity. */
export function enhanceEmbeds(options: EmbedOptions): PassEmbeds {
  const embeds = new EmbedPass(options);
  embeds.start();
  return embeds;
}

class EmbedPass implements PassEmbeds {
  private readonly lives = new EmbedLives<HTMLElement>();
  private readonly restore: (() => void)[] = [];
  /** Embeds whose file could not be loaded. */
  private readonly missing = new Set<HTMLElement>();
  /** The title an embed had before an error replaced it. */
  private readonly ownTitles = new Map<HTMLElement, string>();
  private readonly standIns = new ImageStandIns();
  /** How many times each embed was shown: only the latest lands. */
  private readonly showings = new Map<HTMLElement, number>();
  /** Notes, bases and PDFs load only when they come near the screen. */
  private readonly near = new NearViewport();
  private isActive = true;
  constructor(private readonly options: EmbedOptions) {}

  start(): void {
    const { container } = this.options.pass;
    for (const node of container.querySelectorAll<HTMLElement>(
      "[data-resource]",
    )) {
      this.rememberPlaceholder(node);
      if (waitsUntilNear(node.dataset.resource ?? "")) {
        this.near.whenNear(node, () => this.show(node));
      } else {
        this.show(node);
      }
    }
  }

  retryMissing(): void {
    // Emptied first: an embed whose file is still missing comes back, and
    // one being loaded is not loaded twice when the host reports again.
    const missing = [...this.missing];
    this.missing.clear();
    for (const node of missing) {
      this.show(node);
    }
  }

  dispose(): void {
    this.isActive = false;
    this.near.dispose();
    this.standIns.restoreAll();
    this.lives.releaseAll();
    for (const reset of this.restore) {
      reset();
    }
  }

  reload(sources: ReadonlySet<string>): void {
    for (const node of this.lives.showing(sources)) {
      // What it shows stays until the new version is there to replace it.
      this.show(node, () => this.lives.release(node));
    }
  }

  /** Resolve an embed and show what it names, or why it cannot. */
  private show(node: HTMLElement, replace = () => {}): void {
    const target = node.dataset.resource ?? "";
    // Only the latest showing of an embed lands: its file may change twice
    // before the first load answers.
    const showing = (this.showings.get(node) ?? 0) + 1;
    this.showings.set(node, showing);
    const isLatest = () => this.showings.get(node) === showing;
    const showError = (error: unknown) => this.showError(node, target, error);
    const resource = this.resolve(node, target);
    if (!resource) {
      return;
    }
    const land = (resolved: Resource) => {
      if (isLatest()) {
        replace();
        void this.apply(node, target, resolved).catch(showError);
      }
    };
    if (!isPromise(resource)) {
      land(resource);
      return;
    }
    void resource.then(land, (error: unknown) => {
      if (isLatest()) {
        replace();
        this.missing.add(node);
        showError(error);
      }
    });
  }

  private showError(node: HTMLElement, target: string, error: unknown): void {
    if (!this.isActive) {
      return;
    }
    const { pass } = this.options;
    if (!this.ownTitles.has(node)) {
      this.ownTitles.set(node, node.title);
    }
    // After showImage wraps a markdown <img>, the error surface is the
    // .image-embed host; before, the <img> itself cannot show text.
    const surface = this.standIns.surfaceFor(node);
    surface.classList.remove(IMAGE_EMBED);
    surface.classList.add("unresolved-embed");
    surface.textContent = missingEmbedText(target, {
      note: noteName(pass.documentUri),
      section: error instanceof MissingSection,
      refused: error instanceof RefusedEmbed ? error.reason : undefined,
      fetchFailed: error instanceof ImageLoadError,
    });
    surface.title = String(error);
    pass.measure();
  }

  /** An embed that said it could not be shown shows its file now. */
  private clearError(node: HTMLElement): void {
    const title = this.ownTitles.get(node);
    if (title === undefined) {
      return;
    }
    this.ownTitles.delete(node);
    if (this.standIns.restore(node)) {
      return;
    }
    node.classList.remove("unresolved-embed");
    node.title = title;
  }

  private rememberPlaceholder(node: HTMLElement): void {
    const original = node.innerHTML;
    const src = node.getAttribute("src");
    this.restore.push(() => {
      node.innerHTML = original;
      if (src === null) {
        node.removeAttribute("src");
      } else {
        node.setAttribute("src", src);
      }
    });
  }

  private resolve(
    node: HTMLElement,
    target: string,
  ): Resource | Promise<Resource> | undefined {
    const { render, resources, pass } = this.options;
    if (/^https?:/i.test(target)) {
      if (!render.trusted) {
        node.title = "Remote content is disabled in an untrusted workspace";
        return undefined;
      }
      return {
        kind: mediaKind(target) ?? "image",
        source: target,
        url: target,
      };
    }
    if (/^data:image\//i.test(target)) {
      return { kind: "image", source: target, url: target };
    }
    return vaultEmbedResource(resources, {
      target,
      documentUri: pass.documentUri,
      isWiki: embedIsWiki(node),
    });
  }

  /** The button that opens what `node` embeds (`target`). */
  private openButton(
    node: HTMLElement,
    target: string,
    label: string,
    className: "open-embed" | "attachment-open",
  ): HTMLButtonElement {
    const wiki = embedIsWiki(node);
    const button = document.createElement("button");
    button.type = "button";
    button.className = className;
    button.textContent = label;
    button.setAttribute("aria-label", `Open ${target}`);
    button.addEventListener("click", () => this.options.open(target, wiki), {
      signal: this.lives.signal(node),
    });
    return button;
  }

  private async apply(
    node: HTMLElement,
    target: string,
    resource: Resource,
  ): Promise<void> {
    if (!this.isActive) {
      return;
    }
    this.lives.setSource(node, resource.source);
    this.clearError(node);
    const wiki = embedIsWiki(node);
    if (resource.kind === "image") {
      this.showImage(node, target, resource, wiki);
    } else if (resource.kind === "audio" || resource.kind === "video") {
      this.showMedia(node, target, resource);
    } else if (resource.kind === "note" && resource.text !== undefined) {
      await this.showNote(node, target, resource);
    } else if (resource.kind === "base") {
      renderBaseEmbed(node, {
        target,
        wiki,
        resource,
        open: (href, isWiki) => this.options.open(href, isWiki),
      });
    } else if (resource.kind === "pdf") {
      mountPdfEmbed({
        node,
        target,
        url: resource.url,
        wiki,
        signal: this.lives.signal(node),
        measure: this.options.pass.measure,
        open: (openTarget, isWiki) => this.options.open(openTarget, isWiki),
      });
    } else {
      node.replaceChildren(
        this.openButton(node, target, target, "attachment-open"),
      );
    }
    if (this.isActive) {
      this.options.pass.measure();
    }
  }

  private showImage(
    node: HTMLElement,
    target: string,
    resource: Resource,
    wiki: boolean,
  ): void {
    const { pass } = this.options;
    const image =
      node instanceof HTMLImageElement ? node : document.createElement("img");
    image.src = resource.url;
    image.alt ||= target;
    image.removeAttribute?.("loading");
    image.decoding = "async";
    if (node.dataset.width) {
      image.width = Number(node.dataset.width);
    }
    if (node.dataset.height) {
      image.height = Number(node.dataset.height);
    }
    image.addEventListener("load", pass.measure, {
      signal: this.lives.signal(node),
    });
    image.addEventListener(
      "error",
      () => {
        if (!this.isActive) {
          return;
        }
        const surface =
          image.parentElement?.classList.contains(IMAGE_EMBED) === true
            ? image.parentElement
            : node;
        this.showError(surface, target, new ImageLoadError(target));
      },
      { signal: this.lives.signal(node) },
    );
    if (image !== node) {
      node.replaceChildren(image);
    }
    this.mountImageInspect(node, image, target, wiki);
  }

  private mountImageInspect(
    node: HTMLElement,
    image: HTMLImageElement,
    target: string,
    wiki: boolean,
  ): void {
    // Markdown <img data-resource> has no embed span; wrap so .image-embed
    // chrome never tags the line/paragraph (that split selection into bands).
    const host = image !== node ? node : document.createElement("span");
    if (host !== node) {
      image.replaceWith(host);
      host.append(image);
    }
    const syncCompact = () => {
      const width = image.width || image.naturalWidth;
      const height = image.height || image.naturalHeight;
      host.classList.toggle?.(
        "image-embed-compact",
        (width > 0 && width < 72) || (height > 0 && height < 72),
      );
    };
    syncCompact();
    image.addEventListener("load", syncCompact, {
      signal: this.lives.signal(node),
    });
    const inspect = document.createElement("button");
    inspect.type = "button";
    inspect.className = "inspect-image";
    inspect.textContent = "⤢";
    inspect.setAttribute("aria-label", `Inspect image: ${image.alt}`);
    const actions = mountImageEmbedActions(image, host, inspect);
    image.addEventListener(
      "dblclick",
      (event) => {
        event.preventDefault();
        event.stopPropagation();
        inspect.click();
      },
      { signal: this.lives.signal(node) },
    );
    this.lives.onRelease(node, () => {
      actions.remove();
      if (host !== node && host.parentNode) {
        host.replaceWith(image);
      }
    });
    this.lives.onRelease(
      node,
      inspectImage(inspect, image.src, image.alt, () =>
        this.options.open(target, wiki),
      ),
    );
  }

  private showMedia(
    node: HTMLElement,
    target: string,
    resource: Resource,
  ): void {
    const { pass } = this.options;
    const media = document.createElement(resource.kind as "audio" | "video");
    media.src = resource.url;
    media.controls = true;
    media.preload = "metadata";
    media.setAttribute("aria-label", target);
    this.lives.onRelease(
      node,
      mediaRecovery(media, resource.url, (message) => {
        if (this.isActive) {
          node.textContent = `${target}: ${message}`;
          pass.measure();
        }
      }),
    );
    this.lives.onRelease(node, () => {
      media.pause();
      media.removeAttribute("src");
      media.load();
    });
    media.addEventListener("loadedmetadata", pass.measure, {
      signal: this.lives.signal(node),
    });
    node.replaceChildren(media);
  }

  private async showNote(
    node: HTMLElement,
    target: string,
    resource: Resource,
  ): Promise<void> {
    const { pass, render } = this.options;
    // apply admits note resources only after checking their text.
    const text = resource.text!;
    const selection = embeddedNote(
      text,
      resource.source,
      target,
      pass.ancestry,
    );
    const section = document.createElement("section");
    section.className = "note-embed";
    const content = document.createElement("div");
    section.append(this.openButton(node, target, "↗", "open-embed"), content);
    node.replaceChildren(section);
    const shown = this.lives.signal(node);
    const nested = await render.into(content, selection.text, {
      ...(pass.readOnly === undefined ? {} : { readOnly: pass.readOnly }),
      documentUri: resource.source,
      documentText: text,
      ancestry: selection.ancestry,
      sourceLine: selection.sourceLine,
      taskLineCount: selection.text.split("\n").length,
      measure: pass.measure,
    });
    // Released meanwhile (the pass ended): nothing will dispose it later.
    if (this.isActive && !shown.aborted) {
      this.lives.onRelease(node, () => {
        void nested.dispose();
      });
    } else {
      await nested.dispose();
    }
  }
}

function isPromise(
  value: Resource | Promise<Resource>,
): value is Promise<Resource> {
  return typeof (value as { then?: unknown }).then === "function";
}

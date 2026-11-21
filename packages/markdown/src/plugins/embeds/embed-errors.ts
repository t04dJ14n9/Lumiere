import type { RenderPass } from "../render/api";
import { ImageLoadError, missingEmbedText, noteName } from "./missing";
import { IMAGE_EMBED } from "./embed-actions";
import { MissingSection, RefusedEmbed } from "./note";
import type { ImageStandIns } from "./stand-in";

/**
 * What an embed that could not be shown says, and the surface it says it on:
 * the embed itself, or the block that stands in for a Markdown `<img>`, which
 * shows no text. Remembers the title each embed had, so a file that arrives
 * later gives it back.
 */
export class EmbedErrors {
  /** The title an embed had before an error replaced it. */
  private readonly ownTitles = new Map<HTMLElement, string>();

  constructor(
    private readonly pass: RenderPass,
    private readonly standIns: ImageStandIns,
    /** False once the pass has ended: nothing is written then. */
    private readonly isActive: () => boolean,
  ) {}

  show(node: HTMLElement, target: string, error: unknown): void {
    if (!this.isActive()) {
      return;
    }
    if (!this.ownTitles.has(node)) {
      this.ownTitles.set(node, node.title);
    }
    // After showImage wraps a markdown <img>, the error surface is the
    // .image-embed host; before, the <img> itself cannot show text.
    const surface = this.standIns.surfaceFor(node);
    surface.classList.remove(IMAGE_EMBED);
    surface.classList.add("unresolved-embed");
    surface.textContent = missingEmbedText(target, {
      note: noteName(this.pass.documentUri),
      section: error instanceof MissingSection,
      refused: error instanceof RefusedEmbed ? error.reason : undefined,
      fetchFailed: error instanceof ImageLoadError,
    });
    surface.title = String(error);
    this.pass.measure();
  }

  /** An embed that said it could not be shown shows its file now. */
  clear(node: HTMLElement): void {
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
}

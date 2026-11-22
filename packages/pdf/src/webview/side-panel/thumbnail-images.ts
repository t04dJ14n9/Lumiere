import type { RenderCapability } from "@embedpdf/plugin-render/contract";
import { RecentCache } from "../../shared/recent-cache";

/** Pictures kept; a thumbnail is a few kilobytes, so a long PDF's reading range stays. */
const KEPT_PICTURES = 200;
/** Pictures drawn at once: the pages the reader is looking at come first (`wanted`). */
const AT_ONCE = 2;

interface Picture {
  url: string;
  revoke(): void;
}

/**
 * The thumbnails' pictures, drawn by the render plugin as the panel scrolls:
 * only the pages asked for (`want`) are drawn, nearest the reader first, a
 * page that scrolled away before it was drawn is cancelled, and a picture
 * once drawn is kept for a while. A change of the pages' pixels (the paper's
 * colour, a new mark) draws the pictures anew.
 */
export class ThumbnailImages {
  private readonly pictures = new RecentCache<string, Picture>(
    KEPT_PICTURES,
    (_key, picture) => picture.revoke(),
  );
  private readonly drawing = new Map<string, AbortController>();
  private wanted: { pages: readonly number[]; width: number } = {
    pages: [],
    width: 0,
  };
  /** Pictures that could not be drawn: not tried again until the pixels change. */
  private readonly failed = new Set<string>();
  private disposed = false;

  constructor(
    private readonly render: RenderCapability,
    /** Something changed: a picture arrived, or the pictures went. */
    private readonly changed: () => void,
  ) {}

  /** The picture of a page at a width, once it is drawn. */
  urlOf(page: number, width: number): string | undefined {
    return this.pictures.get(key(page, width))?.url;
  }

  /** The pages on screen (nearest the reader first) and the width to draw them at. */
  want(pages: readonly number[], width: number): void {
    this.wanted = { pages, width };
    const keys = new Set(pages.map((page) => key(page, width)));
    for (const [wantedKey, controller] of this.drawing) {
      if (!keys.has(wantedKey)) {
        controller.abort();
        this.drawing.delete(wantedKey);
      }
    }
    this.pump();
  }

  /** The pages' pixels changed: what was drawn is out of date. */
  invalidate(): void {
    for (const controller of this.drawing.values()) {
      controller.abort();
    }
    this.drawing.clear();
    this.pictures.clear();
    this.failed.clear();
    this.changed();
    this.pump();
  }

  dispose(): void {
    this.disposed = true;
    for (const controller of this.drawing.values()) {
      controller.abort();
    }
    this.drawing.clear();
    this.pictures.clear();
  }

  private pump(): void {
    const { pages, width } = this.wanted;
    for (const page of pages) {
      if (this.drawing.size >= AT_ONCE) {
        return;
      }
      const wantedKey = key(page, width);
      if (
        !this.pictures.get(wantedKey) &&
        !this.drawing.has(wantedKey) &&
        !this.failed.has(wantedKey)
      ) {
        void this.draw(page, width, wantedKey);
      }
    }
  }

  /** Never rejects: a page that cannot be drawn shows no picture. */
  private async draw(
    page: number,
    width: number,
    pictureKey: string,
  ): Promise<void> {
    const controller = new AbortController();
    this.drawing.set(pictureKey, controller);
    try {
      const image = await this.render.renderPage(page, {
        width,
        signal: controller.signal,
      });
      const picture = await image.objectUrl();
      if (controller.signal.aborted || this.disposed) {
        picture.revoke();
      } else {
        this.pictures.set(pictureKey, picture);
        this.changed();
      }
    } catch {
      if (!controller.signal.aborted) {
        this.failed.add(pictureKey);
      }
    } finally {
      if (this.drawing.get(pictureKey) === controller) {
        this.drawing.delete(pictureKey);
      }
      if (!this.disposed) {
        this.pump();
      }
    }
  }
}

function key(page: number, width: number): string {
  return `${page}@${width}`;
}

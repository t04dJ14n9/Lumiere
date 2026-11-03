import type { ImageDataLike } from "@embedpdf/models";
import type { RenderTask } from "../shared/bitmap-cache";
import { darkenPage, FORCED_PAGE_COLORS } from "../shared/dark-page";

/** The part of EmbedPDF's raw render task this needs. */
export interface RawRenderTask {
  wait(
    onReady: (image: ImageDataLike) => void,
    onError: (error: unknown) => void,
  ): void;
  abort(reason: { code: number; message: string }): void;
}

/** Render a page of the open PDF, as pixels, with these EmbedPDF options. */
export type RawRender = (options: Record<string, unknown>) => RawRenderTask;

/** Turn the finished page into the picture the viewer shows. */
export type Encode = (image: ImageDataLike) => Promise<Blob>;

type Reason = { code: number; message: string };

/**
 * A page on dark paper, as a render task for the bitmap cache. It renders the
 * page twice, as authored and with PDFium's colour scheme, and lets
 * `darkenPage` (see shared/dark-page.ts) turn the first into the dark page.
 * The engine runs the two one after the other, so a dark page costs about
 * twice a normal one.
 */
export function darkPageRender(
  render: RawRender,
  size: { scaleFactor: number; dpr: number },
  encode: Encode = encodePng,
): RenderTask {
  return new DarkPageRender(
    render(size),
    render({ ...size, pageColors: FORCED_PAGE_COLORS }),
    encode,
  );
}

class DarkPageRender implements RenderTask {
  /** The viewer gave the page up: nothing is reported after that. */
  private cancelled = false;

  constructor(
    private readonly normal: RawRenderTask,
    private readonly forced: RawRenderTask,
    private readonly encode: Encode,
  ) {}

  wait(
    onReady: (blob: unknown) => void,
    onError: (error: unknown) => void,
  ): void {
    Promise.all([settled(this.normal), settled(this.forced)])
      .then(([normal, forced]) => {
        if (this.cancelled) {
          return undefined;
        }
        darkenPage(normal.data, forced.data);
        return this.encode(normal);
      })
      .then(
        (blob) => {
          if (blob && !this.cancelled) {
            onReady(blob);
          }
        },
        (error: unknown) => {
          // One render failing leaves the other of no use: stop it too.
          this.stop({ code: 2, message: "the page's other render failed" });
          if (!this.cancelled) {
            onError(error);
          }
        },
      );
  }

  abort(reason: Reason): void {
    this.cancelled = true;
    this.stop(reason);
  }

  private stop(reason: Reason): void {
    this.normal.abort(reason);
    this.forced.abort(reason);
  }
}

function settled(task: RawRenderTask): Promise<ImageDataLike> {
  return new Promise((resolve, reject) => task.wait(resolve, reject));
}

/** The page as a PNG, as the viewer's other bitmaps are. */
export async function encodePng(image: ImageDataLike): Promise<Blob> {
  const pixels = new ImageData(image.data, image.width, image.height);
  if (typeof OffscreenCanvas !== "undefined") {
    const canvas = new OffscreenCanvas(image.width, image.height);
    canvas.getContext("2d")!.putImageData(pixels, 0, 0);
    return canvas.convertToBlob({ type: "image/png" });
  }
  const canvas = document.createElement("canvas");
  canvas.width = image.width;
  canvas.height = image.height;
  canvas.getContext("2d")!.putImageData(pixels, 0, 0);
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("PNG encode failed"))),
      "image/png",
    ),
  );
}

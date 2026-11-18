import { swapWhenDecoded } from "../shared/picture-swap";

const NATIVE_SRC = Object.getOwnPropertyDescriptor(
  HTMLImageElement.prototype,
  "src",
)!;

const held = new WeakSet<HTMLImageElement>();

/**
 * Keep the picture a page's `<img>` shows until the one replacing it is
 * decoded (shared/picture-swap.ts).
 *
 * EmbedPDF's `RenderLayer` draws a page's whole-page picture in one `<img>`
 * and, at every zoom step, sets its `src` to the new picture's blob URL. From
 * that moment until the blob has loaded, Chromium's `<img>` has no picture:
 * `complete` is false and `naturalWidth` 0, and the decode is left to the
 * next paint. A fast machine loads it within the frame; a slow one (CI's
 * runners, a busy laptop) shows a frame or more of a page that had its
 * picture without one (test/browser/page-bitmaps.spec.ts). EmbedPDF offers no
 * option for this, and Lumiere leaves `node_modules` alone, so the element's
 * own `src` is wrapped: a new picture is decoded off screen first, and then
 * given to the element, which takes it from the memory cache at once.
 *
 * Wraps each element once, for as long as it lives.
 */
export function holdPictureUntilDecoded(image: HTMLImageElement): void {
  if (held.has(image)) {
    return;
  }
  held.add(image);
  const give = swapWhenDecoded(
    {
      hasPicture: () => image.complete && image.naturalWidth > 0,
      show: (url) => NATIVE_SRC.set!.call(image, url),
    },
    decodeOffScreen,
  );
  Object.defineProperty(image, "src", {
    configurable: true,
    enumerable: true,
    get: () => NATIVE_SRC.get!.call(image) as string,
    set: give,
  });
}

/** Load and decode the picture at `url` in an element of its own; resolves to that element. */
async function decodeOffScreen(url: string): Promise<HTMLImageElement> {
  const probe = new Image();
  probe.src = url;
  await probe.decode();
  return probe;
}

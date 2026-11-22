import { swapWhenDecoded } from "../shared/picture-swap";

const NATIVE_SRC = Object.getOwnPropertyDescriptor(
  HTMLImageElement.prototype,
  "src",
)!;

const held = new WeakSet<HTMLImageElement>();

/** The URLs given to a held element that their owner has not revoked yet. */
const unrevoked = new Set<string>();
let watchingRevokes = false;

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
 * `RenderLayer` revokes a picture's URL as soon as it starts the next picture
 * (a zoom step), whether or not the page has shown it. While a pinch runs
 * faster than pictures decode, a picture can be revoked before its decode
 * ends; giving it to the element then would load a revoked URL, a broken
 * image, and take away the picture the page has (a blank page until the next
 * picture comes). So a picture that was revoked while decoding is dropped,
 * and the page keeps its picture until the next one comes.
 *
 * Wraps each element once, for as long as it lives.
 */
export function holdPictureUntilDecoded(image: HTMLImageElement): void {
  if (held.has(image)) {
    return;
  }
  held.add(image);
  watchRevokes();
  const give = swapWhenDecoded(
    {
      hasPicture: () => image.complete && image.naturalWidth > 0,
      isAvailable: (url) => unrevoked.has(url),
      show: (url) => NATIVE_SRC.set!.call(image, url),
    },
    decodeOffScreen,
  );
  Object.defineProperty(image, "src", {
    configurable: true,
    enumerable: true,
    get: () => NATIVE_SRC.get!.call(image) as string,
    set: (url: string) => {
      unrevoked.add(url);
      give(url);
    },
  });
}

/** Learn which URLs are revoked, once: the only signal EmbedPDF gives. */
function watchRevokes(): void {
  if (watchingRevokes) {
    return;
  }
  watchingRevokes = true;
  const revoke = URL.revokeObjectURL.bind(URL);
  URL.revokeObjectURL = (url) => {
    unrevoked.delete(url);
    revoke(url);
  };
}

/** Load and decode the picture at `url` in an element of its own; resolves to that element. */
async function decodeOffScreen(url: string): Promise<HTMLImageElement> {
  const probe = new Image();
  probe.src = url;
  await probe.decode();
  return probe;
}

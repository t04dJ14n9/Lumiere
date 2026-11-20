/**
 * SVG images from a host that cannot serve an SVG safely on its page's
 * origin (the iPad: Capacitor's file handler takes no sandbox header). Such
 * a host gives an SVG's URL `SVG_IMAGE_MARK` and serves its bytes there as
 * plain text, which no frame or link can run. The page fetches them and
 * shows them from a `data:` URL: an `<img>` never runs an SVG's script, and
 * a `data:` document opened some other way has an origin of its own, not
 * the page's.
 */
import { SVG_IMAGE_MARK } from "../embedding";

/** The parts of an `<img>` this needs, so a test can pass its own. */
export interface ImageElement {
  getAttribute(name: string): string | null;
  setAttribute(name: string, value: string): void;
}

/** Whether `src` is an SVG's bytes, to be shown only as an image. */
export function isSvgImageUrl(src: string | null): src is string {
  return src !== null && src.includes(SVG_IMAGE_MARK);
}

/** Where the bytes are: the URL without its mark (and what follows it). */
export function svgSourceUrl(src: string): string {
  return src.slice(0, src.indexOf(SVG_IMAGE_MARK));
}

/** An SVG's text as a `data:` URL an `<img>` shows. */
export function svgDataUrl(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return `data:image/svg+xml;base64,${btoa(binary)}`;
}

/**
 * Show one marked image from a `data:` URL. A newer `src` set while its
 * bytes were read wins; a read that fails leaves the image broken, as a
 * missing file is.
 */
export async function showSvgImage(
  image: ImageElement,
  readText: (url: string) => Promise<string>,
): Promise<void> {
  const src = image.getAttribute("src");
  if (!isSvgImageUrl(src)) {
    return;
  }
  let text: string;
  try {
    text = await readText(svgSourceUrl(src));
  } catch {
    return;
  }
  if (image.getAttribute("src") === src) {
    image.setAttribute("src", svgDataUrl(text));
  }
}

/** Show every marked image in the page, now and as the editor adds them. */
export function showSvgImagesSafely(root: Document = document): () => void {
  const readText = async (url: string) => {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`${response.status} ${url}`);
    }
    return response.text();
  };
  const visit = (node: Node) => {
    if (node.nodeName === "IMG") {
      void showSvgImage(node as HTMLImageElement, readText);
      return;
    }
    (node as Partial<ParentNode>)
      .querySelectorAll?.("img")
      .forEach((image) => void showSvgImage(image, readText));
  };
  const observer = new MutationObserver((records) => {
    for (const record of records) {
      if (record.type === "attributes") {
        visit(record.target);
      }
      record.addedNodes.forEach(visit);
    }
  });
  observer.observe(root, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ["src"],
  });
  visit(root.documentElement);
  return () => observer.disconnect();
}

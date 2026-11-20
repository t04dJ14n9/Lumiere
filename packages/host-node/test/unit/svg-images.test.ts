// S10: an SVG a host serves as text (the iPad) is shown only as an image,
// from a data: URL, never from the page's own origin.
import test from "node:test";
import assert from "node:assert/strict";
import { SVG_IMAGE_MARK } from "../../src/embedding";
import {
  isSvgImageUrl,
  showSvgImage,
  svgDataUrl,
  svgSourceUrl,
  type ImageElement,
} from "../../src/page/svg-images";

const SVG =
  '<svg xmlns="http://www.w3.org/2000/svg"><text>Ünïcode</text></svg>';
const ADDRESS = `capacitor://localhost/_lumiere/vault-svg/app/a.svg.txt${SVG_IMAGE_MARK}`;

function image(src: string): ImageElement & { src: string } {
  const element = {
    src,
    getAttribute: (name: string) => (name === "src" ? element.src : null),
    setAttribute: (name: string, value: string) => {
      if (name === "src") {
        element.src = value;
      }
    },
  };
  return element;
}

test("a marked URL is read without its mark, and the version the note adds after it", () => {
  const versioned = `${ADDRESS}?v=1700000000`;
  assert.equal(isSvgImageUrl(versioned), true);
  assert.equal(
    svgSourceUrl(versioned),
    "capacitor://localhost/_lumiere/vault-svg/app/a.svg.txt",
  );
  assert.equal(
    isSvgImageUrl("capacitor://localhost/_lumiere/vault/app/a.png"),
    false,
  );
  assert.equal(isSvgImageUrl(null), false);
});

test("an SVG's text becomes a data: URL of its UTF-8 bytes", () => {
  const url = svgDataUrl(SVG);
  assert.match(url, /^data:image\/svg\+xml;base64,/);
  const bytes = Buffer.from(url.slice(url.indexOf(",") + 1), "base64");
  assert.equal(bytes.toString("utf8"), SVG);
});

test("a marked image is shown from a data: URL; an unmarked one is left alone", async () => {
  const read: string[] = [];
  const readText = async (url: string) => {
    read.push(url);
    return SVG;
  };
  const marked = image(`${ADDRESS}?v=2`);
  await showSvgImage(marked, readText);
  assert.equal(marked.src, svgDataUrl(SVG));
  assert.deepEqual(read, [svgSourceUrl(ADDRESS)]);

  const photo = image("capacitor://localhost/_lumiere/vault/app/a.png");
  await showSvgImage(photo, readText);
  assert.equal(photo.src, "capacitor://localhost/_lumiere/vault/app/a.png");
  assert.equal(read.length, 1);
});

test("a source changed while the bytes were read wins, and a failed read leaves the image", async () => {
  const marked = image(ADDRESS);
  await showSvgImage(marked, async () => {
    marked.src = "capacitor://localhost/_lumiere/vault/app/b.png";
    return SVG;
  });
  assert.equal(marked.src, "capacitor://localhost/_lumiere/vault/app/b.png");

  const missing = image(ADDRESS);
  await showSvgImage(missing, async () => {
    throw new Error("404");
  });
  assert.equal(missing.src, ADDRESS);
});

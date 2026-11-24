import type { PageRef } from "@embedpdf/engine";
import type { RenderCapability } from "@embedpdf/plugin-render/contract";
import type { PageRect } from "../shared/geometry";
import { readRegionText, type RegionPage } from "../shared/region-reader";
import type { TextAccess } from "./text-access";

/** Render regions at twice the page's point size (144 dpi) for legible text… */
const SNAPSHOT_SCALE = 2;
/** …but no larger than this on either side, so the image stays small. */
const MAX_SNAPSHOT_SIDE = 2000;

export interface RegionDetails {
  /** The text inside the region, line by line; empty for a figure. */
  text: string;
  /** A PNG of the region as a data URL, if it could be rendered. */
  image?: string;
}

/** Where a region's text and picture come from; null until the document is ready. */
export interface RegionSource {
  text: TextAccess | null;
  render: RenderCapability | null;
}

/**
 * What an agent needs to see a dragged region: the text inside it, read
 * character by character, and a PNG snapshot of it for figures and tables.
 * A PDF that forbids copying gives neither text nor snapshot.
 */
export async function readRegionDetails(
  source: RegionSource,
  page: PageRef,
  rect: PageRect,
): Promise<RegionDetails> {
  const [text, image] = await Promise.all([
    readText(source.text, page, rect),
    readImage(source.render, page, rect),
  ]);
  return { text, ...(image ? { image } : {}) };
}

/** A page of the viewer's text plugin, as `readRegionText` reads it. */
export function regionPage(access: TextAccess, page: PageRef): RegionPage {
  return {
    layout: () => access.layoutOf(page),
    slice: (range) => access.slice(page, range),
  };
}

/** The text inside the region; empty without text access. See `readRegionText`. */
export async function readText(
  access: TextAccess | null,
  page: PageRef,
  rect: PageRect,
): Promise<string> {
  return access ? readRegionText(regionPage(access, page), rect) : "";
}

async function readImage(
  render: RenderCapability | null,
  page: PageRef,
  [left, top, right, bottom]: PageRect,
): Promise<string | undefined> {
  try {
    const image = await render?.renderPage(page, {
      rect: { x: left, y: top, width: right - left, height: bottom - top },
      scale: Math.min(
        SNAPSHOT_SCALE,
        MAX_SNAPSHOT_SIDE / Math.max(right - left, bottom - top),
      ),
      format: "png",
      includeAnnotations: true,
    });
    return image ? await dataUrl(await image.blob()) : undefined;
  } catch {
    return undefined;
  }
}

function dataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () =>
      reject(reader.error ?? new Error("Could not read the region snapshot."));
    reader.readAsDataURL(blob);
  });
}

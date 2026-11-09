import { AnnotationLayer } from "@embedpdf/react/annotation";
import { RenderLayer, usePictureState } from "@embedpdf/react/render";
import type { PageContextValue } from "@embedpdf/react/runtime";
import { SearchLayer } from "@embedpdf/react/search";
import { SelectionLayer } from "@embedpdf/react/selection";
import React, { useEffect } from "react";
import type { PageRect } from "../shared/geometry";
import type { RegionSelection } from "../shared/selection";
import type { Highlight } from "./navigation";
import { PageLinks } from "./page-links";
import { LookUpWord } from "./look-up-word";
import { BacklinkLayer } from "./backlink-layer";
import { RegionMarquee } from "./region-marquee";

export interface PageProps {
  /** The page the Stage is drawing: its index, and how its points map to pixels. */
  page: PageContextValue;
  highlight: Highlight | undefined;
  region: RegionSelection | undefined;
  /** True in Annotate mode, where the marks take the pointer for hit-test and select. */
  annotate: boolean;
  /** Paged scrolling: a page turned to fades in (styles/view-controls.css). */
  paged: boolean;
  /** Open a page, from `top` points below its top when given. */
  onOpenPage: (page: number, top?: number) => void;
}

/**
 * One page, as layers from bottom to top: the rendered picture, the hidden
 * word for macOS Look Up, search hits, clickable links, a highlighted
 * location, the selected region, annotations, the text selection, the box of
 * a region being dragged, and vault backlink overlays above the annotations.
 * `LookUpWord` stays on every page, Look Up on or off: it also tells Look Up
 * where the page is.
 *
 * The Stage draws the page's paper and shadow, and turns the whole page for
 * its own /Rotate; the layers draw on the unrotated page, in points scaled
 * by `page.transform.viewScale`. This wrapper is the page's box, which the
 * tests and the position reports find by `.page[data-page-index]`.
 */
export function Page({
  page,
  highlight,
  region,
  annotate,
  paged,
  onOpenPage,
}: PageProps): React.JSX.Element {
  const scale = page.transform.viewScale;
  return (
    <div
      className={paged ? "page paged-page" : "page"}
      data-page-index={page.pageIndex}
      data-scale={scale}
    >
      <RenderLayer />
      <FirstPictureMark />
      <LookUpWord />
      <SearchLayer />
      <PageLinks onOpenPage={onOpenPage} />
      <PageMarks
        page={page.pageIndex + 1}
        scale={scale}
        highlight={highlight}
        region={region}
      />
      <AnnotationLayer />
      <SelectionLayer />
      <RegionMarquee />
      <BacklinkLayer annotate={annotate} />
    </div>
  );
}

/**
 * Marks `pdf:first-page` (test/vscode/perf.spec.ts) when the first picture is
 * on screen, once however many pages come after it.
 */
function FirstPictureMark(): null {
  const { status } = usePictureState();
  useEffect(() => {
    if (
      status === "ready" &&
      performance.getEntriesByName("pdf:first-page").length === 0
    ) {
      performance.mark("pdf:first-page");
    }
  }, [status]);
  return null;
}

/** A page's marks: a location's flashed box, and the selected region. */
function PageMarks({
  page,
  scale,
  highlight,
  region,
}: {
  page: number;
  scale: number;
  highlight: PageProps["highlight"];
  region: PageProps["region"];
}): React.JSX.Element {
  return (
    <>
      {highlight?.page === page && (
        <Box
          key={highlight.key}
          className="location-highlight"
          rect={highlight.rect}
          scale={scale}
        />
      )}
      {region?.page === page && (
        <Box className="region-selection" rect={region.rect} scale={scale} />
      )}
    </>
  );
}

function Box({
  rect,
  scale,
  className,
}: {
  rect: PageRect;
  scale: number;
  className: string;
}): React.JSX.Element {
  const [left, top, right, bottom] = rect;
  return (
    <div
      className={className}
      style={{
        left: left * scale,
        top: top * scale,
        width: (right - left) * scale,
        height: (bottom - top) * scale,
      }}
    />
  );
}

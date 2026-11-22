import { useRender } from "@embedpdf/react/render";
import { useDocuments } from "@embedpdf/react/runtime";
import React, { useEffect, useMemo, useReducer, useState } from "react";
import type { ItemRange } from "../../shared/list-window";
import {
  drawOrder,
  pageShape,
  thumbnailCellWidth,
  thumbnailLayout,
  thumbnailPixelWidth,
} from "../../shared/thumbnails";
import { SectionHeader } from "./section-header";
import type { SidePanelJump } from "./side-panel";
import { ThumbnailImages } from "./thumbnail-images";
import { Tree, type TreeNode } from "./tree";

interface PageRow extends TreeNode {
  /** 1-based. */
  page: number;
  imageHeight: number;
}

/**
 * The pages as small pictures, drawn by the render plugin as they scroll
 * into view (`ThumbnailImages`): a thousand-page PDF costs no more than a
 * ten-page one. The page being read is selected; a click goes to a page.
 */
export function ThumbnailsTab({
  currentPage,
  panelWidth,
  jumpTo,
}: {
  currentPage: number;
  panelWidth: number;
  jumpTo: SidePanelJump;
}): React.JSX.Element {
  const documents = useDocuments();
  const pages = documents.listPages();
  const cellWidth = thumbnailCellWidth(panelWidth);
  const layout = useMemo(
    () =>
      thumbnailLayout(
        pages.map((page) => pageShape(page.size, page.rotation)),
        cellWidth,
      ),
    [pages, cellWidth],
  );
  const rows = useMemo(
    () =>
      pages.map((_, index): PageRow => ({
        id: String(index + 1),
        page: index + 1,
        imageHeight: layout.imageHeights[index] ?? cellWidth,
        depth: 0,
        expandable: false,
        expanded: false,
        position: index + 1,
        siblings: pages.length,
        ariaLabel: `Page ${index + 1}`,
      })),
    [pages, layout, cellWidth],
  );
  const { urlOf, onRange } = useThumbnailPictures(
    thumbnailPixelWidth(cellWidth, window.devicePixelRatio),
  );
  const reveal = useMemo(() => ({ id: String(currentPage) }), [currentPage]);
  return (
    <>
      <SectionHeader title="Thumbnails" count={pages.length} />
      <Tree
        kind="list"
        label="Thumbnails"
        className="sp-thumbnails"
        rows={rows}
        offsets={layout.offsets}
        selectedId={String(currentPage)}
        reveal={reveal}
        onRange={onRange}
        onOpen={(row) => jumpTo({ page: row.page })}
        renderRow={(row) => (
          <Thumbnail row={row} width={cellWidth} url={urlOf(row.page)} />
        )}
      />
    </>
  );
}

function Thumbnail({
  row,
  width,
  url,
}: {
  row: PageRow;
  width: number;
  url: string | undefined;
}): React.JSX.Element {
  return (
    <>
      <span
        className="sp-thumbnail"
        style={{ width, height: row.imageHeight }}
        aria-hidden="true"
      >
        {url && <img src={url} alt="" draggable={false} />}
      </span>
      <span className="sp-thumbnail-label">{row.page}</span>
    </>
  );
}

/**
 * The pictures of the pages in view, drawn at `pixelWidth`: the url of a
 * page's picture once it is drawn, and what to tell the list as it scrolls.
 * The pictures are drawn anew when the pages' pixels change (page colours,
 * a new mark).
 */
function useThumbnailPictures(pixelWidth: number) {
  const render = useRender();
  const [, redraw] = useReducer((count: number) => count + 1, 0);
  const images = useMemo(() => new ThumbnailImages(render, redraw), [render]);
  useEffect(() => () => images.dispose(), [images]);
  useEffect(
    () => render.onInvalidated(() => images.invalidate()),
    [render, images],
  );
  const [shown, setShown] = useState<ItemRange>({ first: 0, end: 0 });
  useEffect(() => {
    images.want(drawOrder(shown), pixelWidth);
  }, [images, shown, pixelWidth]);
  return {
    /** `page` counts from 1. */
    urlOf: (page: number) => images.urlOf(page - 1, pixelWidth),
    onRange: setShown,
  };
}

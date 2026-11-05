import { useRegistry } from "@embedpdf/core/react";
import { PdfAnnotationSubtype, type PdfDocumentObject } from "@embedpdf/models";
import React, { useEffect, useState } from "react";
import {
  clusterPageLinks,
  type PageLinkCluster,
} from "../shared/page-link-clusters";
import { postToHost } from "./host";
import { targetPage, targetTop, targetUrl } from "./pdf-targets";

/** Clickable links on a page: contents entries, citations, figure references, URLs. */
export function PageLinks({
  pdf,
  pageIndex,
  scale,
  onOpenPage,
}: {
  pdf: PdfDocumentObject;
  pageIndex: number;
  scale: number;
  onOpenPage: (page: number, top?: number) => void;
}): React.JSX.Element {
  const links = usePageLinks(pdf, pageIndex);
  return (
    <div
      className="page-links"
      onDragStart={(event) => {
        // Anchors are draggable by default; large LINK rects otherwise ghost
        // a semi-transparent chunk of the page while panning.
        event.preventDefault();
      }}
    >
      {links.map((link) => (
        <PageLinkGroup
          key={link.id}
          link={link}
          scale={scale}
          onOpenPage={onOpenPage}
        />
      ))}
    </div>
  );
}

function PageLinkGroup({
  link,
  scale,
  onOpenPage,
}: {
  link: PageLinkCluster;
  scale: number;
  onOpenPage: (page: number, top?: number) => void;
}): React.JSX.Element {
  const href = link.url ?? `#page=${link.page}`;
  const title = link.url ?? `Page ${link.page}`;
  const label = link.url ? `Open ${link.url}` : `Go to page ${link.page}`;
  const open = (event: React.MouseEvent): void => {
    event.preventDefault();
    if (link.page) {
      onOpenPage(link.page, link.top);
    } else if (link.url) {
      postToHost({ type: "openExternal", url: link.url });
    }
  };
  return (
    <span className="page-link-group">
      {link.segments.map((segment, index) => (
        <a
          key={`${link.id}:${index}`}
          className="page-link"
          href={href}
          title={index === 0 ? title : undefined}
          aria-label={index === 0 ? label : undefined}
          aria-hidden={index === 0 ? undefined : true}
          tabIndex={index === 0 ? 0 : -1}
          draggable={false}
          style={{
            left: segment.origin.x * scale,
            top: segment.origin.y * scale,
            width: segment.size.width * scale,
            height: segment.size.height * scale,
          }}
          onClick={open}
        />
      ))}
    </span>
  );
}

function usePageLinks(
  pdf: PdfDocumentObject,
  pageIndex: number,
): PageLinkCluster[] {
  const { registry } = useRegistry();
  const [links, setLinks] = useState<PageLinkCluster[]>([]);
  useEffect(() => {
    const page = pdf.pages[pageIndex];
    if (!registry || !page) {
      return;
    }
    const task = registry.getEngine().getPageAnnotations(pdf, page);
    task.wait(
      (annotations) => {
        const fragments = annotations.flatMap((annotation) => {
          if (annotation.type !== PdfAnnotationSubtype.LINK) {
            return [];
          }
          const target = {
            page: targetPage(annotation.target),
            top: targetTop(annotation.target, pdf),
            url: targetUrl(annotation.target),
          };
          return target.page || target.url
            ? [{ id: annotation.id, rect: annotation.rect, ...target }]
            : [];
        });
        setLinks(clusterPageLinks(fragments));
      },
      () => setLinks([]),
    );
    return () => task.abort({ code: 1, message: "The page closed" });
  }, [pdf, pageIndex, registry]);
  return links;
}

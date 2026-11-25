import { InteractionToken } from "@embedpdf/plugin-interaction/contract/host";
import { LinkToken } from "@embedpdf/plugin-link/contract";
import { LinkToken as LinkHostToken } from "@embedpdf/plugin-link/contract/host";
import {
  shallowArray,
  useDocuments,
  useOptionalCapability,
  useOptionalSelector,
  usePage,
  type PageRef,
} from "@embedpdf/react/runtime";
import React, { useEffect, useMemo, useRef } from "react";
import {
  clusterPageLinks,
  type PageLinkCluster,
} from "../shared/page-link-clusters";
import { targetPage, targetTop, targetUrl } from "../shared/pdf-link-target";
import { postToHost } from "./host";
import { t } from "@workshop/l10n";

const NO_LINKS: readonly never[] = Object.freeze([]);

/** Clickable links on a page: contents entries, citations, figure references, URLs. */
export function PageLinks({
  onOpenPage,
}: {
  onOpenPage: (page: number, top?: number) => void;
}): React.JSX.Element | null {
  const page = usePage();
  const links = usePageLinks(page.ref);
  const scale = page.transform.viewScale;
  // Only under tools that follow links (reading, and the Select Region
  // tool): the Annotate tools own their pointer, as the layer over them did.
  const engaged = useOptionalSelector(
    LinkHostToken,
    (link) => link.isNavigationEngaged(),
    false,
  );
  if (!engaged || links.length === 0) {
    return null;
  }
  return (
    <div
      className="page-links"
      onDragStart={(event) => {
        // Anchors are draggable by default; large link rects otherwise ghost
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
  const title = link.url ?? t("Page {0}", String(link.page));
  const label = link.url
    ? t("Open {0}", link.url)
    : t("Go to page {0}", String(link.page));
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
        <LinkAnchor
          key={`${link.id}:${index}`}
          className="page-link"
          href={href}
          title={index === 0 ? title : undefined}
          aria-label={index === 0 ? label : undefined}
          aria-hidden={index === 0 ? undefined : true}
          tabIndex={index === 0 ? 0 : -1}
          draggable={false}
          style={{
            left: segment.x * scale,
            top: segment.y * scale,
            width: segment.width * scale,
            height: segment.height * scale,
          }}
          onClick={open}
        />
      ))}
    </span>
  );
}

/**
 * A link's anchor. The Stage listens for presses natively on an ancestor of
 * the pages, where a press would start the tool's gesture (a text selection,
 * a region), so a press on the anchor stops with a native listener of its
 * own: React dispatches from its root, after the Stage has seen it.
 */
function LinkAnchor(
  props: React.AnchorHTMLAttributes<HTMLAnchorElement>,
): React.JSX.Element {
  const anchor = useRef<HTMLAnchorElement>(null);
  useEffect(() => {
    const element = anchor.current;
    const stop = (event: PointerEvent): void => event.stopPropagation();
    element?.addEventListener("pointerdown", stop);
    return () => element?.removeEventListener("pointerdown", stop);
  }, []);
  return <a ref={anchor} {...props} />;
}

/**
 * The page's links, with adjacent fragments of one cite merged. A link with
 * no target Lumiere can follow (another file, a script) is left out.
 */
function usePageLinks(page: PageRef): PageLinkCluster[] {
  const link = useOptionalCapability(LinkToken);
  const documents = useDocuments();
  // While annotations can be edited, a link riding one is that annotation's.
  const isEditing = useOptionalSelector(
    InteractionToken,
    (interaction) => interaction.activeToolEnables("annotation-edit"),
    false,
  );
  const items = useOptionalSelector(
    LinkToken,
    (links) => links.listLinks(page),
    NO_LINKS,
    shallowArray,
  );
  useEffect(() => {
    // Links load on demand, and fail alone: a page whose links cannot be read has none.
    link?.ensureLoaded(page).catch(() => undefined);
  }, [link, page]);
  return useMemo(() => {
    const pageNumberOf = (ref: PageRef): number | undefined => {
      const index = documents.getPageIndex(ref);
      return index < 0 ? undefined : index + 1;
    };
    const fragments = items.flatMap((item) => {
      if (isEditing && item.attached) {
        return [];
      }
      const target = {
        page: targetPage(item.target, pageNumberOf),
        top: targetTop(item.target),
        url: targetUrl(item.target),
      };
      return target.page || target.url
        ? [{ id: item.id, rect: item.bounds, ...target }]
        : [];
    });
    return clusterPageLinks(fragments);
  }, [items, isEditing, documents]);
}

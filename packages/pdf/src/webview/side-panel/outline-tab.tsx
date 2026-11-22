import React, { useCallback, useMemo, useState } from "react";
import type { OutlineItem } from "../../shared/messages";
import {
  branchIds,
  outlineRows,
  type OutlineRow,
  type OutlineRowId,
} from "../../shared/outline-tree";
import { ActionButton, EmptyMessage, SectionHeader } from "./section-header";
import { Tree } from "./tree";
import { useFollowedOutline } from "./use-followed-outline";
import type { SidePanelJump } from "./side-panel";

/**
 * The PDF's own outline as a tree. A click goes to the bookmark's page and
 * place; the twisty and the arrow keys open and close branches. With Follow
 * Cursor (the Explorer's setting) the bookmark of the reading position is
 * kept selected, with its parents and its own sub-bookmarks open and the
 * other branches closed.
 */
export function OutlineTab({
  items,
  jumpTo,
}: {
  /** `undefined` while the PDF's outline is being read. */
  items: readonly OutlineItem[] | undefined;
  jumpTo: SidePanelJump;
}): React.JSX.Element {
  const tree = useOutlineTree(items, jumpTo);
  return (
    <>
      <SectionHeader title="Outline">
        <ActionButton
          icon="expand-all"
          label="Expand All"
          onClick={tree.expandAll}
        />
        <ActionButton
          icon="collapse-all"
          label="Collapse All"
          onClick={tree.collapseAll}
        />
      </SectionHeader>
      {items === undefined || items.length === 0 ? (
        <EmptyMessage>
          {items === undefined
            ? "Reading the outline…"
            : "This PDF has no outline."}
        </EmptyMessage>
      ) : (
        <Tree
          kind="tree"
          label="Outline"
          rows={tree.rows}
          selectedId={tree.selectedId}
          reveal={tree.reveal}
          onOpen={tree.open}
          onToggle={tree.toggle}
          renderRow={(row) => <OutlineLabel item={row.item} />}
        />
      )}
    </>
  );
}

/** The rows that show, which branches are open, and what a click does. */
function useOutlineTree(
  items: readonly OutlineItem[] | undefined,
  jumpTo: SidePanelJump,
) {
  const [expanded, setExpanded] = useState<ReadonlySet<OutlineRowId>>(
    () => new Set(),
  );
  const {
    click: clickRow,
    id: selectedId,
    reveal,
  } = useFollowedOutline({ items, onFollow: setExpanded });
  const rows = useMemo(
    () => outlineRows(items ?? [], expanded),
    [items, expanded],
  );
  const toggle = useCallback((id: OutlineRowId, open: boolean) => {
    setExpanded((now) => {
      const next = new Set(now);
      if (open) {
        next.add(id);
      } else {
        next.delete(id);
      }
      return next;
    });
  }, []);
  const open = useCallback(
    (row: OutlineRow) => {
      clickRow(row.id);
      if (row.item.page !== undefined) {
        jumpTo({ page: row.item.page }, row.item.top);
        // As a click on a folder in VS Code's trees opens it.
        if (row.expandable && !row.expanded) {
          toggle(row.id, true);
        }
      } else if (row.expandable) {
        toggle(row.id, !row.expanded);
      }
    },
    [jumpTo, toggle, clickRow],
  );
  return {
    rows,
    open,
    toggle,
    reveal,
    selectedId,
    expandAll: () => setExpanded(branchIds(items ?? [])),
    collapseAll: () => setExpanded(new Set()),
  };
}

function OutlineLabel({ item }: { item: OutlineItem }): React.JSX.Element {
  return (
    <>
      <span className="sp-label" title={item.title}>
        {item.title}
      </span>
      {item.page !== undefined && (
        <span className="sp-page">p. {item.page}</span>
      )}
    </>
  );
}

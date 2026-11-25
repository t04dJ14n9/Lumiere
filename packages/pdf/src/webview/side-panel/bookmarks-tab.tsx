import React, { useCallback, useMemo, useState } from "react";
import type { Bookmark } from "../../shared/bookmarks";
import { postToHost } from "../host";
import { useBookmarks } from "./bookmarks-state";
import { ActionButton, EmptyMessage, SectionHeader } from "./section-header";
import type { SidePanelJump } from "./side-panel";
import { Tree, type TreeNode } from "./tree";
import { t } from "@workshop/l10n";

interface BookmarkRow extends TreeNode {
  bookmark: Bookmark;
}

/**
 * The reader's own bookmarks of the PDF, in page order. The extension keeps
 * them (the same file the Explorer's PDF Bookmarks view and the Go to
 * Bookmark Quick Pick show): this lists what it sends and asks it to add,
 * rename or delete, which it does with the same input boxes.
 */
export function BookmarksTab({
  jumpTo,
}: {
  jumpTo: SidePanelJump;
}): React.JSX.Element {
  const { items, problem } = useBookmarks();
  const [selected, setSelected] = useState<string>();
  const rows = useMemo(
    () => items.map((bookmark): BookmarkRow => bookmarkRow(bookmark)),
    [items],
  );
  const open = useCallback(
    (row: BookmarkRow) => {
      setSelected(row.id);
      jumpTo(
        { page: row.bookmark.page },
        row.bookmark.position.top,
        row.bookmark.position.left,
      );
    },
    [jumpTo],
  );
  return (
    <>
      <SectionHeader title={t("Bookmarks")} count={items.length}>
        <ActionButton
          icon="add"
          label={t("Add Bookmark")}
          onClick={addBookmark}
        />
      </SectionHeader>
      {rows.length === 0 ? (
        <EmptyBookmarks problem={problem} />
      ) : (
        <Tree
          kind="list"
          label={t("Bookmarks")}
          rows={rows}
          selectedId={selected}
          onOpen={open}
          onKey={bookmarkKey}
          renderRow={(row) => <BookmarkLabel bookmark={row.bookmark} />}
        />
      )}
    </>
  );
}

function bookmarkRow(bookmark: Bookmark): BookmarkRow {
  return {
    id: bookmark.id,
    bookmark,
    depth: 0,
    expandable: false,
    expanded: false,
  };
}

function addBookmark(): void {
  postToHost({ type: "bookmarkAction", action: "add" });
}

/** F2 renames and Delete deletes the focused bookmark, as in VS Code's lists. */
function bookmarkKey(
  event: React.KeyboardEvent,
  row: BookmarkRow | undefined,
): boolean {
  if (!row || event.shiftKey) {
    return false;
  }
  if (event.key === "F2") {
    postToHost({ type: "bookmarkAction", action: "rename", id: row.id });
    return true;
  }
  if (event.key === "Delete" || event.key === "Backspace") {
    postToHost({ type: "bookmarkAction", action: "delete", id: row.id });
    return true;
  }
  return false;
}

function BookmarkLabel({
  bookmark,
}: {
  bookmark: Bookmark;
}): React.JSX.Element {
  return (
    <>
      <i className="sp-icon codicon codicon-bookmark" aria-hidden="true" />
      <span className="sp-label" title={bookmark.title}>
        {bookmark.title}
      </span>
      <span className="sp-page">p. {bookmark.page}</span>
      <span className="sp-row-actions">
        <RowAction
          icon="edit"
          label={t("Rename Bookmark")}
          act={{ action: "rename", id: bookmark.id }}
        />
        <RowAction
          icon="trash"
          label={t("Delete Bookmark")}
          act={{ action: "delete", id: bookmark.id }}
        />
      </span>
    </>
  );
}

/** A button on a row, shown while the pointer is on it. */
function RowAction({
  icon,
  label,
  act,
}: {
  icon: string;
  label: string;
  act: { action: "rename" | "delete"; id: string };
}): React.JSX.Element {
  return (
    <button
      type="button"
      className="sp-action"
      title={label}
      aria-label={label}
      tabIndex={-1}
      onClick={(event) => {
        event.stopPropagation();
        postToHost({ type: "bookmarkAction", ...act });
      }}
    >
      <i className={`codicon codicon-${icon}`} aria-hidden="true" />
    </button>
  );
}

function EmptyBookmarks({
  problem,
}: {
  problem: string | undefined;
}): React.JSX.Element {
  if (problem) {
    return <EmptyMessage>{problem}</EmptyMessage>;
  }
  return (
    <EmptyMessage>
      <p>{t("You have not added any bookmarks to this PDF.")}</p>
      <button type="button" className="sp-button" onClick={addBookmark}>
        Add Bookmark
      </button>
    </EmptyMessage>
  );
}

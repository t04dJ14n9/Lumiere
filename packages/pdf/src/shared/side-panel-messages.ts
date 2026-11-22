/**
 * What the side panel says to the extension and hears back
 * (see `messages.ts` for the rest of the conversation).
 *
 *   viewer → host   sidePanel { state }       the reader opened, closed, resized
 *                                             or switched the panel
 *                   bookmarkAction { … }      Add Bookmark, or rename or delete
 *                                             one of the panel's rows: the
 *                                             extension asks for the title and
 *                                             writes the file, as the commands do
 *   host → viewer   sidePanel { state }       a command opened or closed it
 *                   bookmarks { items }       the PDF's bookmarks, as the
 *                                             extension reads them
 *
 * The state also arrives with `load`, so a viewer opens as it was left.
 */
import { parseBookmark, type Bookmark } from "./bookmarks";
import { parseSidePanelState, type SidePanelState } from "./side-panel";

export type BookmarkAction =
  { action: "add" } | { action: "rename" | "delete"; id: string };

export type SidePanelViewerMessage =
  | { type: "sidePanel"; state: SidePanelState }
  | ({ type: "bookmarkAction" } & BookmarkAction);

export type SidePanelHostMessage =
  | { type: "sidePanel"; state: SidePanelState }
  | {
      type: "bookmarks";
      items: Bookmark[];
      /** Why the file could not be read, when it could not. */
      problem?: string;
    };

type Fields = Record<string, unknown>;

/** More than this is no list of a reader's bookmarks. */
export const MAX_PANEL_BOOKMARKS = 5000;
const MAX_ID_LENGTH = 200;
const MAX_PROBLEM_LENGTH = 500;

/** The viewer's side panel messages, each checked field by field. */
export const SIDE_PANEL_VIEWER_PARSERS: Readonly<
  Record<string, (message: Fields) => SidePanelViewerMessage | undefined>
> = {
  sidePanel: (message) => {
    const state = parseSidePanelState(message.state);
    return state ? { type: "sidePanel", state } : undefined;
  },
  bookmarkAction: parseBookmarkAction,
};

function parseBookmarkAction(
  message: Fields,
): SidePanelViewerMessage | undefined {
  const { action, id } = message;
  if (action === "add") {
    return { type: "bookmarkAction", action };
  }
  if (
    (action === "rename" || action === "delete") &&
    typeof id === "string" &&
    id !== "" &&
    id.length <= MAX_ID_LENGTH
  ) {
    return { type: "bookmarkAction", action, id };
  }
  return undefined;
}

/** The bookmarks of a `bookmarks` message: the entries that are bookmarks, and no more than a list holds. */
export function parseBookmarkList(value: unknown): Bookmark[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const seen = new Set<string>();
  const kept: Bookmark[] = [];
  for (const entry of value.slice(0, MAX_PANEL_BOOKMARKS) as unknown[]) {
    const bookmark = parseBookmark(entry);
    if (bookmark && !seen.has(bookmark.id)) {
      seen.add(bookmark.id);
      kept.push(bookmark);
    }
  }
  return kept;
}

/** The problem a `bookmarks` message carries, cut to a sane length. */
export function parseBookmarksProblem(value: unknown): string | undefined {
  return typeof value === "string" && value !== ""
    ? value.slice(0, MAX_PROBLEM_LENGTH)
    : undefined;
}

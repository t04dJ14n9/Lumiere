import { createHash } from "node:crypto";
import type { PdfBookmarkFiles } from "../../../src/shared/host";
import type { Bookmark } from "../../../src/shared/bookmarks";
import type { OutlineItem } from "../../../src/shared/messages";
import type { ReadingPosition } from "../../../src/shared/reading-position";

export const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

export const sha = (seed: string) =>
  createHash("sha256").update(seed).digest("hex");

export const mark = (
  id: string,
  page: number,
  top = 0,
  title = `Mark ${id}`,
): Bookmark => ({
  id,
  title,
  page,
  position: { top, left: 0 },
  created: "2026-11-22T08:00:00.000Z",
});

/** One disk of bookmark files, keyed by the PDF's hash; every write is heard by every watcher. */
export function bookmarkDisk() {
  const files = new Map<string, string>();
  const watchers = new Set<{ sha256: string; onChange: () => void }>();
  const keyOf = (sha256: string) => `/vault/.lumiere/${sha256}.bookmarks.json`;
  const api: PdfBookmarkFiles = {
    read: async (_uri, sha256) => files.get(keyOf(sha256)),
    write: async (_uri, sha256, text) => {
      if (text === undefined) {
        files.delete(keyOf(sha256));
      } else {
        files.set(keyOf(sha256), text);
      }
      for (const watcher of [...watchers]) {
        if (watcher.sha256 === sha256) {
          watcher.onChange();
        }
      }
    },
    key: (_uri, sha256) => keyOf(sha256),
    watch: (_uri, sha256, onChange) => {
      const watcher = { sha256, onChange };
      watchers.add(watcher);
      return () => watchers.delete(watcher);
    },
  };
  return {
    api,
    files,
    watchers,
    keyOf,
    /** What the file for this hash holds, as the bookmarks in it. */
    saved: (sha256: string): Bookmark[] =>
      (
        JSON.parse(files.get(keyOf(sha256)) ?? '{"bookmarks":[]}') as {
          bookmarks: Bookmark[];
        }
      ).bookmarks,
  };
}

export interface FakePanelOptions {
  uri?: string;
  sha256?: string | undefined;
  outline?: OutlineItem[] | undefined;
  /** Where the viewer says it is; `undefined` while it is still opening. */
  position?: Pick<ReadingPosition, "page" | "top" | "left"> | undefined;
  /** The page report that `capturePosition` falls back on. */
  viewOnly?: boolean;
}

/** A PDF editor, as the bookmark commands and view use it. */
export function fakePanel(options: FakePanelOptions = {}) {
  const jumps: Array<{
    page: number;
    top: number | undefined;
    left: number | undefined;
  }> = [];
  const place = options.position;
  const full = (position: NonNullable<typeof place>) => ({
    ...position,
    zoom: "fit-width",
    pageLayout: "single",
    scrollMode: "continuous",
    scrollDirection: "vertical",
  });
  return {
    fileUri: options.uri ?? "file:///vault/papers/a.pdf",
    sha256: "sha256" in options ? options.sha256 : sha("a"),
    outline: options.outline,
    view:
      place && options.viewOnly
        ? { ...full(place), readingPage: place.page }
        : undefined,
    capturePosition: async () =>
      place && !options.viewOnly
        ? { position: full(place), intent: 1 }
        : undefined,
    goTo: (location: { page: number }, top?: number, left?: number): number => {
      jumps.push({ page: location.page, top, left });
      return 1;
    },
    jumps,
  };
}

export type FakePanel = ReturnType<typeof fakePanel>;

/** The editors the commands act on: one of them is the active one. */
export function fakePanels(active?: FakePanel) {
  const listeners = new Set<() => void>();
  const panels = {
    active,
    onDidChange: (listener: () => void) => {
      listeners.add(listener);
      return { dispose: () => listeners.delete(listener) };
    },
    /** The reader moves to another editor (or none). */
    activate(next: FakePanel | undefined) {
      panels.active = next;
      for (const listener of [...listeners]) {
        listener();
      }
    },
    /** The active editor reports a new view. */
    changed() {
      for (const listener of [...listeners]) {
        listener();
      }
    },
    listeners,
  };
  return panels;
}

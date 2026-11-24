import { Schema, type Infer } from "@workshop/core";
import { defineProtocol } from "../../shared/rpc/protocol";
export const matchLine = Schema.object({
  text: Schema.string().max(512),
  offset: Schema.number().min(0),
  mark: Schema.object({
    from: Schema.number().min(0),
    to: Schema.number().min(0),
  }).optional(),
});
export const result = Schema.object({
  path: Schema.string().max(8192),
  href: Schema.string().max(32768),
  /** Content lines under the file (Obsidian search-result-file-match). */
  matches: Schema.array(matchLine).max(100).optional(),
});
export const response = Schema.object({
  results: Schema.array(result).max(100000),
  unreadable: Schema.number().min(0),
  /** Notes whose evaluation ran past its deadline, so the search went on without them. */
  skipped: Schema.array(Schema.string().max(8192)).max(100000).optional(),
  /** The search stopped at the result limit, so the notes after its last match were not searched. */
  truncated: Schema.boolean().optional(),
  /** The search stopped at the skip limit, so the notes after its last skip were not searched. */
  tooSlow: Schema.boolean().optional(),
});
export type SearchResponse = Infer<typeof response>;
export const openTarget = Schema.object({
  path: Schema.string().max(8192),
  offset: Schema.number().min(0).optional(),
  /** Open beside (Cmd/Ctrl+Alt-click), as Obsidian does for search matches. */
  side: Schema.boolean().optional(),
});
export const protocol = defineProtocol("search", {
  requests: {
    query: {
      params: Schema.object({
        query: Schema.string().max(4096),
        source: Schema.string().max(32768),
        /** Correlates partial notifications with this request; omit to skip streaming. */
        id: Schema.string().min(1).max(64).optional(),
      }),
      result: response,
    },
    /** Open a result path at an optional content offset (match-line click). */
    open: { params: openTarget, result: Schema.boolean() },
  },
  notifications: {
    changed: Schema.object({}),
    /** Matches an in-flight `query` found since its last partial (Obsidian streams results). */
    partial: Schema.object({
      id: Schema.string().min(1).max(64),
      results: Schema.array(result).max(100000),
      unreadable: Schema.number().min(0),
    }),
  },
});

import { Schema, type Infer } from "@workshop/core";
import { defineProtocol } from "../../shared/rpc/protocol";
export const query = Schema.object({
  kind: Schema.union(["link", "heading", "block", "tag"]),
  query: Schema.string().max(4096),
  note: Schema.string().max(4096).optional(),
  /** `^` typed without `#` (`[[Note^`): the link gets its `#`. */
  bare: Schema.boolean().optional(),
});
/**
 * The id a picked block without one gets, as in Obsidian: `insert` at `at`
 * in the note at `uri`, if the text just before is still `before`.
 */
export const blockId = Schema.object({
  uri: Schema.string().max(8192),
  at: Schema.number().min(0),
  before: Schema.string().min(1).max(64),
  // A generated id only: space or a blank line, then six hex digits.
  insert: Schema.string().pattern(/^(?: |\n\n)\^[0-9a-f]{6}$/u),
  /** The block is in the note being edited. */
  here: Schema.boolean(),
});
export const suggestion = Schema.object({
  replaceLink: Schema.boolean().optional(),
  label: Schema.string().max(8192),
  insert: Schema.string().max(8192),
  detail: Schema.string().max(8192),
  blockId: blockId.optional(),
});
export type Query = Infer<typeof query>;
export type Suggestion = Infer<typeof suggestion>;
export const protocol = defineProtocol("suggest", {
  requests: {
    query: { params: query, result: Schema.array(suggestion).max(50) },
    addBlockId: { params: blockId, result: Schema.boolean() },
  },
  notifications: {},
});

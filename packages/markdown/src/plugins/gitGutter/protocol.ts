import { Schema } from "@workshop/core";
import { defineProtocol } from "../../shared/rpc/protocol";
import { MAX_DIFF_CHARS } from "../../shared/diff";
const baselineResult = Schema.object({
  /** `unchanged`: the baseline is still the one `known` names; no text. */
  status: Schema.union([
    "ok",
    "unchanged",
    "untracked",
    "unavailable",
    "tooLarge",
  ]),
  text: Schema.string().max(MAX_DIFF_CHARS).optional(),
  label: Schema.string().max(200).optional(),
  /** Names this baseline, for the next request's `known`. */
  identity: Schema.string().max(64).optional(),
});
export const protocol = defineProtocol("gitGutter", {
  requests: {
    baseline: {
      params: Schema.object({
        ref: Schema.union(["HEAD", "index"]),
        /** The identity of the baseline the editor already has. */
        known: Schema.string().max(64).optional(),
      }),
      result: baselineResult,
    },
    stage: { params: Schema.object({}), result: Schema.boolean() },
    openFullDiff: {
      params: Schema.object({
        baseKind: Schema.union([
          "HEAD",
          "INDEX",
          "WORKTREE",
          "revision",
          "empty",
        ]),
        targetKind: Schema.union([
          "HEAD",
          "INDEX",
          "WORKTREE",
          "revision",
          "empty",
        ]),
      }),
      result: Schema.boolean(),
    },
    mutationLock: {
      params: Schema.object({ hold: Schema.boolean() }),
      result: Schema.boolean(),
    },
  },
  notifications: { changed: Schema.object({}) },
});

import { Schema, type Infer } from "@workshop/core";
import { defineProtocol } from "../../shared/rpc/protocol";

/** Enough of a line to tell it from its neighbours, and no more to save. */
export const EDGE_LENGTH = 120;
/** More folds than a note is read with; a larger set is saved cut short. */
export const MAX_SAVED_FOLDS = 1000;

export interface SavedFold {
  from: number;
  to: number;
  /**
   * The text of the lines the fold starts and ends on (their first
   * `EDGE_LENGTH` characters). Saved offsets are only good for the text
   * they were taken from: a note changed while no panel showed it would
   * fold other lines. Absent in view state saved before it was recorded.
   */
  edges?: string[];
}

export const savedFold = new Schema<SavedFold>(
  (value) => {
    const range = Schema.object({
      from: Schema.number(),
      to: Schema.number(),
      edges: Schema.array(Schema.string().max(EDGE_LENGTH)).optional(),
    }).parse(value);
    if (
      !Number.isSafeInteger(range.from) ||
      !Number.isSafeInteger(range.to) ||
      range.from < 0 ||
      range.from >= range.to ||
      (range.edges && range.edges.length !== 2)
    ) {
      throw new Error("Invalid fold range");
    }
    return range;
  },
  { type: "object" },
);

export const savedFolds = Schema.array(savedFold);
/** What a panel sends: its folds, bounded. */
const noteFolds = Schema.array(savedFold).max(MAX_SAVED_FOLDS);

/**
 * A note's folds, kept for the note rather than for one panel, as Obsidian
 * keeps them per file. `load` gives a panel the note's folds when it opens;
 * `save` records the panel's folds and answers whether they were taken.
 */
export const protocol = defineProtocol("folding", {
  requests: {
    load: {
      params: Schema.object({}),
      result: Schema.object({ folds: noteFolds.optional() }),
    },
    save: {
      params: Schema.object({
        folds: noteFolds,
        /**
         * The reader folded or unfolded in this panel: its folds become the
         * note's. Otherwise the panel only brings its folds up to date after
         * the text changed, which counts only while its folds are the note's.
         */
        claim: Schema.boolean(),
      }),
      result: Schema.boolean(),
    },
  },
  notifications: {},
});

export type NoteFolds = Infer<typeof noteFolds>;

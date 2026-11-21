import {
  foldEffect,
  foldState,
  foldedRanges,
  unfoldEffect,
} from "@codemirror/language";
import type { EditorState, StateEffect, Text } from "@codemirror/state";
import type { Context } from "@workshop/core";
import type {} from "../folding/api";
import { frontmatterBodyStart } from "./caret-guard";
import type { PropertyEditing } from "./editing";
import type { PropertyPresentation } from "./presentation";

interface Range {
  from: number;
  to: number;
}

/**
 * The front matter's fold as Obsidian 1.15.0 folds it in Source mode: from
 * the note's start through the closing line, when the note's first line is
 * `---` and a later line is `---` too.
 */
export function frontmatterFold(doc: Text): Range | undefined {
  if (doc.line(1).text !== "---") {
    return undefined;
  }
  for (let number = 2; number <= doc.lines; number++) {
    const line = doc.line(number);
    if (line.text === "---") {
      return { from: 0, to: line.to };
    }
  }
  return undefined;
}

/**
 * Fold the front matter, or unfold the fold at the note's start when there
 * is one. Nothing without front matter, or without the Folding plugin's
 * fold state (Obsidian too folds it only while folding is on).
 */
export function toggleFrontmatterFold(
  state: EditorState,
): StateEffect<Range> | undefined {
  if (state.field(foldState, false) === undefined) {
    return undefined;
  }
  let folded: Range | undefined;
  foldedRanges(state).between(0, 0, (from, to) => {
    if (from === 0) {
      folded = { from, to };
    }
  });
  if (folded) {
    return unfoldEffect.of(folded);
  }
  const fold = frontmatterFold(state.doc);
  return fold && foldEffect.of(fold);
}

/**
 * Toggle Fold Properties, and Properties' part in Fold All and Unfold All,
 * as in Obsidian 1.15.0.
 */
export function registerPropertyFolding(
  ctx: Context,
  options: { editing: PropertyEditing; presentation: PropertyPresentation },
): void {
  const { editing, presentation } = options;
  const view = ctx.editor.view;
  ctx.effect(() =>
    ctx.commands.register("editor:toggle-fold-properties", () => {
      if (presentation.showsYaml) {
        const effect = toggleFrontmatterFold(view.state);
        if (effect) {
          view.dispatch({ effects: effect });
        }
        return effect !== undefined;
      }
      // Collapse or expand the sheet, as its heading does when clicked
      // (which also remembers it for the note).
      const heading = view.dom.querySelector<HTMLElement>(
        "[data-properties-heading]",
      );
      heading?.click();
      return heading !== null;
    }),
  );
  // Obsidian collapses the sheet on Unfold All too, not only on Fold All;
  // this is its behaviour, not a slip.
  ctx.on("folding/allCommand", () => {
    if (
      !editing.isCollapsed &&
      frontmatterBodyStart(view.state.doc) !== undefined
    ) {
      editing.setCollapsed(true);
    }
  });
}

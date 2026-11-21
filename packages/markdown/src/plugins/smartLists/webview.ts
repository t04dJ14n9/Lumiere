import { keymap } from "@codemirror/view";
import type { Plugin } from "@workshop/core";
import type {} from "../editor/api";
import { continueLine, continueList } from "./commands";
import { renumberOnEdit } from "./renumber";
import { pasteIntoListItem } from "./paste";
import { setVimListContinueHandler } from "../../shared/vim-hooks";
import { smartListsOn } from "../../markdown/smart-lists";
export const smartListsWebview: Plugin = {
  name: "smartLists",
  inject: { required: ["editor"] },
  apply(ctx) {
    ctx.effect(() => setVimListContinueHandler(continueList));
    ctx.effect(() =>
      ctx.editor.extend([
        keymap.of([{ key: "Enter", run: continueList, shift: continueLine }]),
        renumberOnEdit,
        // Filters run last first: the paste is merged before numbering.
        pasteIntoListItem,
        // Swap Line Up and Down move list items whole while this is on.
        smartListsOn.of(true),
      ]),
    );
  },
};

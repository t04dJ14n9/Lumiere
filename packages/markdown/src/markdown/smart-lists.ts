import { Facet } from "@codemirror/state";

/**
 * Whether Smart lists is on in this editor. The smartLists plugin provides
 * it while it runs, so other plugins' list-aware commands (Swap Line Up and
 * Down) follow the same switch as Obsidian's `smartIndentList` setting.
 */
export const smartListsOn = Facet.define<boolean, boolean>({
  combine: (values) => values.some(Boolean),
});

import { Vim } from "@replit/codemirror-vim";

/**
 * Drop vim-core's `gc` (toggle comment), which Obsidian's Vim does not have:
 * Obsidian 1.15.0's `vim.js` maps no `gc`, so the keys do nothing there.
 * Returns the restore, which maps the library default back when the Vim
 * plugin stops.
 */
export function dropCommentOperator(): () => void {
  // The library default has no mode; the typings require a string.
  const anyMode = undefined as unknown as string;
  Vim.unmap("gc", anyMode);
  return () => {
    Vim.mapCommand("gc", "operator", "toggleComment", {}, { isEdit: true });
  };
}

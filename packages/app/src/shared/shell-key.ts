/**
 * The window's proof that a request to add a folder is its own, and not a
 * page's in it (server/auth.ts `fromShell`). The key travels in this header;
 * the server puts it in this meta tag of the window's page and nowhere else.
 */
export const SHELL_KEY_HEADER = "x-lumiere-shell";
export const SHELL_KEY_META = "lumiere-shell-key";

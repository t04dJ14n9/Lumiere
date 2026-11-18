import type { SourceFetch } from "../../attachments";

/**
 * The editor host's `fetch`. The global is read when called, as Node's
 * (VS Code's extension host, DSH, the app) and a browser's (the web and iPad
 * apps) differ in what `redirect: "manual"` returns: see `fetchFollowing`.
 */
export const hostFetch: SourceFetch = (url, init) => fetch(url, init);

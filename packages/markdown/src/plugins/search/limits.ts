/**
 * The most matching notes one vault search reports. Past it the search stops
 * and says so, so a query that matches every note stays bounded. Shared by
 * the host search and the status text of both views, so it lives apart from
 * the RPC protocol, which the webview does not load.
 */
export const SEARCH_RESULT_LIMIT = 1000;

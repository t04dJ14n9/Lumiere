import { contributionId } from "../../shared/setting-schema";

export const SEARCH_VIEW_ID = contributionId("search");
export const SEARCH_COMMAND = contributionId("search.vault");
export const CLEAR_COMMAND = contributionId("search.clearResults");
/** Runs when a result row is clicked: the note's URI and an offset in it. */
export const OPEN_RESULT_COMMAND = `${SEARCH_VIEW_ID}.openResult`;
/** Set while the view holds results, so it stays shown beside any editor. */
export const RESULTS_SHOWN_CONTEXT = `${SEARCH_VIEW_ID}.hasResults`;

import { queryRequirements } from "../markdown/search/plan";
import {
  compileSearch,
  type SearchDocument,
} from "../markdown/search/evaluate";
import {
  parseSearch,
  searchesFiles,
  type SearchQuery,
} from "../markdown/search/query";
import {
  startup,
  submission,
  workerReply,
} from "../plugins/search/worker-protocol";
import { extractMatchLines } from "../plugins/search/match-lines";
import type { SearchVerdict } from "../plugins/search/runner";
import { errorMessage } from "../shared/errors";
import type { WorkerPort } from "../shared/workers";

/**
 * Whether a document matches, with a hit's match lines. Both run the user's
 * regular expressions, so both run here, under the worker's deadline.
 */
export function searchVerdict(
  query: SearchQuery,
  document: SearchDocument,
  matches = compileSearch(query),
): SearchVerdict {
  const matched = matches(document);
  const lines =
    matched && document.text ? extractMatchLines(document.text, query) : [];
  return { matched, ...(lines.length > 0 ? { matches: lines } : {}) };
}

/** One query per worker: the query arrives as the start data. */
export function serveSearch(port: WorkerPort): void {
  const send = (value: unknown) => port.post(workerReply(value));
  try {
    const query = parseSearch(startup.parse(port.data).query);
    const matches = compileSearch(query);
    port.onMessage((value: unknown) => {
      let request;
      try {
        request = submission.parse(value);
      } catch {
        send({ type: "error", message: "Invalid search submission" });
        return;
      }
      try {
        const verdict = searchVerdict(query, request.document, matches);
        send({ type: "result", id: request.id, ...verdict });
      } catch (error) {
        send({
          type: "rejected",
          id: request.id,
          message: errorMessage(error),
        });
      }
    });
    const needs = queryRequirements(query);
    send({
      type: "ready",
      files: searchesFiles(query),
      content: needs.text,
      metadata: needs.metadata,
    });
  } catch (error) {
    send({ type: "error", message: errorMessage(error) });
    port.close();
  }
}

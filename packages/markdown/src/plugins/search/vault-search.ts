import { errorMessage } from "../../shared/errors";
import type { TreeHandle } from "../../shared/host";
import { CancelToken } from "../../shared/rpc/lifecycle";
import type { WorkerLauncher } from "../../shared/workers";
import type { Vault } from "../vault/api";
import type { SearchResponse } from "./protocol";
import { SEARCH_RESULT_LIMIT, SEARCH_SKIP_LIMIT } from "./limits";
import { searchVault } from "./query";
import type { SearchResultsTree } from "./results-tree";
import { SearchWorker, type SearchEvaluator } from "./runner";
import { t } from "@workshop/l10n";

interface VaultSearchOptions {
  tree: TreeHandle;
  results: SearchResultsTree;
  /** The vault to search: the active note's, else the workspace's. */
  vault(): Promise<Vault | undefined>;
  read(uri: string): Promise<string>;
  workers: WorkerLauncher;
  /** Says whether the view holds results (a context key in VS Code). */
  showsResults(isShown: boolean): void;
  /** Tests stand in for the worker. */
  evaluator?: (query: string, token: CancelToken) => SearchEvaluator;
}

/**
 * One query at a time over a vault, laid out in the Vault Search view. A new
 * query cancels the one running; a refresh (the vault changed) runs the same
 * query again and keeps the rows on screen until its results replace them.
 */
export class VaultSearch {
  private query: string | undefined;
  private token = new CancelToken();

  constructor(private readonly options: VaultSearchOptions) {}

  /** The last query, to offer again. */
  get lastQuery(): string {
    return this.query ?? "";
  }

  async search(query: string): Promise<void> {
    this.query = query;
    this.options.results.clear();
    this.options.tree.refresh();
    this.options.tree.setMessage(t("Searching for “{0}”…", query));
    await this.run(query);
  }

  /** Run the last query again, if there is one. */
  async refresh(): Promise<void> {
    if (this.query !== undefined) {
      await this.run(this.query);
    }
  }

  clear(): void {
    this.query = undefined;
    this.token.cancel();
    this.options.results.clear();
    this.options.tree.refresh();
    this.options.tree.setMessage(undefined);
    this.options.showsResults(false);
  }

  dispose(): void {
    this.token.cancel();
  }

  private async run(query: string): Promise<void> {
    this.token.cancel();
    const token = new CancelToken();
    this.token = token;
    const vault = await this.options.vault();
    if (token.cancelled) {
      return;
    }
    if (!vault) {
      this.show(t("Open a note or a folder to search its vault."));
      return;
    }
    let response: SearchResponse;
    try {
      response = await this.evaluate(vault, query, token);
    } catch (error) {
      if (!token.cancelled) {
        this.show(t("Search failed: {0}", errorMessage(error)));
      }
      return;
    }
    if (token.cancelled) {
      return;
    }
    this.options.results.set(response.results, (path) =>
      vault.index.file(path),
    );
    this.show(summary(query, this.options.results.fileCount, response));
  }

  private async evaluate(
    vault: Vault,
    query: string,
    token: CancelToken,
  ): Promise<SearchResponse> {
    const worker =
      this.options.evaluator?.(query, token) ??
      new SearchWorker(this.options.workers, query, { token });
    try {
      return await searchVault({
        vault: vault.index,
        worker,
        token,
        read: this.options.read,
      });
    } finally {
      await worker.dispose();
    }
  }

  private show(message: string): void {
    this.options.tree.refresh();
    this.options.tree.setMessage(message);
    this.options.showsResults(!this.options.results.isEmpty);
  }
}

function summary(
  query: string,
  files: number,
  response: SearchResponse,
): string {
  return [
    found(query, files),
    unreadable(response.unreadable),
    response.skipped?.length
      ? t(
          "Skipped, as their evaluation took too long: {0}.",
          response.skipped.join(", "),
        )
      : "",
    response.truncated
      ? t(
          "Stopped at {0} matching files; the rest were not searched.",
          SEARCH_RESULT_LIMIT,
        )
      : "",
    response.tooSlow
      ? t(
          "Stopped after {0} files took too long; the rest were not searched.",
          SEARCH_SKIP_LIMIT,
        )
      : "",
  ]
    .filter(Boolean)
    .join(" ");
}

function found(query: string, files: number): string {
  if (files === 0) {
    return t("No notes match “{0}”.", query);
  }
  return files === 1
    ? t("{0} file matches “{1}”.", files, query)
    : t("{0} files match “{1}”.", files, query);
}

function unreadable(count: number): string {
  if (count === 0) {
    return "";
  }
  return count === 1
    ? t("{0} file could not be read.", count)
    : t("{0} files could not be read.", count);
}

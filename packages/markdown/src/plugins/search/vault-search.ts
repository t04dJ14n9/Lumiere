import { errorMessage } from "../../shared/errors";
import type { TreeHandle } from "../../shared/host";
import { CancelToken } from "../../shared/rpc/lifecycle";
import type { WorkerLauncher } from "../../shared/workers";
import type { Vault } from "../vault/api";
import type { SearchResponse } from "./protocol";
import { searchVault } from "./query";
import type { SearchResultsTree } from "./results-tree";
import { SearchWorker, type SearchEvaluator } from "./runner";

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
    this.options.tree.setMessage(`Searching for “${query}”…`);
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
      this.show("Open a note or a folder to search its vault.");
      return;
    }
    let response: SearchResponse;
    try {
      response = await this.evaluate(vault, query, token);
    } catch (error) {
      if (!token.cancelled) {
        this.show(`Search failed: ${errorMessage(error)}`);
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
  const found =
    files === 0
      ? `No notes match “${query}”.`
      : `${files} ${files === 1 ? "file matches" : "files match"} “${query}”.`;
  if (response.unreadable === 0) {
    return found;
  }
  const noun = response.unreadable === 1 ? "file" : "files";
  return `${found} ${response.unreadable} ${noun} could not be read.`;
}

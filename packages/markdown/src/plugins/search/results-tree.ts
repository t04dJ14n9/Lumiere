import type { TreeNode, TreeSource } from "../../shared/host";
import { folderOf, nameOf } from "../../shared/vault-path";
import type { SearchResponse } from "./protocol";
import { OPEN_RESULT_COMMAND } from "./view-ids";

type Result = SearchResponse["results"][number];

/** A result's note, as the vault knows it. */
export interface ResultFile {
  uri: string;
}

/**
 * The Vault Search view's rows, as Obsidian's search pane lays them out: a
 * row per matching file (its name, its folder and how many lines match),
 * open, with a row per match line under it. Clicking a file opens it; a
 * match line opens it at the match.
 */
export class SearchResultsTree implements TreeSource {
  private rows: TreeNode[] = [];
  private readonly lines = new Map<string, TreeNode[]>();

  get isEmpty(): boolean {
    return this.rows.length === 0;
  }

  get fileCount(): number {
    return this.rows.length;
  }

  /** Lay out `results`; a result whose file the vault no longer has is left out. */
  set(
    results: readonly Result[],
    fileOf: (path: string) => ResultFile | undefined,
  ): void {
    this.rows = [];
    this.lines.clear();
    for (const result of results) {
      const file = fileOf(result.path);
      if (file) {
        this.add(result, file);
      }
    }
  }

  clear(): void {
    this.set([], () => undefined);
  }

  roots(): TreeNode[] {
    return this.rows;
  }

  children(node: TreeNode): TreeNode[] {
    return this.lines.get(node.id) ?? [];
  }

  private add(result: Result, file: ResultFile): void {
    const id = `file:${result.path}`;
    const matches = result.matches ?? [];
    const folder = folderOf(result.path);
    const count = matches.length > 0 ? String(matches.length) : "";
    this.rows.push({
      id,
      label: nameOf(result.path).replace(/\.(md|markdown)$/iu, ""),
      description: [folder, count].filter(Boolean).join(" · "),
      tooltip: result.path,
      resourceUri: file.uri,
      ...(matches.length > 0 && { expanded: true }),
      command: { id: OPEN_RESULT_COMMAND, args: [file.uri] },
    });
    this.lines.set(
      id,
      matches.map((match, index) => ({
        id: `${id}#${index}`,
        label: match.text.trim() || match.text,
        icon: "dash",
        command: { id: OPEN_RESULT_COMMAND, args: [file.uri, match.offset] },
      })),
    );
  }
}

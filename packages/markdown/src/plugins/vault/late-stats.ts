import type { ListedFile } from "./api";
import { inSlicesBatch } from "./indexer-slices";

/**
 * The stats a listing sends after it (`ListedFile.statPending`), and the
 * file events that outdate them: a stat read during the walk can resolve
 * after an event reported the file's newer one.
 */
export class LateStats {
  private reported?: Set<string>;

  /** A file event's stats are newer than any late one for its path. */
  report(path: string): void {
    this.reported?.add(path);
  }

  /** Pass `take` each slice of `stats`, without the files events reported. */
  async apply(
    stats: Promise<ListedFile[]>,
    take: (files: readonly ListedFile[]) => void,
  ): Promise<void> {
    const reported = new Set<string>();
    this.reported = reported;
    try {
      await inSlicesBatch(await stats, (batch) =>
        take(batch.filter((file) => !reported.has(file.path))),
      );
    } finally {
      if (this.reported === reported) {
        delete this.reported;
      }
    }
  }
}

import { inSlices, inSlicesBatch, waitUpTo } from "./indexer-slices";
export { waitUpTo } from "./indexer-slices";
import { isMarkdownPath } from "../../shared/vault-path";
import { exclusionMatcher, isIgnoredPath } from "./exclusion";
import type { FileEntry } from "./file-table";
import { MemoryVaultIndex } from "./memory-index";
import { ParseQueue } from "./parse-queue";
import { Snapshot, reusableHash } from "./snapshot";
import { KeyedTimers } from "./keyed-timers";
import { LateStats } from "./late-stats";
import { ListingWatch } from "./listing-watch";
import type {
  FileEvent,
  ListedFile,
  NoteParser,
  SnapshotStore,
  VaultFileSystem,
  VaultListing,
  VaultSettings,
} from "./api";

/** Obsidian's limit is higher; past this the index says it is partial. */
const FILE_LIMIT = 50_000;
/** At most one snapshot write per interval (DESIGN §12.2). */
const SAVE_DELAY_MS = 2_000;

/** The settings that shape the index, comparable as one string. */
function indexSettingsKey(settings: VaultSettings): string {
  const { folderNote, linkFormat, excludedFiles } = settings;
  return JSON.stringify([folderNote, linkFormat, excludedFiles]);
}
/**
 * Typing in an open note re-indexes it after this pause. Obsidian updates
 * unresolved link chrome near-instantly; 300 ms left new `[[Missing]]`
 * looking resolved. 50 ms still coalesces keystrokes without the lag.
 */
export const OVERLAY_DELAY_MS = 50;
/**
 * Maximum time `ready` waits for a cold vault file-system scan before letting
 * the editor open while indexing continues in the background.
 */
export const INITIAL_READY_BUDGET_MS = 500;
/** Long start-up work runs in slices of about this long, between other events. */

export interface IndexerOptions {
  root: string;
  fs: VaultFileSystem;
  store?: SnapshotStore;
  parse: NoteParser;
  hash: (text: string) => string;
  settings: () => VaultSettings;
  /** Called each time indexing settles (Obsidian's `resolved`). */
  onResolved?: () => void;
  onPartial?: () => void;
  onError?: (message: string, error: unknown) => void;
  delays?: { save: number; overlay: number; ready?: number };
}

/**
 * Keeps one vault's index current: it starts from the persisted snapshot,
 * reconciles it with the file system, follows file events and open editors,
 * and saves the snapshot again.
 */
export class VaultIndexer {
  readonly index: MemoryVaultIndex;
  /** Resolves once the file list is known, from the snapshot or a listing. */
  readonly ready: Promise<void>;
  private readonly queue: ParseQueue;
  private readonly snapshot = new Snapshot();
  private readonly timers = new KeyedTimers();
  private disposed = false;
  private reconciling = false;
  private readonly listingWatch: ListingWatch;
  private isExcluded: (path: string) => boolean;
  /** The settings the index was built with (`indexSettingsKey`). */
  private indexedWith: string;
  /** Resolves as soon as the initial file list is in the index. */
  private fileListReady: Promise<void>;
  private markFileListReady!: () => void;
  /** False until the initial vault listing (or cache) has populated the file table. */
  private listingReady = false;
  /** The first comparison with the file system, which may run after `ready`. */
  private reconciled: Promise<void> = Promise.resolve();
  /** The save in progress, which the next save waits for. */
  private saving: Promise<void> = Promise.resolve();
  private readonly lateStats = new LateStats();

  constructor(private readonly options: IndexerOptions) {
    this.listingWatch = new ListingWatch(
      options.fs,
      options.root,
      this.onFileEvent.bind(this),
    );
    const settings = options.settings();
    const { folderNote, linkFormat, excludedFiles } = settings;
    this.indexedWith = indexSettingsKey(settings);
    this.isExcluded = exclusionMatcher(excludedFiles);
    this.index = new MemoryVaultIndex({
      root: options.root,
      folderNote,
      linkFormat,
    });
    this.fileListReady = new Promise<void>((resolve) => {
      this.markFileListReady = resolve;
    });
    this.queue = this.createQueue();
    this.ready = this.start();
  }

  /** Resolves when the file system has been listed and no note waits to be parsed. */
  async settled(): Promise<void> {
    await this.ready;
    await this.reconciled;
    await this.queue.drained();
  }

  private completeFileList(): void {
    if (this.listingReady) {
      return;
    }
    this.listingReady = true;
    this.markFileListReady();
  }

  /** Ensure an open note is indexed while the initial vault scan is still running. */
  seedFile(uri: string, path: string): void {
    if (
      this.listingReady ||
      this.disposed ||
      isIgnoredPath(path) ||
      this.index.file(path)
    ) {
      return;
    }
    this.index.addFiles([this.entry({ uri, path, mtime: 0, size: 0 })]);
    this.queue.enqueue(path);
  }

  /** The unsaved text of an open note, indexed after a short pause. */
  setOverlay(path: string, text: string, uri?: string): void {
    if (
      !this.listingReady &&
      !this.disposed &&
      !isIgnoredPath(path) &&
      !this.index.file(path)
    ) {
      const fallbackUri = `${this.options.root.replace(/\/+$/, "")}/${encodeURI(path)}`;
      this.index.addFiles([
        this.entry({ uri: uri ?? fallbackUri, path, mtime: 0, size: 0 }),
      ]);
    }
    this.timers.debounce(`overlay:${path}`, this.delays.overlay, () =>
      this.queue.setOverlay(path, text),
    );
  }

  /** The note was closed; its file on disk is authoritative again. */
  clearOverlay(path: string): void {
    this.timers.cancel(`overlay:${path}`);
    this.queue.clearOverlay(path);
  }

  /**
   * Settings changed: apply exclusion and link settings to every file. That
   * re-resolves every link synchronously, so a change to anything else (most
   * settings) leaves the index alone.
   */
  applySettings(): void {
    const settings = this.options.settings();
    const key = indexSettingsKey(settings);
    if (key === this.indexedWith) {
      return;
    }
    this.indexedWith = key;
    this.index.configure(settings);
    this.isExcluded = exclusionMatcher(settings.excludedFiles);
    this.index.replaceFiles(this.index.files().map((file) => this.entry(file)));
    // Links resolved again and files were (un)excluded, without file events:
    // what reads the index (a base's snapshot) must read it again.
    this.index.notifyResolved();
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    void this.queue.stop();
    this.listingWatch.stopAndDiscard();
    this.timers.cancelAll();
    await this.save();
  }

  private get delays() {
    return (
      this.options.delays ?? { save: SAVE_DELAY_MS, overlay: OVERLAY_DELAY_MS }
    );
  }

  private createQueue(): ParseQueue {
    return new ParseQueue({
      index: this.index,
      snapshot: this.snapshot,
      fs: this.options.fs,
      parse: this.options.parse,
      hash: this.options.hash,
      onSnapshotChanged: () => this.scheduleSave(),
      onDrained: () => this.drained(),
      onError: (path, error) =>
        this.options.onError?.(`Could not index ${path}`, error),
    });
  }

  private async start(): Promise<void> {
    if (this.options.store) {
      await this.snapshot.load(this.options.store);
    }
    const hasCachedFiles = Object.keys(this.snapshot.files).length > 0;
    if (hasCachedFiles) {
      await this.loadCached();
    }
    this.reconciled = this.reconcile()
      .catch((error) =>
        this.options.onError?.("Could not list the vault", error),
      )
      .finally(() => this.completeFileList());
    if (!hasCachedFiles) {
      await waitUpTo(
        this.fileListReady,
        this.options.delays?.ready ?? INITIAL_READY_BUDGET_MS,
      );
    }
  }

  /**
   * Warm start: the previous session's files and metadata, before any
   * listing. Metadata is added in short slices so the host stays responsive.
   */
  private async loadCached(): Promise<void> {
    const cached = Object.entries(this.snapshot.files);
    await inSlicesBatch(cached, (batch) =>
      this.index.addFiles(
        batch.map(([path, file]) =>
          this.entry({
            uri: file.uri,
            path,
            mtime: file.mtime,
            size: file.size,
          }),
        ),
      ),
    );
    await inSlices(cached, ([path, file]) => {
      const metadata = file.hash
        ? this.snapshot.metadata[file.hash]
        : undefined;
      if (metadata) {
        this.index.setMetadata(path, metadata);
      }
    });
  }

  /** Compare the file system with the index; parse only what changed. */
  private async reconcile(): Promise<void> {
    this.reconciling = true;
    // Watching starts before the listing, so a file written while it runs gets
    // an event. The listing may predate such an event, so events wait until the
    // listing is in the index (see applyListing).
    this.listingWatch.start();
    try {
      const listing = await this.listingWatch.untilListed(
        this.options.fs.list(this.options.root, FILE_LIMIT),
      );
      if (this.disposed) {
        return;
      }
      if (listing.partial) {
        this.options.onPartial?.();
      }
      await this.applyListing(listing);
    } finally {
      this.listingWatch.release();
      this.reconciling = false;
    }
  }

  /** Adds a listing to the index, drops what it lacks and parses what changed. */
  private async applyListing(listing: VaultListing): Promise<void> {
    const take = this.takeLateStats.bind(this);
    const lateStats =
      listing.stats && this.lateStats.apply(listing.stats, take);
    const files = listing.files.filter((file) => !isIgnoredPath(file.path));
    if (
      this.index.files().length > 0 ||
      Object.keys(this.snapshot.files).length > 0
    ) {
      const present = new Set(files.map((file) => file.path));
      for (const path of this.queue.overlayPaths()) {
        present.add(path);
      }
      this.index.removeFilesExcept(present);
      this.forgetMissing(present);
    }
    const toParse: string[] = [];
    await inSlicesBatch(files, (batch) => {
      if (this.disposed) {
        return;
      }
      this.index.addFiles(batch.map((file) => this.entry(file)));
      for (const file of batch) {
        if (this.needsParse(file)) {
          toParse.push(file.path);
        }
      }
    });
    this.listingWatch.release();
    this.completeFileList();
    if (toParse.length > 0 && !this.disposed) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    for (const path of toParse) {
      if (this.disposed) {
        break;
      }
      this.queue.enqueue(path);
    }
    if (!this.disposed && this.queue.isIdle) {
      this.drained();
    }
    await lateStats;
  }

  /** Late stats of files still listed, added without events as the listing's are. */
  private takeLateStats(files: readonly ListedFile[]): void {
    if (this.disposed) {
      return;
    }
    const current = files.filter((file) => this.index.file(file.path));
    this.index.addFiles(current.map((file) => this.entry(file)));
    for (const file of current) {
      if (this.needsParse(file)) {
        this.queue.enqueue(file.path);
      }
    }
  }

  /**
   * Whether a note must be read and parsed. A note whose time and size match
   * the snapshot reuses its metadata. Attachments are only recorded.
   */
  private needsParse(file: ListedFile): boolean {
    if (file.statPending) {
      // Decided when its stats come (takeLateStats).
      return false;
    }
    const cached = this.snapshot.files[file.path];
    if (!isMarkdownPath(file.path)) {
      return this.recordAttachment(file, cached);
    }
    const hash = reusableHash(file, cached);
    const metadata = hash ? this.snapshot.metadata[hash] : undefined;
    if (!hash || !metadata) {
      return true;
    }
    if (cached?.mtime === 0 && cached.size === 0) {
      this.snapshot.setFile(file.path, { ...file, hash });
      this.scheduleSave();
    }
    if (!this.index.metadata(file.path)) {
      this.index.setMetadata(file.path, metadata);
    }
    return false;
  }

  private recordAttachment(
    file: ListedFile,
    cached: Snapshot["files"][string] | undefined,
  ): boolean {
    if (cached?.mtime !== file.mtime || cached.size !== file.size) {
      this.snapshot.setFile(file.path, { ...file });
      this.scheduleSave();
    }
    return false;
  }

  private forgetMissing(present: Set<string>): void {
    for (const path of Object.keys(this.snapshot.files)) {
      if (!present.has(path)) {
        this.snapshot.deleteFile(path);
        this.scheduleSave();
      }
    }
  }

  private onFileEvent(event: FileEvent): void {
    this.lateStats.report(
      event.type === "delete" ? event.path : event.file.path,
    );
    if (event.type === "delete") {
      this.deletePath(event.path);
      return;
    }
    if (isIgnoredPath(event.file.path)) {
      return;
    }
    if (event.type === "rename") {
      this.index.renameFile(event.oldPath, this.entry(event.file));
      this.moveCached(event.oldPath, event.file);
    } else {
      this.index.upsertFile(this.entry(event.file));
    }
    if (this.needsParse(event.file)) {
      this.queue.enqueue(event.file.path);
    }
  }

  /** VS Code reports a deleted folder by itself; its files go with it. */
  private deletePath(path: string): void {
    const isFile = Boolean(this.index.file(path));
    const prefix = path + "/";
    const paths = isFile
      ? [path]
      : this.index
          .files()
          .map((file) => file.path)
          .filter((other) => other.startsWith(prefix));
    for (const deleted of paths) {
      this.index.deleteFile(deleted);
      this.snapshot.deleteFile(deleted);
    }
    this.scheduleSave();
  }

  /** A renamed file keeps its parsed metadata; only its record moves. */
  private moveCached(oldPath: string, file: ListedFile): void {
    const cached = this.snapshot.files[oldPath];
    this.snapshot.deleteFile(oldPath);
    if (cached) {
      this.snapshot.setFile(file.path, { ...cached, uri: file.uri });
    }
    this.scheduleSave();
  }

  private entry(file: ListedFile): FileEntry {
    // A file whose stats are still to come keeps those the index has.
    const known = file.statPending ? this.index.file(file.path) : undefined;
    return {
      uri: file.uri,
      path: file.path,
      mtime: known?.mtime ?? file.mtime,
      size: known?.size ?? file.size,
      excluded: this.isExcluded(file.path),
    };
  }

  private drained(): void {
    if (this.disposed) {
      return;
    }
    this.index.notifyResolved();
    this.options.onResolved?.();
  }

  private scheduleSave(): void {
    if (!this.options.store || this.timers.has("save")) {
      return;
    }
    this.timers.debounce("save", this.delays.save, () => void this.save());
  }

  private save(): Promise<void> {
    this.timers.cancel("save");
    this.saving = this.saving.then(() => this.writeSnapshot());
    return this.saving;
  }

  /** Never rejects, so a failed save does not stop the ones queued after it. */
  private async writeSnapshot(): Promise<void> {
    if (!this.options.store || !this.snapshot.isDirty) {
      return;
    }
    try {
      await this.snapshot.save(this.options.store);
    } catch (error) {
      this.options.onError?.("Could not save the vault index", error);
    }
  }
}

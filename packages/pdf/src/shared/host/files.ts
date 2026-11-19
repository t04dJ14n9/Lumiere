/** The PDF files the viewer shows: reading, watching, naming, and optional in-place replace. */
export interface PdfFiles {
  /** The file's bytes; rejects when it cannot be read. */
  read(uri: string): Promise<Uint8Array>;
  /**
   * Calls `onChange` when the file is written or replaced, and when it is
   * deleted if the host can tell (the reload then fails and says so). A
   * URI the host cannot watch (not a file) never calls it.
   */
  watch(uri: string, onChange: () => void): () => void;
  /** The path agents and messages show: workspace-relative when inside one, with `/`. */
  displayPath(uri: string): string;
  /** SHA-256 hex of the file on disk. */
  hash?(uri: string): Promise<string>;
  /**
   * Atomically replace the file. Hosts that cannot (non-`file` schemes) omit this;
   * annotation saves then fail with a clear error.
   */
  writeAtomic?(uri: string, bytes: Uint8Array): Promise<{ sha256: string }>;
  /**
   * The annotation file kept for the PDF at `uri` whose bytes hash to
   * `sha256` (see `annotation-store`). Hosts without one keep no annotations
   * between sessions.
   */
  annotations?: PdfAnnotationFiles;
}

export interface PdfAnnotationFiles {
  /** The file's text; undefined when there is none. */
  read(uri: string, sha256: string): Promise<string | undefined>;
  /** Replace the file with `text`, or remove it when `text` is undefined. */
  write(uri: string, sha256: string, text: string | undefined): Promise<void>;
}

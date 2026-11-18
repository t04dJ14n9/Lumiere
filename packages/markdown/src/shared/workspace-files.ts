/** Host file adapters. Implementations live in `src/host`. */

/**
 * Workspace file access plugins need beyond reading bytes. Every path is a
 * URI the host re-checks; plugins do not touch the filesystem themselves.
 */
export interface WorkspaceFiles {
  /** Checks lexical containment and existing symlinks, including missing targets. */
  authorize?(root: string, target: string): Promise<void>;
  readText(uri: string): Promise<string | undefined>;
  writeText(uri: string, text: string): Promise<void>;
  /**
   * Write `text` to a new file, unless something is already at `uri`: then
   * false, and nothing is written. The check and the creation are one step
   * where the host's files allow it, so two writers never overwrite each
   * other; `writeText` after a check would. The browser host has no such
   * step: it makes writers in one page take turns, and another tab or app
   * can still win the same path.
   */
  createText(uri: string, text: string): Promise<boolean>;
  /** Replace or create a file with raw bytes (images, etc.). */
  writeBytes(uri: string, data: Uint8Array): Promise<void>;
  /** `createText` for raw bytes: false, writing nothing, when `uri` is taken. */
  createBytes(uri: string, data: Uint8Array): Promise<boolean>;
  list(uri: string): Promise<readonly string[] | undefined>;
  mkdir(uri: string): Promise<void>;
  copy(from: string, to: string): Promise<void>;
  move(from: string, to: string): Promise<void>;
  /**
   * Delete a file. With `trash`, move it to the system trash where the host's
   * `files.enableTrash` allows, so a mistake can be undone; a host without a
   * trash deletes it for good.
   */
  remove(uri: string, options?: { trash?: boolean }): Promise<void>;
  /** True when the URI exists and is a symbolic link. Missing is false. */
  isSymbolicLink(uri: string): Promise<boolean>;
  pickFile(title: string): Promise<string | undefined>;
}

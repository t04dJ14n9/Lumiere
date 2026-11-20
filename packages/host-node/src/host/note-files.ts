/** How a note's file is reached: the platform's files and its text hash. */
import type { HostFiles, HostPlatform } from "./platform";

/** What notes need from the platform: their files, and a hash of their text. */
export interface NoteFiles extends Pick<
  HostFiles,
  "readText" | "save" | "watch" | "create"
> {
  sha256(text: string): string;
  /**
   * Move a file or folder inside the workspace roots, refusing a target
   * that exists; without it, notes cannot be renamed (start-host.ts gives it).
   */
  move?(from: string, to: string): Promise<void>;
}

export function noteFiles(platform: HostPlatform): NoteFiles {
  const { files } = platform;
  // Called through `files`: a platform's files may be a class instance.
  return {
    readText: (uri) => files.readText(uri),
    save: (uri, text) => files.save(uri, text),
    watch: (uri, listener) => files.watch(uri, listener),
    create: (uri) => files.create(uri),
    sha256: (text) => platform.sha256(text),
  };
}

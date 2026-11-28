import type {
  GitBlameLineResult,
  GitBlameSnapshot,
  GitIdentity,
} from "./git-blame";
import type { Disposer } from "@workshop/core";

/** What the git diff plugins compare a note with. */
export type GitRef = "HEAD" | "index";

export interface GitBaseline {
  /** The file's text at `ref`, with LF line endings. */
  readonly text: string;
  /** For people: "HEAD (a1c9f02)" or "Index". */
  readonly label: string;
}

export type GitBaselineResult =
  | { readonly status: "ok"; readonly baseline: GitBaseline }
  /**
   * No repository, git disabled, the file is outside any repository, or git
   * failed to answer (a timeout, a damaged repository).
   */
  | { readonly status: "unavailable" }
  /** The file is in a repository but not at `ref` (new or untracked). */
  | { readonly status: "untracked" }
  /** Past the diff limits (`src/shared/diff/limits.ts`); the text is not kept. */
  | { readonly status: "tooLarge" };

/**
 * What a failed read of a note at HEAD or in the index means: `untracked`
 * when git says the note is not there (new, untracked, only in a merge
 * conflict's stages), `unavailable` for any other failure, such as a
 * timeout or a damaged repository. Reads git's wording, in `message` and,
 * for VS Code's git extension, `stderr`.
 */
export function baselineFailure(error: unknown): "untracked" | "unavailable" {
  const { message, stderr } = (error ?? {}) as {
    message?: unknown;
    stderr?: unknown;
  };
  const text = `${String(message ?? error)}\n${String(stderr ?? "")}`;
  return /does not exist|exists on disk, but not in|is in the index, but not at stage|not a valid object name|invalid object name|bad revision|unknown revision/i.test(
    text,
  )
    ? "untracked"
    : "unavailable";
}

/**
 * Git through VS Code's built-in git extension (`vscode.git`, API 1). Plugins
 * never shell out; the host adapter owns the extension API.
 */
export interface GitAccess {
  /** Blame one 1-based editor-snapshot line against HEAD. */
  blameLine(
    uri: string,
    line: number,
    snapshot: GitBlameSnapshot,
  ): Promise<GitBlameLineResult>;
  identity(uri: string): Promise<GitIdentity | undefined>;
  /** Advances once per underlying repo event, before onDidChange fan-out. */
  repoGeneration(uri: string): number;
  baseline(uri: string, ref: GitRef): Promise<GitBaselineResult>;
  /** Repository state changed (commit, checkout, stage, a new repository). */
  onDidChange(listener: () => void): Disposer;
  /** Stage the whole file. */
  stage(uri: string): Promise<boolean>;
  /** The `git:` URI of `uri` at `ref`, for VS Code's own diff editor. */
  toGitUri(uri: string, ref: string): string | undefined;
  /**
   * The note a `git:` URI shows and its revision, the inverse of `toGitUri`;
   * any other URI is its own source, with no revision.
   */
  sourceOf(uri: string): { source: string; ref?: string };
}

/**
 * The file a panel's note is and the revision it shows: a note opened from
 * Git history (a `git:` URI) is its file at a commit, and its vault, links
 * and embeds are that file's. A `git:` URI Git cannot read is its own source.
 */
export function noteRevision(
  git: Pick<GitAccess, "sourceOf">,
  uri: string,
): { source: string; ref?: string } {
  try {
    return git.sourceOf(uri);
  } catch {
    return { source: uri };
  }
}

/** A text diff tab VS Code opened for a Markdown file (Source Control, Timeline). */
export interface OpenedDiff {
  readonly original: string;
  readonly modified: string;
  readonly column: number | undefined;
  readonly preview: boolean;
  /**
   * Close the native tab, unless it has unsaved changes. True only when the
   * tab is closed.
   */
  close(): Promise<boolean>;
}

/** What one side of a rendered diff shows. */
export interface DiffSide {
  readonly uri: string;
  readonly label: string;
  readonly text: string;
}

export interface DiffPanel {
  update(left: DiffSide, right: DiffSide): void;
  onDispose(listener: () => void): Disposer;
  dispose(): void;
}

export interface DiffViews {
  onDidOpenDiff(listener: (diff: OpenedDiff) => void): Disposer;
  /** Open the native diff editor; its tab is not handed to `onDidOpenDiff`. */
  openNative(
    original: string,
    modified: string,
    title: string,
    column?: number,
  ): Promise<void>;
  show(options: {
    left: DiffSide;
    right: DiffSide;
    title: string;
    column: number | undefined;
    preview: boolean;
    resources?: {
      roots: readonly string[];
      load(side: "left" | "right", target: string): Promise<string>;
    };
    /** Messages from the panel's buttons. */
    onAction(action: "openFile" | "openNative"): void;
  }): DiffPanel;
}

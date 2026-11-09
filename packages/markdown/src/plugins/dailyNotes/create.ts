import type { WorkspaceFiles } from "../../shared/workspace-files";
import {
  baseName,
  joinContained,
  walksSymbolicLink,
} from "../../shared/workspace-path";
import { dailyTemplatePath } from "./names";

export interface DailyNoteFiles {
  readonly root: string;
  readonly files: Pick<
    WorkspaceFiles,
    | "list"
    | "mkdir"
    | "readText"
    | "createText"
    | "isSymbolicLink"
    | "authorize"
  >;
  isIndexed(path: string): boolean;
  inform(message: string): void;
  error(message: string): void;
}

/**
 * The URI of the daily note at `path`, created from the template when it
 * does not exist. A note that appears while this runs is kept, not replaced.
 * Undefined when nothing could be written.
 */
export async function createDailyNote(
  io: DailyNoteFiles,
  note: {
    readonly path: string;
    readonly template: string;
    expand(text: string, title: string): string;
  },
): Promise<string | undefined> {
  const uri = joinContained(io.root, note.path);
  if (!uri) {
    io.error("The daily notes folder must stay inside the vault.");
    return undefined;
  }
  if (await exists(io, note.path)) {
    return uri;
  }
  if (
    await walksSymbolicLink(note.path, io.root, (target) =>
      io.files.isSymbolicLink(target),
    )
  ) {
    io.error(
      "The daily note path follows a symbolic link. Nothing was written.",
    );
    return undefined;
  }
  const parent = parentOf(note.path);
  const parentUri = parent ? joinContained(io.root, parent) : undefined;
  if (parentUri) {
    await io.files.mkdir(parentUri);
  }
  const title = baseName(note.path).replace(/\.md$/i, "");
  const template = await readTemplate(io, note.template);
  // The note may have appeared since the check above (another window, a
  // sync, a slow template read): then it is opened as it is, never replaced.
  await io.files.createText(uri, note.expand(template, title));
  return uri;
}

/**
 * The index can lag a file created outside Lumiere, and `readText` hides read
 * errors, so a file the index has not seen is looked up in its folder.
 */
async function exists(io: DailyNoteFiles, path: string): Promise<boolean> {
  if (io.isIndexed(path)) {
    return true;
  }
  const parent = parentOf(path);
  const folder = parent ? joinContained(io.root, parent) : io.root;
  const names = folder ? await io.files.list(folder) : undefined;
  return names?.includes(baseName(path)) ?? false;
}

async function readTemplate(
  io: DailyNoteFiles,
  setting: string,
): Promise<string> {
  if (setting.trim() === "") {
    return "";
  }
  const path = dailyTemplatePath(setting);
  const uri = path ? joinContained(io.root, path) : undefined;
  if (uri && !(await isInsideVault(io, uri))) {
    io.error(
      `Daily note template ${setting} is outside the vault or follows a symbolic link; the note was created empty.`,
    );
    return "";
  }
  const text = uri ? await io.files.readText(uri) : undefined;
  if (text === undefined) {
    io.inform(
      `Daily note template ${setting} was not found; the note was created empty.`,
    );
    return "";
  }
  return text;
}

/**
 * True when the template's real location, through symbolic links on the file or any
 * folder above it, is inside the vault. `joinContained` only checks the
 * spelling, so a linked Templates folder could pull in any readable file.
 * A host that cannot check reads nothing.
 */
async function isInsideVault(
  io: DailyNoteFiles,
  uri: string,
): Promise<boolean> {
  if (!io.files.authorize) {
    return false;
  }
  try {
    await io.files.authorize(io.root, uri);
    return true;
  } catch {
    return false;
  }
}

function parentOf(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash < 0 ? "" : path.slice(0, slash);
}

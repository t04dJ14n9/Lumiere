import { asStrings } from "../../shared/values";
import type { WorkspaceFiles } from "../../shared/workspace-files";
import {
  joinContained,
  safeRelative,
  walksSymbolicLink,
} from "../../shared/workspace-path";
import { scratchFileName } from "./names";
import { scratchNote } from "./template";

export interface ScratchIO {
  readonly files: WorkspaceFiles;
  readonly rootUri: string;
  execute(id: string, ...args: unknown[]): Promise<unknown>;
  inform(message: string): void;
  error(message: string): void;
}

export async function createScratchNote(
  io: ScratchIO,
  input: {
    readonly title: string;
    readonly at: string;
    readonly folder: string;
  },
): Promise<void> {
  const folder = safeRelative(input.folder);
  if (!folder) {
    io.error("The scratch folder must stay inside the project.");
    return;
  }
  if (await blocked(io, folder)) {
    return;
  }
  const created = await createUnderFreeName(io, {
    directory: folder,
    name: (existing) => scratchFileName(input.title, input.at, existing),
    text: scratchNote(input.title, input.at),
    outside: "The scratch folder must stay inside the project.",
  });
  if (!created) {
    return;
  }
  await io.execute("vscode.open", created.uri);
  io.inform("Created a scratch note.");
}

async function directoryNames(
  io: ScratchIO,
  folder: string,
): Promise<readonly string[]> {
  const uri = joinContained(io.rootUri, folder);
  if (!uri) {
    return [];
  }
  return asStrings(await io.files.list(uri));
}

/**
 * Creates a file under the first name `input.name` finds free in the folder.
 * The create claims the name: when another writer took it since the listing,
 * the next name is tried, and that writer's file is never overwritten.
 */
async function createUnderFreeName(
  io: ScratchIO,
  input: {
    readonly directory: string;
    readonly name: (existing: readonly string[]) => string;
    readonly text: string;
    readonly outside: string;
  },
): Promise<{ relative: string; uri: string } | undefined> {
  const lost: string[] = [];
  for (;;) {
    const listed = await directoryNames(io, input.directory);
    const name = input.name([...listed, ...lost]);
    const relative = `${input.directory}/${name}`;
    if (await blocked(io, relative)) {
      return undefined;
    }
    const uri = joinContained(io.rootUri, relative);
    if (!uri) {
      io.error(input.outside);
      return undefined;
    }
    await ensureDirectory(io, input.directory);
    if (await io.files.createText(uri, input.text)) {
      return { relative, uri };
    }
    lost.push(name);
  }
}

async function ensureDirectory(io: ScratchIO, folder: string): Promise<void> {
  const uri = joinContained(io.rootUri, folder);
  if (!uri) {
    return;
  }
  const listed = await io.files.list(uri);
  if (!Array.isArray(listed)) {
    await io.files.mkdir(uri);
  }
}

async function blocked(io: ScratchIO, relative: string): Promise<boolean> {
  const linked = await walksSymbolicLink(relative, io.rootUri, (uri) =>
    io.files.isSymbolicLink(uri),
  );
  if (linked) {
    io.error("That path follows a symbolic link. Nothing was written.");
  }
  return linked;
}

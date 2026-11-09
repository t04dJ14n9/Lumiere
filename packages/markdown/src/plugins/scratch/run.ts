import { replaceAllEdit } from "../../shared/text-edit";
import type { HostDocument, TextEdit } from "../../shared/host";
import { asStrings } from "../../shared/values";
import type { WorkspaceFiles } from "../../shared/workspace-files";
import {
  encodeLinkPath,
  joinContained,
  relativePosix,
  safeRelative,
  walksSymbolicLink,
} from "../../shared/workspace-path";
import type { ResolvedLayout } from "../wiki/api";
import { promotedFileName, scratchFileName } from "./names";
import {
  destinationDirectory,
  promotePage,
  promoteRefusal,
  promotedStub,
  scratchBody,
  scratchIsInsideBundle,
  scratchNote,
} from "./template";
import type { PromoteTarget } from "./template";

export interface ScratchIO {
  readonly files: WorkspaceFiles;
  readonly rootUri: string;
  readonly layout?: ResolvedLayout;
  execute(id: string, ...args: unknown[]): Promise<unknown>;
  apply(document: HostDocument, edits: readonly TextEdit[]): Promise<boolean>;
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
  if (scratchIsInsideBundle(io.layout, folder)) {
    io.error(
      "Scratch notes stay outside the wiki bundle. Change the scratch folder in .wiki/layout.json.",
    );
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
  io.inform(
    "Created a scratch note outside the wiki. It stays out until you promote it. No agent was started.",
  );
}

export async function promoteScratchNote(
  io: ScratchIO,
  input: {
    readonly target: PromoteTarget;
    readonly title: string;
    readonly text: string;
    readonly at: string;
    readonly scratchRelative: string;
    readonly document?: HostDocument;
  },
): Promise<void> {
  const refusal = promoteRefusal(input.text);
  if (refusal) {
    io.error(refusal);
    return;
  }
  if (scratchIsInsideBundle(io.layout, directoryOf(input.scratchRelative))) {
    io.error("This note is already inside the wiki bundle. It was not moved.");
    return;
  }
  const directory = destinationDirectory(io.layout, input.target.logical);
  const created = await createUnderFreeName(io, {
    directory,
    name: (existing) => promotedFileName(input.title, existing),
    text: promotePage({
      title: input.title,
      type: input.target.type,
      body: scratchBody(input.text),
      at: input.at,
    }),
    outside: "The wiki folder must stay inside the project.",
  });
  if (!created) {
    return;
  }
  const { relative } = created;
  // The note may have been typed into while the page was written; the stub
  // would replace that text too. Nothing awaits between this check and the edit.
  if (input.document && changedSince(input.document, input.text)) {
    io.error(
      `The wiki page was written to ${relative}, but the scratch note changed while it was being promoted, so it was left as it is.`,
    );
    return;
  }
  const path = encodeLinkPath(relativePosix(input.scratchRelative, relative));
  const replaced = await replaceScratch(
    io,
    input.document,
    promotedStub(input.title, path, input.at),
  );
  if (!replaced) {
    io.error(
      "The wiki page was written, but the scratch note could not be replaced.",
    );
    return;
  }
  io.inform(
    `Promoted to ${relative}. The scratch note now links to it. The collection index was not changed. No agent was started.`,
  );
}

function directoryOf(relative: string): string {
  const slash = relative.lastIndexOf("/");
  return slash < 0 ? relative : relative.slice(0, slash);
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

/** True when the note no longer holds the text the page was written from. */
function changedSince(document: HostDocument, text: string): boolean {
  return typeof document.getText === "function" && document.getText() !== text;
}

async function replaceScratch(
  io: ScratchIO,
  document: HostDocument | undefined,
  stub: string,
): Promise<boolean> {
  if (!document || typeof document.getText !== "function") {
    return false;
  }
  return io.apply(document, [replaceAllEdit(document.getText(), stub)]);
}

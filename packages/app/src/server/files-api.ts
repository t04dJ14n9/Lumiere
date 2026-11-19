/**
 * The file tree's changes to a vault (api.ts routes them): a new note or
 * folder, a rename or move that updates links, and deletion, to the
 * system's trash when there is one (trash.ts). Paths come relative to an
 * open vault, with `/`; host-node checks each against the vault again,
 * through symbolic links (`LumiereHost.files`). Only the window may ask.
 */
import * as path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { VaultFileOperations } from "@workshop/host-node";

export const FILE_ROUTES = new Set([
  "POST /api/files/note",
  "POST /api/files/folder",
  "POST /api/files/rename",
  "POST /api/files/delete",
]);

export interface FileRoutesState {
  /** The open vaults, by path. */
  readonly openVaults: () => readonly string[];
  readonly files: VaultFileOperations;
  /** Put a file or folder in the system's trash; false when there is none. */
  readonly trash: (file: string) => Promise<boolean>;
}

/** The answer to one of `FILE_ROUTES`, from its JSON body. */
export async function answerFileRoute(
  route: string,
  body: unknown,
  state: FileRoutesState,
): Promise<unknown> {
  const request = new FileRequest(body, state.openVaults());
  switch (route) {
    case "POST /api/files/note":
      await state.files.createNote(request.uri("path"));
      return { ok: true };
    case "POST /api/files/folder":
      await state.files.createFolder(request.uri("path"));
      return { ok: true };
    case "POST /api/files/rename": {
      const left = await state.files.rename(
        request.uri("from"),
        request.uri("to"),
      );
      return { notUpdated: left.map((uri) => request.relative(uri)) };
    }
    default:
      return deleteFile(request, state);
  }
}

/**
 * To the trash first; where there is none, nothing is deleted until the
 * window asks again with `permanently`, once the reader has confirmed.
 */
async function deleteFile(
  request: FileRequest,
  { files, trash }: FileRoutesState,
): Promise<{ deleted: boolean; trashed: boolean }> {
  const uri = request.uri("path");
  if (request.flag("permanently")) {
    await files.remove(uri);
    return { deleted: true, trashed: false };
  }
  if (await trash(await files.contain(uri))) {
    files.forget(uri);
    return { deleted: true, trashed: true };
  }
  return { deleted: false, trashed: false };
}

/** A request's vault and its paths in it, each checked as it is read. */
class FileRequest {
  private readonly vault: string;

  constructor(
    private readonly body: unknown,
    openVaults: readonly string[],
  ) {
    const vault = this.field("vault");
    if (!openVaults.includes(vault)) {
      throw new Error(`Not an open vault: ${vault}`);
    }
    this.vault = vault;
  }

  /** The file URI of the vault-relative path in `name`. */
  uri(name: string): string {
    const relative = this.field(name);
    const parts = relative.split("/");
    if (
      /[\\\0]/.test(relative) ||
      parts.some((part) => part === "" || part === "." || part === "..")
    ) {
      throw new Error(`Not a path inside the vault: ${relative}`);
    }
    return pathToFileURL(path.join(this.vault, ...parts)).toString();
  }

  /** A file URI back to vault-relative, with `/`. */
  relative(uri: string): string {
    return path
      .relative(this.vault, fileURLToPath(uri))
      .split(path.sep)
      .join("/");
  }

  flag(name: string): boolean {
    return (this.body as Record<string, unknown> | null)?.[name] === true;
  }

  private field(name: string): string {
    const value = (this.body as Record<string, unknown> | null)?.[name];
    if (typeof value !== "string" || value === "") {
      throw new Error(`Expected "${name}" in the request`);
    }
    return value;
  }
}

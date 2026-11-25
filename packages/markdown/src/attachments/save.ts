/**
 * Write attachment bytes into the vault's attachment folder under a unique
 * timestamp name. Callers supply the note's vault path and link settings so
 * the returned embed follows Obsidian's rules.
 */
import { lookupKey } from "../shared/vault-path";
import { joinContained, walksSymbolicLink } from "../shared/workspace-path";
import type { WorkspaceFiles } from "../shared/workspace-files";
import { embedFor, type EmbedLink } from "./embed";
import { resolveAttachmentDir } from "./folder";
import { uniqueName, uniqueTimestampName } from "./naming";
import { t } from "@workshop/l10n";

export interface SaveAttachmentInput {
  readonly files: Pick<
    WorkspaceFiles,
    "list" | "mkdir" | "createText" | "createBytes" | "isSymbolicLink"
  >;
  /** The vault's root URI. */
  readonly root: string;
  /** The note's vault-relative path. */
  readonly notePath: string;
  readonly attachmentFolder: string;
  readonly useWikilinks: boolean;
  readonly format: EmbedLink["format"];
  /** Extension without a required leading dot (`png`, `tar.gz`). */
  readonly ext: string;
  readonly bytes?: Uint8Array;
  readonly text?: string;
  readonly now?: Date;
  /**
   * The file's name without its extension (a downloaded `photo`), made
   * unique as `photo 1`; without it, the name is a timestamp.
   */
  readonly stem?: string;
  /** Existing vault paths, for shortest-link uniqueness. */
  readonly vaultPaths?: readonly string[];
}

export interface SavedAttachment {
  /** Vault-relative path of the written file. */
  readonly path: string;
  /** Embed markdown/wikilink to insert in the note. */
  readonly embed: string;
  /** Whether no other vault file has its name (for more embeds of it). */
  readonly isNameUnique: boolean;
}

/** Names tried before giving up when other writers keep taking them. */
const CREATE_ATTEMPTS = 100;

/**
 * Write one attachment; undefined when the folder or write fails containment,
 * or when a symbolic link is on the way: it could lead out of the vault.
 */
export async function saveAttachment(
  input: SaveAttachmentInput,
): Promise<SavedAttachment | undefined> {
  const folder = resolveAttachmentDir(input.attachmentFolder, input.notePath);
  const folderUri = folder ? joinContained(input.root, folder) : input.root;
  if (!folderUri || (folder && (await followsLink(input, folder)))) {
    return undefined;
  }
  if (!input.bytes && typeof input.text !== "string") {
    return undefined;
  }
  const existing = await input.files.list(folderUri);
  if (!existing) {
    await input.files.mkdir(folderUri);
  }
  const path = await createUnique(input, folder, existing ?? []);
  if (!path) {
    return undefined;
  }
  const key = lookupKey(path);
  const vaultPaths = input.vaultPaths ?? [];
  const isNameUnique = !vaultPaths.some(
    (other) => other !== path && lookupKey(other) === key,
  );
  return {
    path,
    isNameUnique,
    embed: embedFor({
      path,
      notePath: input.notePath,
      useWikilinks: input.useWikilinks,
      format: input.format,
      isNameUnique,
    }),
  };
}

/**
 * Create the attachment under the first free name. The listing is only a
 * guess: a file made since, or one an unreadable listing left out, is
 * still there, so the write is create-only and a taken name moves on to
 * the next one instead of replacing that file.
 */
async function createUnique(
  input: SaveAttachmentInput,
  folder: string,
  listed: readonly string[],
): Promise<string | undefined> {
  const taken = [...listed];
  for (let attempt = 0; attempt < CREATE_ATTEMPTS; attempt++) {
    const name = nextName(input, taken);
    const path = folder ? `${folder}/${name}` : name;
    const uri = joinContained(input.root, path);
    if (!uri || (await followsLink(input, path))) {
      return undefined;
    }
    if (await create(input, uri)) {
      return path;
    }
    taken.push(name);
  }
  throw new Error(
    folder
      ? t("Could not find a free name for the attachment in {0}.", folder)
      : t("Could not find a free name for the attachment in the vault."),
  );
}

function nextName(input: SaveAttachmentInput, taken: readonly string[]) {
  return input.stem === undefined
    ? uniqueTimestampName(input.ext, taken, input.now)
    : uniqueName(input.stem, input.ext.replace(/^\./u, ""), taken);
}

function create(
  { files, bytes, text }: SaveAttachmentInput,
  uri: string,
): Promise<boolean> {
  // saveAttachment returned before this when there is neither.
  return bytes ? files.createBytes(uri, bytes) : files.createText(uri, text!);
}

function followsLink(
  { files, root }: SaveAttachmentInput,
  relative: string,
): Promise<boolean> {
  return walksSymbolicLink(relative, root, (uri) => files.isSymbolicLink(uri));
}

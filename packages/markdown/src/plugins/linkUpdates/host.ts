import type { Plugin } from "@workshop/core";
import type { FileTextEdits, HostServices } from "../../shared/host";
import { vaultLinks } from "../../markdown/metadata/linkpaths";
import type { Vault, VaultFile, Vaults } from "../vault/api";
import type {} from "../editor/api";
import { changedLinks, rewriteLinks } from "./rewrite";
import { sourceText } from "./source-text";
import { registerRenameHeading } from "./rename-heading";
import { rewriteCanvas, wholeTextEdit } from "./canvas";

export { sourceText };
import type { LinkFormat, RewriteContext } from "./rewrite";

/** Rewrites links in other notes when files are renamed in VS Code. */
export const linkUpdatesHost: Plugin = {
  name: "linkUpdates",
  inject: {
    required: [
      "settings",
      "vaults",
      "hostDocuments",
      "dialogs",
      "hostCommands",
    ],
    optional: ["editors"],
  },
  apply(ctx) {
    registerRenameHeading(ctx, {
      editors: ctx.editors,
      dialogs: ctx.dialogs,
      vaults: ctx.vaults,
      hostDocuments: ctx.hostDocuments,
    });
    ctx.effect(() =>
      ctx.hostDocuments.onWillRename((renames) => renameEdits(ctx, renames)),
    );
  },
};

type RenameHost = Pick<
  HostServices,
  "settings" | "hostDocuments" | "dialogs"
> & {
  vaults: Vaults;
};

type Renames = readonly { oldUri: string; newUri: string }[];

/** The link edits VS Code applies together with a rename, per `linkUpdates.mode`. */
async function renameEdits(
  host: RenameHost,
  renames: Renames,
): Promise<FileTextEdits[]> {
  const resource = renames[0]?.oldUri;
  if (resource) {
    await host.settings.effective.prepare(resource);
  }
  const mode = host.settings.get<string>(
    "linkUpdates.mode",
    "prompt",
    resource,
  );
  if (mode === "never") {
    return [];
  }
  if (mode === "prompt" && !(await askToUpdate(host, renames, resource))) {
    return [];
  }
  // Built after the answer: a note edited while the dialog was open is
  // rewritten as it is now, not as it was when the rename started.
  const { edits, unchecked } = await linkEdits(host.vaults, host, renames);
  if (unchecked.length > 0) {
    host.dialogs.error(uncheckedMessage(unchecked));
  }
  return edits;
}

/** Names what a rename could not check, so the user can fix those links. */
function uncheckedMessage(unchecked: readonly string[]): string {
  const shown = unchecked.slice(0, 5).join(", ");
  const more = unchecked.length > 5 ? ` and ${unchecked.length - 5} more` : "";
  return (
    `Links were not checked in ${unchecked.length} ` +
    `note${unchecked.length === 1 ? "" : "s"} the vault was still ` +
    `indexing: ${shown}${more}. Check them for links to the renamed file.`
  );
}

/** Asks unless nothing would change; "Always" also stops asking for this resource. */
async function askToUpdate(
  host: RenameHost,
  renames: Renames,
  resource: string | undefined,
): Promise<boolean> {
  const files = await affectedNoteCount(host, renames);
  if (files === 0) {
    return false;
  }
  const update = "Update Links";
  const always = "Always Update";
  const answer = await host.dialogs.ask(
    `Update links in ${files} file${files === 1 ? "" : "s"}?`,
    [update, always, "Don't Update"],
  );
  if (answer === always) {
    // Per vault, as Obsidian's `alwaysUpdateLinks`: a user-wide value would
    // rewrite links in every other vault without asking.
    await host.settings.access.update(
      "linkUpdates.mode",
      "always",
      resource,
      "workspaceFolder",
    );
  }
  return answer === update || answer === always;
}

/**
 * How long a rename waits for the index. VS Code cancels will-rename
 * participants after `files.participants.timeout` (60 s by default), and the
 * prompt must fit in that time too, so a slow scan gives up well before it.
 */
const SETTLE_LIMIT_MS = 5_000;

/** Waits until the vault has indexed what is queued, or `limitMs` passes. */
export async function settledWithin(
  vault: Pick<Vault, "settled">,
  limitMs: number,
): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const limit = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, limitMs);
  });
  try {
    await Promise.race([vault.settled(), limit]);
  } finally {
    clearTimeout(timer);
  }
}

/** The vault of the renamed files, and old → new vault paths for each of them. */
interface RenamePlan {
  vault: Vault;
  paths: Map<string, string>;
}

/** What a rename touches, once the index has caught up; `undefined` if nothing in a vault. */
async function planRename(
  vaults: Vaults,
  renames: Renames,
): Promise<RenamePlan | undefined> {
  const first = renames[0] ? await vaults.locate(renames[0].oldUri) : undefined;
  if (!first) {
    return undefined;
  }
  const { vault } = first;
  // Backlinks and folder contents come from the index; a note still queued
  // for parsing would otherwise keep its link to the old path.
  await settledWithin(vault, SETTLE_LIMIT_MS);
  const paths = expandFolders(vault, renames);
  return paths.size === 0 ? undefined : { vault, paths };
}

const resolverOf =
  (vault: Vault): RewriteContext["resolve"] =>
  (linkpath, source, syntax) =>
    vault.index.resolveLink(linkpath, source, syntax)?.path;

/**
 * The notes a rename can change: the renamed ones, for their own links,
 * those linking to them, and every note the index has not parsed yet (the
 * settle gave up first), whose links only its text can tell. Canvases are
 * never in the index's backlinks, so each one is a candidate.
 */
function candidateNotes(vault: Vault, paths: Map<string, string>): VaultFile[] {
  const sources = new Set<string>(paths.keys());
  for (const path of paths.keys()) {
    vault.index.backlinks(path).forEach((link) => sources.add(link.path));
  }
  for (const file of vault.index.files()) {
    if (isUnparsedNote(vault, file) || file.extension === "canvas") {
      sources.add(file.path);
    }
  }
  return [...sources]
    .map((source) => vault.index.file(source))
    .filter(
      (file): file is VaultFile =>
        file?.extension === "md" || file?.extension === "canvas",
    );
}

function isUnparsedNote(vault: Vault, file: VaultFile): boolean {
  return (
    file.extension === "md" && vault.index.metadata(file.path) === undefined
  );
}

/** Whether only the file's text, not the index, can tell its links. */
function needsText(vault: Vault, file: VaultFile): boolean {
  return file.extension === "canvas" || isUnparsedNote(vault, file);
}

/**
 * How many notes the rename would change. Parsed notes are counted from the
 * links the index already has, so the prompt costs a lookup per link, not a
 * read and rewrite of each note. A note the index has not parsed (its parse
 * was still queued when the settle gave up) and a canvas are read, so the
 * prompt still asks when they have links to change.
 */
async function affectedNoteCount(
  host: Pick<RenameHost, "settings" | "hostDocuments" | "vaults">,
  renames: Renames,
): Promise<number> {
  const plan = await planRename(host.vaults, renames);
  if (!plan) {
    return 0;
  }
  const { vault, paths } = plan;
  const candidates = candidateNotes(vault, paths);
  const context = { renames: paths, resolve: resolverOf(vault) };
  const indexed = candidates.filter((file) => {
    const parsed = needsText(vault, file)
      ? undefined
      : vault.index.metadata(file.path);
    return (
      parsed !== undefined &&
      changedLinks(vaultLinks(parsed), file.path, context).length > 0
    );
  }).length;
  const read = candidates.filter((file) => needsText(vault, file));
  if (read.length === 0) {
    return indexed;
  }
  const { edits } = await textEdits(host, plan, read, renames);
  return indexed + edits.length;
}

/**
 * How long reading notes the index has not parsed may take, so the rename
 * stays inside VS Code's participant timeout (60 s) with the prompt. Notes
 * left when it runs out are reported as unchecked.
 */
const UNPARSED_SCAN_LIMIT_MS = 20_000;

interface LinkEditResult {
  edits: FileTextEdits[];
  /** Vault paths of unparsed notes not read in time. */
  unchecked: string[];
}

/** Edits for every note and canvas in the renamed files' vault that links to them. */
async function linkEdits(
  vaults: Vaults,
  host: Pick<HostServices, "settings" | "hostDocuments">,
  renames: Renames,
): Promise<LinkEditResult> {
  const plan = await planRename(vaults, renames);
  if (!plan) {
    return { edits: [], unchecked: [] };
  }
  // Named one by one: the plugin context's services are getters, which a
  // spread would not copy.
  return textEdits(
    { settings: host.settings, hostDocuments: host.hostDocuments, vaults },
    plan,
    candidateNotes(plan.vault, plan.paths),
    renames,
  );
}

/** Reads each file's current text and rewrites its links. */
async function textEdits(
  host: Pick<RenameHost, "settings" | "hostDocuments" | "vaults">,
  { vault, paths }: RenamePlan,
  files: readonly VaultFile[],
  renames: Renames,
): Promise<LinkEditResult> {
  const context: RewriteContext = {
    renames: paths,
    resolve: resolverOf(vault),
    pathsAfter: vault.index
      .files()
      .map((file) => paths.get(file.path) ?? file.path),
    format: host.settings.get<LinkFormat>(
      "links.newLinkFormat",
      "shortest",
      renames[0]?.oldUri,
    ),
  };
  const result: LinkEditResult = { edits: [], unchecked: [] };
  const deadline = Date.now() + UNPARSED_SCAN_LIMIT_MS;
  for (const file of files) {
    if (isUnparsedNote(vault, file) && Date.now() > deadline) {
      result.unchecked.push(file.path);
      continue;
    }
    const text = await sourceText(host.vaults, host.hostDocuments, file.uri);
    const edits = fileEdits(text, file, context);
    if (edits.length > 0) {
      result.edits.push({ uri: file.uri, edits });
    }
  }
  return result;
}

function fileEdits(
  text: string,
  file: VaultFile,
  context: RewriteContext,
): FileTextEdits["edits"] {
  if (file.extension !== "canvas") {
    return rewriteLinks(text, file.path, context);
  }
  const next = rewriteCanvas(text, file.path, context);
  return next === undefined ? [] : [wholeTextEdit(text, next)];
}

/**
 * Old → new vault paths for the renamed files in this vault. VS Code
 * reports a folder once, so its files are listed from the index.
 */
function expandFolders(
  vault: Vault,
  renames: readonly { oldUri: string; newUri: string }[],
): Map<string, string> {
  const paths = new Map<string, string>();
  for (const { oldUri, newUri } of renames) {
    const oldPath = vault.pathOf(oldUri);
    const newPath = vault.pathOf(newUri);
    if (oldPath === undefined || newPath === undefined) {
      continue;
    }
    if (vault.index.file(oldPath)) {
      paths.set(oldPath, newPath);
      continue;
    }
    for (const file of vault.index.files()) {
      if (file.path.startsWith(`${oldPath}/`)) {
        paths.set(file.path, newPath + file.path.slice(oldPath.length));
      }
    }
  }
  return paths;
}

import type { Plugin } from "@workshop/core";
import type { FileTextEdits, HostServices } from "../../shared/host";
import { vaultLinks } from "../../markdown/metadata/linkpaths";
import { isMarkdownPath } from "../../shared/vault-path";
import type { Vault, VaultFile, Vaults } from "../vault/api";
import type {} from "../editor/api";
import { changesLinkText, rewriteLinks } from "./rewrite";
import { sourceText } from "./source-text";
import { registerRenameHeading } from "./rename-heading";
import { rewriteCanvas, wholeTextEdit } from "./canvas";
import { t } from "@workshop/l10n";

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
  const plan = await planRename(host.vaults, renames);
  if (!plan) {
    return [];
  }
  const scan = newScan();
  if (mode === "prompt") {
    const count = await affectedNoteCount(host, plan, renames, scan);
    if (count.files === 0) {
      // Nothing to ask about, but the notes it could not read may still
      // link to the renamed file.
      reportUnchecked(host, count.unchecked);
      return [];
    }
    if (!(await askToUpdate(host, count.files, resource))) {
      return [];
    }
  }
  // Built after the answer: a note edited while the dialog was open is
  // rewritten as it is now, not as it was when the rename started.
  const candidates = candidateNotes(plan.vault, plan.paths);
  const { edits, unchecked } = await textEdits(host, plan, {
    files: candidates,
    renames,
    scan,
  });
  reportUnchecked(host, unchecked);
  return edits;
}

function reportUnchecked(
  host: Pick<RenameHost, "dialogs">,
  unchecked: readonly string[],
): void {
  if (unchecked.length > 0) {
    host.dialogs.error(uncheckedMessage(unchecked));
  }
}

/** Names what a rename could not check, so the user can fix those links. */
function uncheckedMessage(unchecked: readonly string[]): string {
  const shown = unchecked.slice(0, 5).join(", ");
  if (unchecked.length === 1) {
    return t(
      "Links were not checked in 1 file still being indexed or unreadable: {0}. Check them for links to the renamed file.",
      shown,
    );
  }
  if (unchecked.length <= 5) {
    return t(
      "Links were not checked in {0} files still being indexed or unreadable: {1}. Check them for links to the renamed file.",
      unchecked.length,
      shown,
    );
  }
  return t(
    "Links were not checked in {0} files still being indexed or unreadable: {1} and {2} more. Check them for links to the renamed file.",
    unchecked.length,
    shown,
    unchecked.length - 5,
  );
}

/** Asks the user; "Always Update" also stops asking in this vault. */
async function askToUpdate(
  host: RenameHost,
  files: number,
  resource: string | undefined,
): Promise<boolean> {
  // The buttons are translated, so the answer is compared with the same text.
  const update = t("Update Links");
  const always = t("Always Update");
  const answer = await host.dialogs.ask(
    files === 1
      ? t("Update links in 1 file?")
      : t("Update links in {0} files?", files),
    [update, always, t("Don't Update")],
  );
  if (answer === always) {
    await rememberAlwaysUpdate(host, resource);
  }
  return answer === update || answer === always;
}

/**
 * Saves `always` per vault, as Obsidian's `alwaysUpdateLinks`: a user-wide
 * value would rewrite links in every other vault without asking. An explicit
 * value wins over `.obsidian/app.json` (never written). A save that fails (a
 * settings file with errors) is reported, and the links are still updated as
 * asked: a rejection here would drop all of the rename's link edits.
 */
async function rememberAlwaysUpdate(
  host: Pick<RenameHost, "settings" | "dialogs">,
  resource: string | undefined,
): Promise<void> {
  try {
    await host.settings.access.update(
      "linkUpdates.mode",
      "always",
      resource,
      "workspaceFolder",
    );
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    host.dialogs.error(
      t(
        'Lumiere could not save "Always Update" ({0}). The links are updated this time.',
        reason,
      ),
    );
  }
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
        file !== undefined &&
        (isMarkdownPath(file.path) || file.extension === "canvas"),
    );
}

/**
 * Whether `file` is a note the index has not parsed yet. Notes are what the
 * index parses: `.md` and `.markdown`, in any case.
 */
function isUnparsedNote(vault: Vault, file: VaultFile): boolean {
  return (
    isMarkdownPath(file.path) && vault.index.metadata(file.path) === undefined
  );
}

/** Whether only the file's text, not the index, can tell its links. */
function needsText(vault: Vault, file: VaultFile): boolean {
  return file.extension === "canvas" || isUnparsedNote(vault, file);
}

/**
 * How many notes the rename would change, and the files it could not read
 * to tell. Parsed notes are counted from the links the index already has,
 * so the prompt costs a lookup per link, not a read and rewrite of each
 * note. A note the index has not parsed (its parse was still queued when
 * the settle gave up) and a canvas are read, so the prompt still asks when
 * they have links to change.
 */
async function affectedNoteCount(
  host: Pick<RenameHost, "settings" | "hostDocuments" | "vaults">,
  plan: RenamePlan,
  renames: Renames,
  scan: RenameScan,
): Promise<{ files: number; unchecked: string[] }> {
  const { vault, paths } = plan;
  const candidates = candidateNotes(vault, paths);
  const context = rewriteContext(host, plan, renames);
  const indexed = candidates.filter((file) => {
    const parsed = needsText(vault, file)
      ? undefined
      : vault.index.metadata(file.path);
    return (
      parsed !== undefined &&
      changesLinkText(vaultLinks(parsed), file.path, context)
    );
  }).length;
  const read = candidates.filter((file) => needsText(vault, file));
  if (read.length === 0) {
    return { files: indexed, unchecked: [] };
  }
  const { edits, unchecked } = await textEdits(host, plan, {
    files: read,
    renames,
    scan,
  });
  return { files: indexed + edits.length, unchecked };
}

/**
 * How long reading the files the index cannot answer for (unparsed notes
 * and canvases) may take, in total for the prompt's count and the rewrite,
 * so the rename stays inside VS Code's participant timeout (60 s) with the
 * settle and the prompt. Files left when it runs out are reported as
 * unchecked.
 */
const UNPARSED_SCAN_LIMIT_MS = 20_000;

/** What reading files for one rename shares between the count and the rewrite. */
interface RenameScan {
  deadline: number;
  /**
   * Texts of closed files read for the count, by vault path. The rewrite
   * reuses them rather than reading each file again; an open note is
   * always read from its document, which is cheap and may have changed.
   */
  texts: Map<string, string>;
}

function newScan(): RenameScan {
  return { deadline: Date.now() + UNPARSED_SCAN_LIMIT_MS, texts: new Map() };
}

interface LinkEditResult {
  edits: FileTextEdits[];
  /** Vault paths of files not read in time, or that failed to read or parse. */
  unchecked: string[];
}

/** What rewriting links needs to know about this rename. */
function rewriteContext(
  host: Pick<RenameHost, "settings">,
  { vault, paths }: RenamePlan,
  renames: Renames,
): RewriteContext {
  return {
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
}

/** Reads each file's current text and rewrites its links. */
async function textEdits(
  host: Pick<RenameHost, "settings" | "hostDocuments" | "vaults">,
  plan: RenamePlan,
  {
    files,
    renames,
    scan,
  }: { files: readonly VaultFile[]; renames: Renames; scan: RenameScan },
): Promise<LinkEditResult> {
  const { vault } = plan;
  const context = rewriteContext(host, plan, renames);
  const result: LinkEditResult = { edits: [], unchecked: [] };
  for (const file of files) {
    try {
      const text = await scannedText(host, vault, file, scan);
      if (text === undefined) {
        result.unchecked.push(file.path);
        continue;
      }
      const edits = fileEdits(text, file, context);
      if (edits.length > 0) {
        result.edits.push({ uri: file.uri, edits, source: text });
      }
    } catch {
      // One file that cannot be read or parsed must not fail the whole
      // rename, which would leave every link unchanged without a word.
      result.unchecked.push(file.path);
    }
  }
  return result;
}

/**
 * A file's text for the rewrite, or `undefined` when the scan's time ran
 * out before a file only its text can answer for was read.
 */
async function scannedText(
  host: Pick<RenameHost, "hostDocuments" | "vaults">,
  vault: Vault,
  file: VaultFile,
  scan: RenameScan,
): Promise<string | undefined> {
  const open = host.hostDocuments.text(file.uri);
  if (open !== undefined) {
    return open;
  }
  if (!needsText(vault, file)) {
    return host.vaults.text(file.uri);
  }
  const read = scan.texts.get(file.path);
  if (read !== undefined) {
    return read;
  }
  if (Date.now() > scan.deadline) {
    return undefined;
  }
  const text = await host.vaults.text(file.uri);
  scan.texts.set(file.path, text);
  return text;
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

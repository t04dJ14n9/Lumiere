import type { HostServices } from "../../shared/host";
import { linkLocation } from "../../shared/link-location";
import { isHtmlPath } from "../../shared/html-file";
import { mediaKind } from "../../shared/media-kinds";
import {
  extensionOf,
  folderOf,
  joinVaultPath,
  splitLinktext,
  splitMarkdownDestination,
  type LinkSyntax,
} from "../../shared/vault-path";
import type { VaultChange, VaultFile, VaultIndex } from "../vault/api";
import { RecentlyUsed } from "../../shared/recently-used";
import type { Resource, Resources } from "./api";
import { BaseSnapshots } from "./base-snapshot";
import { containedResource, contains } from "./containment";

interface ResourceOptions {
  source: string;
  vault: VaultIndex;
  host: Pick<HostServices, "workspace" | "hostDocuments">;
  resourceUrl(uri: string): string;
}

/** A file a link names: its vault path and URI. */
type LinkedFile = Pick<VaultFile, "path" | "uri">;

/** A link a note shows, as `load` receives it. */
interface ResourceLink {
  target: string;
  source: string;
  syntax: LinkSyntax;
}

/** Links remembered as missing at most; the oldest are forgotten first. */
const MISSING_LIMIT = 256;
/** Files remembered as shown at most; the least recently loaded go first. */
const SHOWN_LIMIT = 1024;

export class NoteResources implements Resources {
  private readonly known: Set<string>;
  /** Links whose file the vault did not have when asked, by `linkKey`. */
  private readonly missing = new Map<string, ResourceLink>();
  /** The files the page loaded, by vault path: their URIs. */
  private readonly shown = new RecentlyUsed<string, string>(SHOWN_LIMIT);
  private readonly bases: BaseSnapshots;
  constructor(private readonly options: ResourceOptions) {
    this.known = new Set([options.source]);
    this.bases = new BaseSnapshots(options.vault);
  }

  async authorize(source: string): Promise<void> {
    this.assertKnown(source);
    await this.containedStat(source);
  }

  async authorizeTarget(target: string): Promise<void> {
    await this.containedStat(target);
  }

  /** The vault changed: base embeds need a new snapshot. */
  vaultChanged(): void {
    this.bases.invalidate();
  }

  async load(
    target: string,
    source = this.options.source,
    syntax: LinkSyntax = "markdown",
    snapshot?: number,
  ): Promise<Resource> {
    this.assertKnown(source);
    if (/^[a-z][a-z\d+.-]*:/i.test(target) || target.startsWith("//")) {
      throw new Error("Resource must be a vault link");
    }
    const { vault, resourceUrl } = this.options;
    const link = { target, source, syntax };
    const file =
      this.locate(link) ??
      (await this.locateSource(link)) ??
      (await this.locateOnDisk(link));
    if (!file) {
      this.rememberMissing(link);
      throw new Error("Resource not found");
    }
    this.missing.delete(linkKey(link));
    this.shown.set(file.path, file.uri);
    const stat = await this.containedStat(file.uri);
    const kind = resourceKind(file.path);
    const text =
      kind === "note" || kind === "base"
        ? await this.readNote(file.uri)
        : undefined;
    if (kind === "note" || kind === "base") {
      this.known.add(file.uri);
    }
    const baseSnapshot =
      kind === "base"
        ? this.bases.reply(vaultPath(vault.root, source), snapshot)
        : undefined;
    return {
      kind,
      source: file.uri,
      url: (() => {
        const base = resourceUrl(file.uri);
        return `${base}${base.includes("?") ? "&" : "?"}v=${stat.mtime}`;
      })(),
      ...(text === undefined ? {} : { text }),
      ...(baseSnapshot ?? {}),
    };
  }

  /**
   * Forget the missing links that resolve now, as when their file arrives
   * after the note asked (synced, or written by another app or a plugin).
   * True when there were any.
   */
  takeFound(): boolean {
    let isFound = false;
    for (const [key, link] of this.missing) {
      if (this.locate(link)) {
        this.missing.delete(key);
        isFound = true;
      }
    }
    return isFound;
  }

  /**
   * The URI of a file the page shows that this change rewrote (on disk, or
   * as unsaved text in an editor), moved or removed, so its embeds load it
   * again. A moved or removed file is forgotten until it is loaded again.
   */
  changedSource(change: VaultChange): string | undefined {
    if (change.type === "create") {
      return undefined;
    }
    const path = change.type === "rename" ? change.oldPath : change.path;
    const uri = this.shown.get(path);
    if (uri !== undefined && change.type !== "modify") {
      this.shown.delete(path);
    }
    return uri;
  }

  /** The vault file a link names, if the vault has it. */
  private locate({
    target,
    source,
    syntax,
  }: ResourceLink): VaultFile | undefined {
    const { vault } = this.options;
    // A Markdown destination is percent-encoded (`My%20image.png`), and the
    // vault resolves paths as the note's metadata keeps them: decoded.
    return vault.resolveLink(
      syntax === "markdown" ? splitMarkdownDestination(target).path : target,
      vaultPath(vault.root, source),
      syntax,
    );
  }

  /**
   * A link with only a fragment (`#Part`, `[[#Part]]`) names the note it is
   * in. The index answers for a note it lists; a hidden note it never
   * entered (`/.raw/captured/page.md`, loaded by its rooted path) would
   * otherwise have no answer, and its links to its own headings said
   * "Resource not found". The source is a note this panel loaded or showed,
   * so `assertKnown` has checked it, and `load` still checks the file.
   */
  private async locateSource(
    link: ResourceLink,
  ): Promise<LinkedFile | undefined> {
    if (linkPath(link) !== "" || !(await this.exists(link.source))) {
      return undefined;
    }
    return {
      path: vaultPath(this.options.vault.root, link.source),
      uri: link.source,
    };
  }

  /**
   * A Markdown link the index does not know, looked for where a click on it
   * looks (`linkLocation`, in its order): a leading `/` from the vault root,
   * `./` and `../` from the note's folder, a bare name beside the note and
   * then at the vault root. The index never enters hidden folders, so
   * `[source](/.raw/captured/page.md)` opened on a click while its preview
   * and embed said "Resource not found". `load` still checks that the file
   * is inside the vault, through symbolic links too.
   */
  private async locateOnDisk({
    target,
    source,
    syntax,
  }: ResourceLink): Promise<LinkedFile | undefined> {
    if (syntax !== "markdown") {
      return undefined;
    }
    const link = splitMarkdownDestination(target).path;
    // A folder is no resource, and the host's stat cannot tell one apart.
    if (!extensionOf(link)) {
      return undefined;
    }
    const { root } = this.options.vault;
    const { relative, folders } = linkLocation(link);
    const sourceFolder = folderOf(vaultPath(root, source));
    for (const folder of folders) {
      const path = joinVaultPath(
        folder === "vault" ? "" : sourceFolder,
        relative,
      );
      if (!path) {
        continue;
      }
      const uri = uriInVault(root, path);
      if (await this.exists(uri)) {
        return { path, uri };
      }
    }
    return undefined;
  }

  private async exists(uri: string): Promise<boolean> {
    try {
      await this.options.host.workspace.stat(uri);
      return true;
    } catch {
      return false;
    }
  }

  private rememberMissing(link: ResourceLink): void {
    const key = linkKey(link);
    this.missing.delete(key);
    this.missing.set(key, link);
    if (this.missing.size > MISSING_LIMIT) {
      this.missing.delete(this.missing.keys().next().value!);
    }
  }

  private assertKnown(source: string): void {
    if (!this.known.has(source) || !contains(this.options.vault.root, source)) {
      throw new Error("Unknown note source");
    }
  }

  private async containedStat(source: string) {
    const { host, vault } = this.options;
    const { workspace } = host;
    const stat = await workspace.stat(source);
    const realContains = workspace.realContains?.bind(workspace);
    await containedResource(vault.root, source, stat.symbolicLink, {
      inspect: (uri) => workspace.stat(uri),
      ...(realContains ? { realContains } : {}),
    });
    return stat;
  }

  private async readNote(uri: string): Promise<string> {
    const text = (await this.options.host.hostDocuments.open(uri)).getText();
    return text.replace(/\r\n/g, "\n");
  }
}

/** The path a link names, without its `#subpath`: empty for `#Part`. */
function linkPath({ target, syntax }: ResourceLink): string {
  return syntax === "markdown"
    ? splitMarkdownDestination(target).path
    : splitLinktext(target).path;
}

function linkKey({ target, source, syntax }: ResourceLink): string {
  return `${syntax}\0${source}\0${target}`;
}

/** The URI of a path inside the vault, each name percent-encoded. */
function uriInVault(root: string, path: string): string {
  const names = path.split("/").map((name) => encodeURIComponent(name));
  return `${root.replace(/\/+$/, "")}/${names.join("/")}`;
}

/** A note's path inside the vault, from its URI. */
function vaultPath(root: string, uri: string): string {
  return decodeURIComponent(new URL(uri).pathname).slice(
    decodeURIComponent(new URL(root).pathname).replace(/\/$/, "").length + 1,
  );
}

export function resourceKind(path: string): Resource["kind"] {
  if (/\.(?:md|markdown)$/i.test(path)) {
    return "note";
  }
  if (/\.base$/i.test(path)) {
    return "base";
  }
  if (/\.pdf$/i.test(path)) {
    return "pdf";
  }
  if (isHtmlPath(path)) {
    return "html";
  }
  return mediaKind(path) ?? "file";
}

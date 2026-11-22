import { RevealRouter, chooseRevealPanel } from "./reveal-router";
import linksManifest from "../plugins/links/manifest";
import { pluginConfiguration } from "./settings";
import type { Configuration } from "../shared/configuration";
import { createConfiguration } from "./configuration-access";
import * as vscode from "vscode";
import { silentLogger } from "@workshop/core";
import type { Logger } from "@workshop/core";
import type {
  Navigation,
  OpenPlace,
  NavigationTarget,
  NavigationIntent,
  PanelShell,
} from "../shared/host";
import { warmMarkdownDocument } from "./document-warm";
import { contained } from "./navigation-containment";
import { openExternalLink } from "./external-link";
import { registerNativeLinks } from "./native-links";
import { MARKDOWN_EDITOR } from "../shared/editor-provider";
import { openedInIntegratedBrowser } from "./integrated-browser-route";
import {
  creationLocation,
  followsNewNoteFolder,
  linkLocation,
  type LinkFolder,
} from "../shared/link-location";

export { contained };

export type OffsetRevealTarget =
  number | { at: number; to?: number; preserveFocus?: boolean };

function toOffsetTarget(target: OffsetRevealTarget): NavigationTarget {
  const at = typeof target === "number" ? target : target.at;
  const to = typeof target === "number" ? undefined : target.to;
  const preserveFocus =
    typeof target === "number" ? undefined : target.preserveFocus;
  return {
    fragment: "",
    at,
    ...(to !== undefined && to > at ? { to } : {}),
    ...(preserveFocus ? { preserveFocus: true } : {}),
  };
}

async function deliverToOpenedPanel(
  panels: () => readonly PanelShell[],
  reveals: RevealRouter,
  target: {
    uri: string;
    column: number;
    offset: OffsetRevealTarget;
    intent: NavigationIntent;
    logger: Logger;
  },
): Promise<void> {
  const current = panels();
  const panel = chooseRevealPanel(
    current,
    new Set(current.map((candidate) => candidate.id)),
    { uri: target.uri, side: false, column: target.column },
  );
  if (!panel) {
    target.logger.warn(
      "No single editor of the opened note to reveal in",
      target.uri,
    );
    return;
  }
  await reveals.deliver(target.intent, panel.id, toOffsetTarget(target.offset));
}

/** What an open asks beyond where it goes: not to take the focus, to open as text. */
function openFlags(
  options: Parameters<Navigation["open"]>[6],
): Pick<OpenNavigation, "preserveFocus" | "asText"> {
  return {
    ...(options?.preserveFocus ? { preserveFocus: true } : {}),
    ...(options?.asText ? { asText: true } : {}),
  };
}

export function createNavigation(
  panels: () => readonly PanelShell[],
  configuration: Configuration = createConfiguration(),
  logger: Logger = silentLogger,
): NativeNavigation {
  const reveals = new RevealRouter(logger);
  const navigation: NativeNavigation = {
    begin: () => reveals.begin(),
    registerReveal: (panel) => reveals.register(panel),
    revealOpened: (uri, column, offset, intent) =>
      deliverToOpenedPanel(panels, reveals, {
        uri,
        column,
        offset,
        intent,
        logger,
      }),
    revealPanel: (panelId, offset, intent = reveals.begin()) =>
      reveals.deliver(intent, panelId, toOffsetTarget(offset)),
    scheme: vscode.env.uriScheme,
    external: async (href) => openExternalLink(vscode.env, href),
    confirm: async (message) =>
      (await vscode.window.showWarningMessage(
        message,
        { modal: true },
        "Open",
      )) === "Open",
    async resolve(request) {
      await configuration.prepare(request.source);
      return resolveNavigation({
        ...request,
        newNoteFolder:
          request.newNoteFolder ??
          configuredNewNoteFolder(configuration, request.source),
      });
    },
    open: (
      ...[root, target, fragment, place, at, intent, options]: Parameters<
        Navigation["open"]
      >
    ) =>
      openNavigation({
        root,
        target,
        fragment,
        place,
        ...(at === undefined ? {} : { at }),
        panels,
        reveals,
        intent: intent ?? reveals.begin(),
        logger,
        ...openFlags(options),
      }),
    registerNativeLinks() {
      const links = registerNativeLinks(navigation);
      return () => links.dispose();
    },
  };
  return navigation;
}

/** Native text-to-custom transfers already opened the destination in this group. */
export interface NativeNavigation extends Navigation {
  begin(): NavigationIntent;
  revealOpened(
    uri: string,
    column: number,
    at: OffsetRevealTarget,
    intent: NavigationIntent,
  ): Promise<void>;
  revealPanel?(
    panelId: string,
    target: OffsetRevealTarget,
    intent?: NavigationIntent,
  ): Promise<boolean | void>;
}

/**
 * The folder links in `sourceUri` are relative to: a note's parent. The
 * Quick Switcher, with no note open, names the vault itself as the source,
 * by a folder URI (`file:///vault/`), which is its own folder; its parent
 * would be above the vault.
 */
function sourceFolderOf(sourceUri: vscode.Uri): vscode.Uri {
  return sourceUri.path.endsWith("/")
    ? sourceUri
    : vscode.Uri.joinPath(sourceUri, "..");
}

/** `relative` inside the vault root or the source note's folder. */
function inFolder(
  folder: LinkFolder,
  relative: string,
  places: { base: vscode.Uri; sourceUri: vscode.Uri },
): vscode.Uri {
  const parent =
    folder === "vault" ? places.base : sourceFolderOf(places.sourceUri);
  return vscode.Uri.joinPath(parent, relative);
}

/**
 * The places an existing file a link names may be, in the order
 * `linkLocation` tries them: the order a preview looks in too, whether or
 * not the click may create the note. A place two folders share (a note at
 * the vault root, whose folder is the vault) is asked about once.
 */
function linkCandidates(
  link: string,
  base: vscode.Uri,
  sourceUri: vscode.Uri,
): vscode.Uri[] {
  if (!link) {
    return [sourceUri];
  }
  const { relative, folders } = linkLocation(link);
  const places = folders.map((folder) =>
    inFolder(folder, relative, { base, sourceUri }),
  );
  return places.filter(
    (place, at) =>
      places.findIndex((other) => other.toString() === place.toString()) === at,
  );
}

async function statIfPresent(
  uri: vscode.Uri,
): Promise<vscode.FileStat | undefined> {
  try {
    return await vscode.workspace.fs.stat(uri);
  } catch (error) {
    if (
      error instanceof vscode.FileSystemError &&
      error.code === "FileNotFound"
    ) {
      return undefined;
    }
    throw error;
  }
}

/** A folder opens its folder note, or is shown in the Explorer without one. */
async function existingTarget(
  base: vscode.Uri,
  found: { uri: vscode.Uri; stat: vscode.FileStat },
  folderNote: string,
): Promise<string | undefined> {
  const { uri, stat } = found;
  if (!(stat.type & vscode.FileType.Directory)) {
    return uri.toString();
  }
  if (!folderNote) {
    await vscode.commands.executeCommand("revealInExplorer", uri);
    return undefined;
  }
  const note = vscode.Uri.joinPath(uri, folderNote);
  await contained(base, note);
  return note.toString();
}

async function resolveNavigation({
  root,
  source,
  path: link,
  create,
  folderNote,
  newNoteFolder,
  intent,
}: Parameters<Navigation["resolve"]>[0]): Promise<string | undefined> {
  const base = vscode.Uri.parse(root);
  const sourceUri = vscode.Uri.parse(source);
  // Which existing file the link names does not depend on `create`; only a
  // link that names none may make a note.
  for (const uri of linkCandidates(link, base, sourceUri)) {
    await contained(base, uri);
    const stat = await statIfPresent(uri);
    if (intent?.token.cancelled) {
      return undefined;
    }
    if (stat) {
      return existingTarget(base, { uri, stat }, folderNote);
    }
  }
  if (!create) {
    return undefined;
  }
  return createNote({
    base,
    sourceUri,
    link,
    folder: newNoteFolder,
    ...(intent ? { intent } : {}),
  });
}

async function createNote({
  base,
  sourceUri,
  link,
  folder,
  intent,
}: {
  base: vscode.Uri;
  sourceUri: vscode.Uri;
  link: string;
  folder: string | undefined;
  intent?: NavigationIntent;
}): Promise<string | undefined> {
  folder ??= "";
  const place = creationLocation(link);
  let uri = inFolder(place.folder, place.relative, { base, sourceUri });
  // Basename-only links respect newNoteFolder; a path with folders (or a
  // leading "/") creates at the place it names, not under that setting.
  if (followsNewNoteFolder(link)) {
    const parent =
      folder === "."
        ? sourceFolderOf(sourceUri)
        : vscode.Uri.joinPath(base, folder);
    uri = vscode.Uri.joinPath(parent, link);
  }
  if (!/\.md$/i.test(uri.path)) {
    uri = uri.with({ path: uri.path + ".md" });
  }
  await contained(base, uri);
  if (intent?.token.cancelled) {
    return undefined;
  }
  const edit = new vscode.WorkspaceEdit();
  edit.createFile(uri, { ignoreIfExists: true });
  if (!(await vscode.workspace.applyEdit(edit))) {
    throw new Error("Could not create note");
  }
  return uri.toString();
}

interface OpenNavigation {
  root: string;
  target: string;
  fragment: string;
  place: OpenPlace;
  at?: number;
  panels: () => readonly PanelShell[];
  reveals: RevealRouter;
  intent: NavigationIntent;
  logger: Logger;
  /** Show the destination without moving the keyboard focus to it. */
  preserveFocus?: boolean;
  /** An HTML file opens in a text editor, not in the Integrated Browser. */
  asText?: boolean;
}

/** A bare column, or options where the tab must be kept or must not take the focus. */
function showOptions(
  options: Pick<OpenNavigation, "place" | "preserveFocus">,
  column: vscode.ViewColumn,
): vscode.ViewColumn | vscode.TextDocumentShowOptions {
  const keep = options.preserveFocus ? { preserveFocus: true } : {};
  // A tab of its own is one VS Code keeps, not the preview the next link replaces.
  const pinned = options.place === "tab" ? { preview: false } : {};
  return options.preserveFocus || options.place === "tab"
    ? { viewColumn: column, ...pinned, ...keep }
    : column;
}

async function openNavigation(options: OpenNavigation): Promise<void> {
  const { root, target, place, panels, intent } = options;
  const uri = vscode.Uri.parse(target);
  await contained(vscode.Uri.parse(root), uri);
  if (intent.token.cancelled) {
    return;
  }
  const activeColumn =
    intent.column ?? vscode.window.tabGroups.activeTabGroup.viewColumn;
  const column = place === "side" ? vscode.ViewColumn.Beside : activeColumn;
  const show = showOptions(options, column);
  const before = new Set(panels().map((panel) => panel.id));
  if (/\.(md|markdown)$/i.test(uri.path)) {
    await warmMarkdownDocument(uri);
    if (intent.token.cancelled) {
      return;
    }
    await vscode.commands.executeCommand(
      "vscode.openWith",
      uri,
      MARKDOWN_EDITOR.viewType,
      show,
    );
    await revealOpenedNote(options, before, activeColumn);
  } else if (/\.pdf$/i.test(uri.path)) {
    await openPdf(uri, options.fragment, column);
  } else if (!(await openedInIntegratedBrowser(uri, options))) {
    await vscode.commands.executeCommand(
      "vscode.open",
      uri.with({ fragment: options.fragment }),
      show,
    );
  }
}

/** Lumiere PDF's public command (in this extension): open a PDF at a location. */
export const PDF_OPEN_LOCATION_COMMAND = "lumiere.pdf.openLocation";

/**
 * Open a PDF in Lumiere PDF, at the page a link such as
 * `[[paper.pdf#page=3]]` names. Lumiere PDF's Copy link writes
 * `paper.pdf#page=3#:~:text=…`, so `page=N` may be followed by `&…`, by that
 * `#:~:` directive, or by nothing. Any other fragment (Obsidian ignores those
 * too) opens the PDF where it was left.
 */
async function openPdf(
  uri: vscode.Uri,
  fragment: string,
  column: vscode.ViewColumn,
): Promise<void> {
  const location = /^page=\d+(&|#:~:|$)/i.test(fragment) ? fragment : "";
  await vscode.commands.executeCommand(
    PDF_OPEN_LOCATION_COMMAND,
    uri.with({ fragment: location }),
    undefined,
    { viewColumn: column },
  );
}

async function revealOpenedNote(
  options: OpenNavigation,
  before: ReadonlySet<string>,
  column: number,
): Promise<void> {
  const { panels, target, place, fragment, at, reveals, intent } = options;
  if (!fragment && at === undefined) {
    return;
  }
  if (intent.token.cancelled) {
    options.logger.debug("Reveal cancelled by a newer navigation", target);
    return;
  }
  const destination: NavigationTarget = {
    fragment,
    ...(at === undefined ? {} : { at }),
    // The page scrolls to the target without taking the focus the tab kept off.
    ...(options.preserveFocus ? { preserveFocus: true } : {}),
  };
  const panel = chooseRevealPanel(panels(), before, {
    uri: vscode.Uri.parse(target).toString(),
    side: place === "side",
    column,
  });
  if (!panel) {
    throw new Error("The destination editor was not opened unambiguously");
  }
  // Superseded requests return false and leave no mailbox for a later reload.
  await reveals.deliver(intent, panel.id, destination);
}

function configuredNewNoteFolder(
  configuration: Configuration,
  source: string,
): string {
  const config = {
    get: <T>(key: string, fallback?: T) =>
      configuration.get(key, fallback, source),
  };
  return String(pluginConfiguration(config, linksManifest).newNoteFolder);
}

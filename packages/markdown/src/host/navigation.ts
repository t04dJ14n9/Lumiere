import { RevealRouter, chooseRevealPanel } from "./reveal-router";
import linksManifest from "../plugins/links/manifest";
import { pluginConfiguration } from "./settings";
import type { Configuration } from "../shared/configuration";
import { createConfiguration } from "./configuration-access";
import * as vscode from "vscode";
import type {
  Navigation,
  OpenPlace,
  NavigationTarget,
  NavigationIntent,
  PanelShell,
} from "../shared/host";
import { warmMarkdownDocument } from "./document-warm";
import { contained } from "./navigation-containment";
import { registerNativeLinks } from "./native-links";
import { MARKDOWN_EDITOR } from "../shared/editor-provider";
import {
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
  },
): Promise<void> {
  const current = panels();
  const panel = chooseRevealPanel(
    current,
    new Set(current.map((candidate) => candidate.id)),
    { uri: target.uri, side: false, column: target.column },
  );
  if (panel) {
    await reveals.deliver(
      target.intent,
      panel.id,
      toOffsetTarget(target.offset),
    );
  }
}

export function createNavigation(
  panels: () => readonly PanelShell[],
  configuration: Configuration = createConfiguration(),
): NativeNavigation {
  const reveals = new RevealRouter();
  const navigation: NativeNavigation = {
    begin: () => reveals.begin(),
    registerReveal: (panel) => reveals.register(panel),
    revealOpened: (uri, column, offset, intent) =>
      deliverToOpenedPanel(panels, reveals, { uri, column, offset, intent }),
    revealPanel: (panelId, offset, intent = reveals.begin()) =>
      reveals.deliver(intent, panelId, toOffsetTarget(offset)),
    scheme: vscode.env.uriScheme,
    external: async (href) => vscode.env.openExternal(vscode.Uri.parse(href)),
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
      ...[root, target, fragment, place, at, intent]: Parameters<
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

/** The places a link may name, in the order `linkLocation` tries them. */
function linkCandidates(
  link: string,
  create: boolean,
  base: vscode.Uri,
  sourceUri: vscode.Uri,
): [vscode.Uri, ...vscode.Uri[]] {
  if (!link) {
    return [sourceUri];
  }
  const { relative, folders } = linkLocation(link, create);
  const sourceFolder = vscode.Uri.joinPath(sourceUri, "..");
  const place = (folder: LinkFolder) =>
    vscode.Uri.joinPath(folder === "vault" ? base : sourceFolder, relative);
  const [first, ...rest] = folders;
  return [place(first), ...rest.map(place)];
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
  const candidates = linkCandidates(link, create, base, sourceUri);
  for (const uri of candidates) {
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
    // Creating never falls back: the first place is where the link points.
    uri: candidates[0],
    folder: newNoteFolder,
    ...(intent ? { intent } : {}),
  });
}

async function createNote({
  base,
  sourceUri,
  link,
  uri: candidate,
  folder,
  intent,
}: {
  base: vscode.Uri;
  sourceUri: vscode.Uri;
  link: string;
  uri: vscode.Uri;
  folder: string | undefined;
  intent?: NavigationIntent;
}): Promise<string | undefined> {
  folder ??= "";
  let uri = candidate;
  // Basename-only links respect newNoteFolder; a path with folders (or a
  // leading "/") creates at the place it names, not under that setting.
  if (followsNewNoteFolder(link)) {
    const parent =
      folder === "."
        ? vscode.Uri.joinPath(sourceUri, "..")
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
  // A tab of its own is one VS Code keeps, not the preview the next link replaces.
  const show =
    place === "tab" ? { viewColumn: column, preview: false } : column;
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
  } else {
    await vscode.commands.executeCommand(
      "vscode.open",
      uri.with({ fragment: options.fragment }),
      show,
    );
  }
}

/** Lumia PDF's public command (in this extension): open a PDF at a location. */
export const PDF_OPEN_LOCATION_COMMAND = "lumiere.pdf.openLocation";

/**
 * Open a PDF in Lumia PDF, at the page a link such as
 * `[[paper.pdf#page=3]]` names, or at a highlight kept in its sidecar
 * (`paper.pdf#hl-a1b2c3d4`). Lumia PDF's Copy link writes
 * `paper.pdf#page=3#:~:text=…`, so `page=N` may be followed by `&…`, by that
 * `#:~:` directive, or by nothing. Any other fragment (Obsidian ignores those
 * too) opens the PDF where it was left.
 */
async function openPdf(
  uri: vscode.Uri,
  fragment: string,
  column: vscode.ViewColumn,
): Promise<void> {
  const location = /^(page=\d+(&|#:~:|$)|hl-[\w-]+$)/i.test(fragment)
    ? fragment
    : "";
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
  if (intent.token.cancelled || (!fragment && at === undefined)) {
    return;
  }
  const destination: NavigationTarget = {
    fragment,
    ...(at === undefined ? {} : { at }),
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

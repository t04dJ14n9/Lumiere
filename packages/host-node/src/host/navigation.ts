/**
 * Following links outside VS Code. Resolving a link (and creating the note
 * it names) works as in VS Code; opening one is the embedder's to do: an open
 * note's page reveals the target itself, any other file opens in a new tab.
 */
import {
  RevealRouter,
  followsNewNoteFolder,
  linkLocation,
  type HostSettings,
  type LinkFolder,
  type Navigation,
  type NavigationIntent,
  type NavigationTarget,
} from "@workshop/markdown/portable";
import { questionId, type LivePanel } from "./panel";
import type { PanelHub } from "./panels";
import { OutsideWorkspace, type HostFiles } from "./platform";
import { presentingPanel } from "./ui-services";
import type { HostIdentity } from "./services";
import { joinUri, parentUri } from "./uris";

/** How long a new tab's page may take to open before its reveal is dropped. */
const OPEN_TIMEOUT_MS = 15_000;

export function createHostNavigation(
  files: HostFiles,
  panels: PanelHub,
  settings: HostSettings,
  identity: HostIdentity,
): Navigation {
  const reveals = new RevealRouter();
  return {
    begin: () => reveals.begin(),
    registerReveal: (panel) => reveals.register(panel),
    registerNativeLinks: () => () => {},
    scheme: identity.uriScheme,
    async external(href) {
      presentingPanel(panels)?.tell({ type: "external", href });
      return true;
    },
    async confirm(message) {
      const answer = await presentingPanel(panels)?.ask({
        type: "ask",
        id: questionId(),
        message,
        actions: ["Open"],
      });
      return answer === "Open";
    },
    resolve: (request) =>
      resolveLink(files, {
        ...request,
        newNoteFolder:
          request.newNoteFolder ??
          settings.get("files.newNoteFolder", "", request.source),
      }),
    async open(
      ...[root, uri, fragment, , at, intent]: Parameters<Navigation["open"]>
    ) {
      await requireInside(files, root, uri);
      const destination: NavigationTarget = {
        fragment,
        ...(at === undefined ? {} : { at }),
      };
      await openTarget({ files, panels, reveals, uri, destination, intent });
    },
  };
}

type ResolveRequest = Parameters<Navigation["resolve"]>[0];

/** The places a link may name, in the order `linkLocation` tries them. */
function linkCandidates(
  files: HostFiles,
  request: ResolveRequest,
): [string, ...string[]] {
  const { root, source, path: link, create } = request;
  if (!link) {
    return [source];
  }
  const { relative, folders } = linkLocation(link, create);
  const place = (folder: LinkFolder) =>
    joinUri(
      files,
      folder === "vault" ? root : parentUri(files, source),
      relative,
    );
  const [first, ...rest] = folders;
  return [place(first), ...rest.map(place)];
}

/** The file a link names, or the note created for it; undefined when there is none. */
export async function resolveLink(
  files: HostFiles,
  request: ResolveRequest,
): Promise<string | undefined> {
  const { root, folderNote, intent } = request;
  const candidates = linkCandidates(files, request);
  for (const candidate of candidates) {
    await requireInside(files, root, candidate);
    const info = await files.stat(candidate);
    if (intent?.token.cancelled) {
      return undefined;
    }
    if (!info) {
      continue;
    }
    if (info.kind !== "folder") {
      return candidate;
    }
    if (!folderNote) {
      return undefined;
    }
    const note = joinUri(files, candidate, folderNote);
    await requireInside(files, root, note);
    return note;
  }
  // Creating never falls back: the first place is where the link points.
  return request.create
    ? createNote(files, { root, request, target: candidates[0] })
    : undefined;
}

async function createNote(
  files: HostFiles,
  options: { root: string; request: ResolveRequest; target: string },
): Promise<string> {
  const { root, request } = options;
  let target = options.target;
  const link = request.path;
  // Basename-only links respect newNoteFolder; a path with folders (or a
  // leading "/") creates at the place it names, not under that setting.
  if (followsNewNoteFolder(link)) {
    const folder = request.newNoteFolder ?? "";
    const parent =
      folder === "."
        ? parentUri(files, request.source)
        : joinUri(files, root, folder);
    target = joinUri(files, parent, link);
  }
  if (!/\.(?:md|markdown)$/i.test(target)) {
    target += ".md";
  }
  await requireInside(files, root, target);
  await files.mkdir(parentUri(files, target));
  // An existing file, or a symlink planted in its place, is not written.
  await files.create(target);
  return target;
}

async function requireInside(
  files: HostFiles,
  root: string,
  uri: string,
): Promise<void> {
  try {
    await files.contain(root, uri);
  } catch (error) {
    if (error instanceof OutsideWorkspace) {
      throw new Error("That link points outside the vault", { cause: error });
    }
    throw error;
  }
}

interface OpenTarget {
  files: HostFiles;
  panels: PanelHub;
  reveals: RevealRouter;
  uri: string;
  destination: NavigationTarget;
  intent: NavigationIntent | undefined;
}

async function openTarget(options: OpenTarget): Promise<void> {
  const { files, panels, reveals, uri, destination } = options;
  const intent = options.intent ?? reveals.begin();
  const hasDestination =
    destination.fragment !== "" || destination.at !== undefined;
  const shown = panels.all().find((panel) => panel.document.uri === uri);
  if (shown) {
    // The note is already open in another tab: tell the presenting tab to
    // switch before revealing, because revealing focuses the target editor
    // and would otherwise make `shown` look like it was already presenting.
    if (shown !== presentingPanel(panels)) {
      tellOpen(panels, files.toPath(uri), destination.fragment);
      panels.activate(shown.id);
    }
    if (hasDestination) {
      await reveals.deliver(intent, shown.id, destination);
    }
    return;
  }
  const opened = nextPanelFor(panels, uri);
  tellOpen(panels, files.toPath(uri), destination.fragment);
  const panel = await opened;
  if (panel && hasDestination && !intent.token.cancelled) {
    panels.activate(panel.id);
    await reveals.deliver(intent, panel.id, destination);
  }
}

/** The embedder opens a file by its path. */
function tellOpen(panels: PanelHub, path: string, fragment: string): void {
  presentingPanel(panels)?.tell({ type: "open", path, fragment });
}

/** The next panel opened for `uri`, or undefined if none opens in time. */
function nextPanelFor(
  panels: PanelHub,
  uri: string,
): Promise<LivePanel | undefined> {
  return new Promise((resolve) => {
    const stop = panels.onOpened((panel) => {
      if (panel.document.uri === uri) {
        finish(panel);
      }
    });
    const timer = setTimeout(() => finish(undefined), OPEN_TIMEOUT_MS);
    // Node keeps a process alive for a timer; a browser has no unref.
    (timer as { unref?: () => void }).unref?.();
    function finish(panel: LivePanel | undefined): void {
      clearTimeout(timer);
      stop();
      resolve(panel);
    }
  });
}

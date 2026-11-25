import * as path from "node:path";
import * as vscode from "vscode";
import { t } from "@workshop/l10n";
import {
  extractPdfLink,
  parseLocationFragment,
  parsePdfLocation,
  pdfPathReadings,
} from "../../../shared/pdf-location";
import { editorToShow } from "../../../shared/open-placement";
import { resolvePdfCandidates } from "../../../shared/pdf-target-resolution";
import type { PdfPanel } from "./panel";
import { VIEW_TYPE, type PdfPanels } from "./panels";
import { OPEN_LOCATION_COMMAND_ID } from "../../../shared/command-ids";

/** PDF: Open Location, which makes the viewer a navigation target for links and other extensions. */
export function registerOpenLocation(panels: PdfPanels): vscode.Disposable {
  let generation = 0;
  let pending: vscode.CancellationTokenSource | undefined;
  // Native editor resolution cannot be cancelled once dispatched. Serialize it
  // so an older slow open can never finish after the newest queued destination.
  let opening: Promise<void> = Promise.resolve();
  const dispatch = (run: () => Promise<boolean>): Promise<boolean> => {
    const result = opening.then(run);
    opening = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };
  const command = vscode.commands.registerCommand(
    OPEN_LOCATION_COMMAND_ID,
    async (target?: unknown, location?: unknown, options?: unknown) => {
      pending?.cancel();
      pending?.dispose();
      const cancellation = new vscode.CancellationTokenSource();
      pending = cancellation;
      const request = ++generation;
      try {
        return await openLocation(panels, target, location, {
          current: () => request === generation,
          token: cancellation.token,
          dispatch,
          ...openPlaceOf(options),
        });
      } finally {
        if (pending === cancellation) {
          pending = undefined;
        }
        cancellation.dispose();
      }
    },
  );
  return new vscode.Disposable(() => {
    generation++;
    pending?.cancel();
    pending?.dispose();
    command.dispose();
  });
}

/** One Open Location request, superseded by the next. */
interface OpenRequest {
  /** False once a newer request has started. */
  current(): boolean;
  token: vscode.CancellationToken;
  /** Runs the native open after any earlier one. */
  dispatch(run: () => Promise<boolean>): Promise<boolean>;
  /** Where to open the PDF; the active group by default. */
  column: vscode.ViewColumn | undefined;
  /** Open without taking the keyboard focus (an agent's call must not steal it). */
  preserveFocus: boolean;
}

/**
 * `{ viewColumn, preserveFocus }` from a caller such as a note's link or the
 * agent bridge; anything else is ignored.
 */
function openPlaceOf(
  options: unknown,
): Pick<OpenRequest, "column" | "preserveFocus"> {
  const { viewColumn, preserveFocus } = (options ?? {}) as {
    viewColumn?: unknown;
    preserveFocus?: unknown;
  };
  const isColumn =
    typeof viewColumn === "number" &&
    Number.isInteger(viewColumn) &&
    viewColumn >= -2;
  return {
    column: isColumn ? viewColumn : undefined,
    preserveFocus: preserveFocus === true,
  };
}

type PdfDestination = ReturnType<typeof parsePdfLocation>;

/**
 * Open a PDF at a page (and box). With no arguments, ask for a link such as
 * one an agent printed: `papers/paper.pdf#page=3&viewrect=72,83,134,21`.
 * Other extensions can pass a URI and a location:
 *
 *     vscode.commands.executeCommand('lumiere.pdf.openLocation', uri, { page: 3 })
 *
 * A third argument, `{ viewColumn }`, opens it in another editor group
 * (`ViewColumn.Beside` for a link opened to the side). `{ preserveFocus: true }`
 * is for a caller that must not disturb the reader (the agent bridge): a PDF
 * already open is shown where it is, else it opens beside the current editor
 * as a tab that stays, and the focus, the active group and the editor in
 * front are left as they are (see `openKeepingFocus`).
 */
async function openLocation(
  panels: PdfPanels,
  target: unknown,
  location: unknown,
  request: OpenRequest,
): Promise<boolean> {
  const link = target ?? (await askForLink(request.token));
  if (link === undefined || !request.current()) {
    return false;
  }
  const resolved = await resolvePdfUri(link, request);
  if (!request.current() || resolved.status === "cancelled") {
    return false;
  }
  if (resolved.status !== "found") {
    void vscode.window.showWarningMessage(
      t("No readable PDF file found at {0}", String(link)),
    );
    return false;
  }
  const uri = resolved.target;
  const arrival = arrivalOf(uri.fragment, location);
  if (arrival === "invalid") {
    void vscode.window.showWarningMessage(
      t(
        "The PDF location is invalid. Use a positive whole page number, optionally with a valid viewrect.",
      ),
    );
    return false;
  }
  return request.dispatch(() =>
    openAt(panels, uri.with({ fragment: "" }), arrival, request),
  );
}

/** Where the viewer goes once open: a page (and box), nowhere, or a location that does not parse. */
type Arrival = PdfDestination | "invalid";

function arrivalOf(fragment: string, location: unknown): Arrival {
  if (location !== undefined) {
    return parsePdfLocation(location) ?? "invalid";
  }
  if (!fragment) {
    return undefined;
  }
  return parseLocationFragment(fragment) ?? "invalid";
}

function askForLink(
  token: vscode.CancellationToken,
): Thenable<string | undefined> {
  return vscode.window.showInputBox(
    {
      title: t("Open PDF at Location"),
      prompt: t(
        "A PDF path or link, optionally with #page=… and &viewrect=…, or a Source line copied for an agent",
      ),
      placeHolder: "papers/paper.pdf#page=3&viewrect=72,83,134,21",
    },
    token,
  );
}

/** Open the viewer on `file` and go to `destination`, unless superseded. */
async function openAt(
  panels: PdfPanels,
  file: vscode.Uri,
  destination: Exclude<Arrival, "invalid">,
  request: OpenRequest,
): Promise<boolean> {
  if (!request.current()) {
    return false;
  }
  const panel = request.preserveFocus
    ? await openKeepingFocus(panels, file, request)
    : await openInActiveGroup(panels, file, request);
  if (!panel || !request.current()) {
    return false;
  }
  if (destination) {
    panel.goTo(destination);
  }
  return true;
}

/** The human's open: in the active group (or the column asked for), and the viewer takes the focus. */
async function openInActiveGroup(
  panels: PdfPanels,
  file: vscode.Uri,
  request: OpenRequest,
): Promise<PdfPanel | undefined> {
  await vscode.commands.executeCommand(
    "vscode.openWith",
    file,
    VIEW_TYPE,
    ...(request.column === undefined ? [] : [request.column]),
  );
  return request.current() ? panels.waitFor(file) : undefined;
}

/**
 * An agent's open, which must not move what the reader is doing: neither the
 * keyboard, nor the active group, nor the editor they are in. A PDF already
 * open somewhere is shown where it is (`editorToShow`); otherwise it opens
 * beside the current editor (or in the column asked for), never on top of
 * it, and never as a preview tab that the next open would replace.
 */
async function openKeepingFocus(
  panels: PdfPanels,
  file: vscode.Uri,
  request: OpenRequest,
): Promise<PdfPanel | undefined> {
  const open = panels.editorsOf(file);
  const shown = editorToShow(
    open.map((panel) => ({
      panel,
      viewColumn: panel.webviewPanel.viewColumn,
      visible: panel.webviewPanel.visible,
    })),
    vscode.window.tabGroups.activeTabGroup.viewColumn,
  );
  if (shown) {
    if (!shown.visible) {
      shown.panel.webviewPanel.reveal(undefined, true);
    }
    return shown.panel;
  }
  await vscode.commands.executeCommand("vscode.openWith", file, VIEW_TYPE, {
    viewColumn: request.column ?? vscode.ViewColumn.Beside,
    preserveFocus: true,
    preview: false,
  });
  return panels.waitForNew(file, new Set(open), request.current);
}

/**
 * A URI, a `file:` URL, an absolute path, or a path inside a workspace
 * folder; given as text, it can also be wrapped in a Markdown link.
 */
async function resolvePdfUri(
  target: unknown,
  request: Pick<OpenRequest, "current" | "token">,
): Promise<
  { status: "found"; target: vscode.Uri } | { status: "missing" | "cancelled" }
> {
  const candidates = candidatesFor(target);
  if (!candidates) {
    return { status: "missing" };
  }
  return resolvePdfCandidates(
    candidates,
    (uri) => uri.toString(),
    (uri) => isPdfFile(uri, request.current),
    (matches) => pickPdf(matches, request),
  );
}

/** The URIs `target` may mean; undefined when it cannot mean any. */
function candidatesFor(target: unknown): vscode.Uri[] | undefined {
  if (target instanceof vscode.Uri) {
    return [target];
  }
  if (typeof target !== "string" || !target.trim()) {
    return undefined;
  }
  const text = extractPdfLink(target);
  try {
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) {
      return [vscode.Uri.parse(text)];
    }
    const hash = text.indexOf("#");
    const fragment = hash < 0 ? "" : text.slice(hash + 1);
    const files = pdfPathReadings(
      hash < 0 ? text : text.slice(0, hash),
    ).flatMap((file) =>
      path.isAbsolute(file)
        ? [vscode.Uri.file(file)]
        : (vscode.workspace.workspaceFolders ?? []).map((folder) =>
            vscode.Uri.joinPath(folder.uri, file),
          ),
    );
    return files.map((uri) => uri.with({ fragment }));
  } catch {
    return undefined;
  }
}

async function isPdfFile(
  uri: vscode.Uri,
  current: () => boolean,
): Promise<boolean> {
  if (!current() || !/\.pdf$/iu.test(uri.path)) {
    return false;
  }
  try {
    const stat = await vscode.workspace.fs.stat(uri.with({ fragment: "" }));
    return (
      (stat.type & vscode.FileType.File) !== 0 &&
      (stat.type & vscode.FileType.Directory) === 0
    );
  } catch {
    return false;
  }
}

/** Ask which folder's copy to open when a relative path exists in several. */
async function pickPdf(
  matches: readonly vscode.Uri[],
  request: Pick<OpenRequest, "current" | "token">,
): Promise<vscode.Uri | undefined> {
  if (!request.current()) {
    return undefined;
  }
  const choice = await vscode.window.showQuickPick(
    matches.map((uri) => ({
      label: path.basename(uri.path),
      description: uri.fsPath,
      uri,
    })),
    {
      title: t("Choose the PDF to open"),
      placeHolder: t(
        "This relative path exists in more than one workspace folder",
      ),
    },
    request.token,
  );
  return choice?.uri;
}

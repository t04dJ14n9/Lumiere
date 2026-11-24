/**
 * Which PDF a tool argument names. An agent's argument is untrusted input:
 * a tool may only act on a PDF inside this window's workspace folders, never
 * on any file its path happens to reach (an absolute path, `..`, a symbolic
 * link). The one answer for "missing" and "outside" does not tell an agent
 * whether a file exists out there.
 */
import * as path from "node:path";
import * as vscode from "vscode";
import { containingFolder } from "../../../../outlines/inside-folders";
import {
  localWorkspaceFolders,
  workspacePdfFiles,
} from "../../../../outlines/vscode";
import {
  extractPdfLink,
  pdfPathReadings,
} from "../../../../../shared/pdf-location";
import type { PdfPanel } from "../../../pdf/panel";
import type { BridgeDeps } from "../deps";
import { clip, ToolError } from "./results";

/** The longest argument echoed back in an error. */
const MAX_ECHO = 200;

/** A PDF in the workspace, with the `#…` the argument carried. */
export interface WorkspacePdf {
  uri: vscode.Uri;
  fragment: string;
}

/**
 * The PDF in this window's workspace that `text` names: a path (relative to
 * a workspace folder, or absolute), a `file:` URI, a Markdown link or an
 * `@path#page=N` locator. Throws a `ToolError` when it names no PDF inside
 * the workspace, or names one in several of its folders. A name of another
 * machine (see `isOtherMachine`) is refused the same way, before any
 * file-system call.
 */
export async function resolveWorkspacePdf(text: string): Promise<WorkspacePdf> {
  const found = new Map<string, WorkspacePdf>();
  for (const candidate of candidatesFor(text)) {
    const uri = await workspacePdf(candidate.uri);
    if (uri) {
      found.set(uri.toString(), { uri, fragment: candidate.fragment });
    }
  }
  const [only, ...others] = [...found.values()];
  if (!only) {
    throw new ToolError(
      `No PDF named "${clip(text, MAX_ECHO)}" inside this window's workspace folders. ` +
        "Only PDFs in the workspace can be used; pass a path relative to a workspace folder.",
    );
  }
  if (others.length > 0) {
    const where = [only, ...others].map((pdf) => pdf.uri.fsPath).join(", ");
    throw new ToolError(
      `"${clip(text, MAX_ECHO)}" is in more than one workspace folder (${where}). Pass an absolute path.`,
    );
  }
  return only;
}

/** `\\?\` and `\\.\` name this machine's device namespace, not a host. */
const DEVICE_NAMESPACE = /^[\\/]{2}[?.][\\/]/u;

/** `\\?\UNC\host\…` and `\\.\UNC\host\…` are UNC paths in device form. */
const DEVICE_UNC = /^[\\/]{2}[?.][\\/]UNC[\\/]+([^\\/]+)/iu;

/** A UNC prefix, or a `file:` URI with a host, then the host's name. */
const NETWORK_PREFIX =
  /^(?:[\\/]{2}|file:(?![\\/]{3}[^\\/])[\\/]{2})[\\/]*([^\\/?#]+)/iu;

/**
 * The host a name of another machine names, lower-cased, or undefined for a
 * name of this machine (a device path, `file:///…`, `localhost`). Windows
 * resolves such a name over the network at the first file-system call, so
 * it is judged before any URI is made from it.
 */
function namedHost(name: string): string | undefined {
  const deviceUnc = DEVICE_UNC.exec(name);
  if (!deviceUnc && DEVICE_NAMESPACE.test(name)) {
    return undefined;
  }
  const host = (deviceUnc ?? NETWORK_PREFIX.exec(name))?.[1]?.toLowerCase();
  return host === "localhost" ? undefined : host;
}

/**
 * Whether `name` names a machine other than the hosts this window's folders
 * are on: a workspace opened from a share keeps its own share's paths open.
 */
function isOtherMachine(name: string): boolean {
  const host = namedHost(name);
  if (host === undefined) {
    return false;
  }
  const own = (vscode.workspace.workspaceFolders ?? [])
    .filter((folder) => folder.uri.scheme === "file")
    .map((folder) => folder.uri.authority.toLowerCase());
  return !own.includes(host);
}

/** The URIs `text` may mean; each keeps its fragment. */
function candidatesFor(text: string): WorkspacePdf[] {
  const link = extractPdfLink(text);
  try {
    if (/^[a-z][a-z0-9+.-]*:\/\//iu.test(link)) {
      if (isOtherMachine(link)) {
        return [];
      }
      const uri = vscode.Uri.parse(link);
      return [{ uri: uri.with({ fragment: "" }), fragment: uri.fragment }];
    }
    const hash = link.indexOf("#");
    const fragment = hash < 0 ? "" : link.slice(hash + 1);
    // Every reading of the path is checked, decoded ones included: one that
    // is a network name refuses the whole argument.
    const readings = pdfPathReadings(hash < 0 ? link : link.slice(0, hash));
    if (readings.some(isOtherMachine)) {
      return [];
    }
    return readings
      .flatMap((file) =>
        path.isAbsolute(file)
          ? [vscode.Uri.file(file)]
          : (vscode.workspace.workspaceFolders ?? []).map((folder) =>
              vscode.Uri.joinPath(folder.uri, file),
            ),
      )
      .map((uri) => ({ uri, fragment }));
  } catch {
    return [];
  }
}

/**
 * `uri` as the window names the PDF, when it is a `.pdf` file the workspace
 * holds: its real path is in a folder (see `insideFolders`). Undefined
 * otherwise.
 */
async function workspacePdf(uri: vscode.Uri): Promise<vscode.Uri | undefined> {
  if (!/\.pdf$/iu.test(uri.path)) {
    return undefined;
  }
  // `insideFolders` leaves a remote or virtual file to its file system, so
  // the window itself must say it belongs to a workspace folder.
  if (uri.scheme !== "file" && !vscode.workspace.getWorkspaceFolder(uri)) {
    return undefined;
  }
  if ((await workspacePdfFiles.stat(uri.toString())) === undefined) {
    return undefined;
  }
  return inWindowsFolder(uri);
}

/**
 * A window can open a folder through a link (`~/vault`) while an agent names
 * a file by the real path (`~/Documents/vault/…`): inside the folder, but
 * to VS Code in no workspace folder, so its editors, settings and notes
 * would not match. Put such a path back under the folder as opened.
 */
async function inWindowsFolder(uri: vscode.Uri): Promise<vscode.Uri> {
  if (uri.scheme !== "file" || vscode.workspace.getWorkspaceFolder(uri)) {
    return uri;
  }
  const found = await containingFolder(localWorkspaceFolders(), uri.toString());
  const folder = (vscode.workspace.workspaceFolders ?? []).find(
    ({ uri: opened }) => opened.fsPath === found?.folder,
  );
  return found && folder
    ? vscode.Uri.joinPath(folder.uri, ...found.relative.split(path.sep))
    : uri;
}

/** The PDF a tool is about: its file, and the editor showing it when one is open. */
export interface PdfSubject {
  uri: vscode.Uri;
  panel: PdfPanel | undefined;
}

/**
 * The PDF in `path`, or when it is omitted the last one the user viewed (a
 * PDF the user opened themselves, wherever it is). An argument must name a
 * PDF inside the workspace.
 */
export async function pdfSubject(
  argument: string | undefined,
  { lastPdf, panels }: Pick<BridgeDeps, "lastPdf" | "panels">,
): Promise<PdfSubject> {
  if (argument === undefined) {
    const panel = lastPdf.panel;
    if (!panel) {
      throw new ToolError(
        "No PDF has been viewed in Lumiere in this window yet. Pass `path`, or ask the user to open one.",
      );
    }
    return { uri: panel.uri, panel };
  }
  const { uri } = await resolveWorkspacePdf(argument);
  const key = uri.toString();
  // The one the user is in, when the same PDF is open twice.
  const panel = [lastPdf.panel, ...panels.all].find(
    (open) => open?.uri.toString() === key,
  );
  return { uri, panel };
}

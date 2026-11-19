/**
 * Pure helpers for editor drag-and-drop of files / URIs into the attachment
 * folder. Callers must preventDefault on dragover + drop when
 * `shouldClaimEditorDrop` is true so the host does not open the file as a tab.
 *
 * Uses a structural drag payload so this module stays free of DOM lib types
 * (shared with the host half).
 */

import { mediaKind } from "../shared/media-kinds";

const URI_LIST = "text/uri-list";
const CODE_URI_LIST = "application/vnd.code.uri-list";
/** VS Code Explorer / editor drag payload (JSON array of URI strings). */
const RESOURCE_URLS = "ResourceURLs";

const URI_TYPES = [URI_LIST, CODE_URI_LIST, RESOURCE_URLS] as const;

/** Minimal DataTransfer shape used by the attachment drop helpers. */
export interface DragPayload {
  readonly types: ArrayLike<string>;
  readonly files: ArrayLike<{
    readonly name: string;
    readonly type: string;
    arrayBuffer(): Promise<ArrayBuffer>;
  }>;
  getData(format: string): string;
}

/** True when the drag carries files or resource URIs we should intercept. */
export function isAttachmentDrag(data: DragPayload | null): boolean {
  if (!data) {
    return false;
  }
  const types = Array.from(data.types);
  if (
    types.includes("Files") ||
    URI_TYPES.some((type) => types.includes(type))
  ) {
    return true;
  }
  return data.files.length > 0;
}

/** Alias used by the webview: claiming the drop blocks VS Code's open-tab. */
export function shouldClaimEditorDrop(data: DragPayload | null): boolean {
  return isAttachmentDrag(data);
}

/** Push trimmed string entries from a JSON array uri-list payload. */
function appendJsonUriList(found: string[], raw: string): void {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return;
    }
    for (const item of parsed) {
      if (typeof item !== "string") {
        continue;
      }
      const trimmed = item.trim();
      if (!trimmed) {
        continue;
      }
      found.push(trimmed);
    }
  } catch {
    // Not JSON — ignore.
  }
}

/** File:// and http(s) URIs from uri-list flavours (Explorer / OS without File). */
export function urisFromDataTransfer(data: DragPayload | null): string[] {
  if (!data) {
    return [];
  }
  const found: string[] = [];
  const types = Array.from(data.types);
  if (types.includes(URI_LIST)) {
    for (const line of data.getData(URI_LIST).split(/\r?\n/)) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith("#")) {
        found.push(trimmed);
      }
    }
  }
  for (const mime of [CODE_URI_LIST, RESOURCE_URLS] as const) {
    if (!types.includes(mime)) {
      continue;
    }
    const raw = data.getData(mime);
    if (!raw.trim()) {
      continue;
    }
    appendJsonUriList(found, raw);
  }
  return [...new Set(found)];
}

/**
 * The dropped URIs to import as attachments: files and VS Code resources,
 * and web addresses only of images. A link dragged from a browser carries
 * its page's address in `text/uri-list` too; importing it fetched the page
 * and failed. An image dragged from a page names itself in an `<img>`.
 */
export function droppedAttachmentUris(data: DragPayload | null): string[] {
  const uris = urisFromDataTransfer(data);
  const html =
    data && hasType(data, "text/html") ? data.getData("text/html") : "";
  const images = imageSources(html);
  return uris.filter(
    (uri) =>
      !isWebAddress(uri) ||
      mediaKind(webPath(uri)) === "image" ||
      images.includes(uri),
  );
}

function webPath(uri: string): string {
  try {
    return new URL(uri).pathname;
  } catch {
    return "";
  }
}

/**
 * The text to insert for a drop of web links that are not attachments (see
 * `droppedAttachmentUris`): the dragged text, else the addresses.
 */
export function droppedLinkText(data: DragPayload | null): string | undefined {
  const links = urisFromDataTransfer(data).filter(isWebAddress);
  if (!data || links.length === 0 || droppedAttachmentUris(data).length > 0) {
    return undefined;
  }
  const plain = hasType(data, "text/plain") ? data.getData("text/plain") : "";
  return plain.trim() || links.join("\n");
}

function isWebAddress(uri: string): boolean {
  return /^https?:\/\//i.test(uri);
}

function hasType(data: DragPayload, type: string): boolean {
  return Array.from(data.types).includes(type);
}

/** The `src` of each `<img>` in dragged HTML, its `&amp;`s decoded. */
function imageSources(html: string): string[] {
  return Array.from(
    html.matchAll(/<img\b[^>]*?\ssrc\s*=\s*(["'])(.*?)\1/gi),
    (match) => match[2]!.replace(/&amp;/g, "&"),
  );
}

export type DragFile =
  DragPayload["files"] extends ArrayLike<infer F> ? F : never;

/** Files from the FileList (OS drops). */
export function filesFromDataTransfer(data: DragPayload | null): DragFile[] {
  if (!data) {
    return [];
  }
  return Array.from(data.files);
}

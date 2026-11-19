import { extensionForMime, type DragFile } from "../../attachments";
import { MAX_ATTACHMENT_BYTES } from "./protocol";

/** How a page saves dropped items, and says why one was not added. */
export interface DropSaver {
  saveBytes(bytes: Uint8Array, ext: string): Promise<string | undefined>;
  saveSource(uri: string): Promise<string | undefined>;
  /** The page refused a file: the host shows a short error. */
  refuse(name: string, reason: "tooLarge" | "unreadable"): void;
  /** The request failed (the host shows its own errors). */
  failed(error: unknown): void;
}

/**
 * Save each dropped file or URI in turn and return the embeds of those
 * saved. One that cannot be saved is reported and skipped; the others are
 * still saved. A file the protocol could not carry is refused before it is
 * read, so a large drop is never read whole.
 */
export async function saveDropped(
  saver: DropSaver,
  files: readonly DragFile[],
  uris: readonly string[],
): Promise<string[]> {
  const embeds: string[] = [];
  const keep = (embed: string | undefined) => {
    if (embed) {
      embeds.push(embed);
    }
  };
  for (const file of files) {
    keep(await saveDroppedFile(saver, file));
  }
  for (const uri of uris) {
    try {
      keep(await saver.saveSource(uri));
    } catch (error) {
      saver.failed(error);
    }
  }
  return embeds;
}

/** Save one file; undefined, reported, when it is not saved. */
export async function saveDroppedFile(
  saver: DropSaver,
  file: DragFile,
): Promise<string | undefined> {
  if (file.size > MAX_ATTACHMENT_BYTES) {
    saver.refuse(file.name, "tooLarge");
    return undefined;
  }
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await file.arrayBuffer());
  } catch {
    saver.refuse(file.name, "unreadable");
    return undefined;
  }
  const ext = extensionFromName(file.name) || extensionForMime(file.type);
  try {
    return await saver.saveBytes(bytes, ext);
  } catch (error) {
    saver.failed(error);
    return undefined;
  }
}

function extensionFromName(name: string): string {
  const base = name.split(/[/\\]/).pop() ?? "";
  const dot = base.lastIndexOf(".");
  if (dot <= 0) {
    return "";
  }
  const ext = base.slice(dot + 1).toLowerCase();
  return /^[a-z0-9]{1,8}$/.test(ext) ? ext : "";
}

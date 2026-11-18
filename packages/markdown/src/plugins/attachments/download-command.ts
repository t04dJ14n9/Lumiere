import type { Context } from "@workshop/core";
import {
  decodeDataUri,
  downloadFileName,
  embedFor,
  imageChoice,
  loadAttachmentOutcome,
  propertyImageUrls,
  propertyLinkFor,
  remoteImages,
  saveAttachment,
  withDownloadedImages,
  withDownloadedPropertyImages,
  type SavedAttachment,
  type SourceOutcome,
} from "../../attachments";
import { SourceCoordinates } from "../../shared/document/coordinates";
import { contributionId } from "../../shared/setting-schema";
import { hostFetch } from "./host-fetch";
import { attachmentTarget, type AttachmentTarget } from "./target";

export const NO_VAULT = "Attachments need a vault: open this note from one.";

/** Register Download Attachments for Current File; it reads the active editor when it runs. */
export function registerDownloadAttachments(ctx: Context): void {
  ctx.effect(() =>
    ctx.hostCommands.register(contributionId("downloadAttachments"), () =>
      downloadAttachments(ctx),
    ),
  );
}

/**
 * Obsidian's Download attachments for current file: save the images the
 * active note shows from the web (and data URIs) into its attachment folder,
 * and replace each with an embed that keeps its alt text. An image URL in a
 * property is saved too, and becomes a link to the file.
 */
export async function downloadAttachments(ctx: Context): Promise<void> {
  const panel = ctx.editors.active();
  if (!panel) {
    ctx.dialogs.inform("Open a note to download its attachments.");
    return;
  }
  const urls = imageUrls(editorText(panel.document));
  if (urls.length === 0) {
    ctx.dialogs.inform("This note shows no images from the web.");
    return;
  }
  const target = await attachmentTarget(ctx, panel);
  if (!target) {
    ctx.dialogs.error(NO_VAULT);
    return;
  }
  const images = urls.length === 1 ? "1 image" : `${urls.length} images`;
  const chosen = await ctx.dialogs.pickMany({
    placeholder: `Download ${images} into the vault? Untick any to leave out.`,
    items: urls.map((url) => ({ ...imageChoice(url), value: url })),
  });
  if (!chosen?.length) {
    return;
  }
  const { saved, skipped } = await saveAll(target, chosen);
  const edits = downloadEdits(editorText(panel.document), target, saved);
  // The host refuses the edit when the note was closed during the downloads;
  // the files are saved by then, so say the note still shows the web images.
  const edited =
    edits.length === 0 ||
    (await ctx.hostDocuments.apply(panel.document, edits));
  const message = summary({
    downloaded: saved.size,
    failed: chosen.length - saved.size - skipped.length,
    skipped,
    edited,
  });
  if (edited) {
    ctx.dialogs.inform(message);
  } else {
    ctx.dialogs.error(message);
  }
}

/** The web and data-URI images the note shows, each once: its properties' first, then its text's. */
function imageUrls(text: string): string[] {
  return [
    ...new Set([
      ...propertyImageUrls(text),
      ...remoteImages(text).map(({ url }) => url),
    ]),
  ];
}

/** The edits that point the note at the files saved, found where its images are now. */
function downloadEdits(
  text: string,
  target: AttachmentTarget,
  saved: ReadonlyMap<string, SavedAttachment>,
) {
  const properties = withDownloadedPropertyImages(text, (url) => {
    const file = saved.get(url);
    return file && propertyLinkFor({ ...target, ...file });
  });
  const body = withDownloadedImages(text, (url, alt) => {
    const file = saved.get(url);
    return file && embedFor({ ...target, ...file, alt });
  });
  return [...properties, ...body];
}

/**
 * The note with LF line breaks, whose offsets are the editor's: that is what
 * `hostDocuments.apply` takes, and it maps them onto the note's own breaks,
 * so offsets read from the CRLF source would be shifted twice.
 */
function editorText(document: { getText(): string }): string {
  return new SourceCoordinates(document.getText()).editor.toString();
}

/** What the downloads came to: the files saved, and the URLs that served no image. */
interface Downloads {
  readonly saved: Map<string, SavedAttachment>;
  readonly skipped: string[];
}

/** Download and save each URL in turn; the ones that fail are left out. */
async function saveAll(
  target: AttachmentTarget,
  urls: readonly string[],
): Promise<Downloads> {
  const saved = new Map<string, SavedAttachment>();
  const skipped: string[] = [];
  for (const url of urls) {
    const outcome = await loadImage(url);
    if (outcome.kind === "notImage") {
      skipped.push(url);
    }
    const file =
      outcome.kind === "loaded" &&
      (await saveAttachment({
        ...target,
        bytes: outcome.source.bytes,
        ...downloadFileName(url, outcome.source),
        // An image saved a moment ago shares the vault's names too.
        vaultPaths: [
          ...(target.vaultPaths ?? []),
          ...[...saved.values()].map(({ path }) => path),
        ],
      }).catch(() => undefined));
    if (file) {
      saved.set(url, file);
    }
  }
  return { saved, skipped };
}

async function loadImage(url: string): Promise<SourceOutcome> {
  if (/^data:/iu.test(url)) {
    // decodeDataUri names any payload `.png`; a note's data URI must say it is an image.
    const source = /^data:image\/[^;,]+[;,]/iu.test(url)
      ? decodeDataUri(url)
      : undefined;
    return source ? { kind: "loaded", source } : { kind: "failed" };
  }
  // A note can come from anywhere: keep only what is served or named as an image.
  return loadAttachmentOutcome(url, {
    imagesOnly: true,
    fetch: hostFetch,
    readFile: async () => undefined,
  });
}

interface SummaryFacts {
  readonly downloaded: number;
  readonly failed: number;
  /** The URLs that served no image, left as they were. */
  readonly skipped: readonly string[];
  readonly edited: boolean;
}

function summary({
  downloaded,
  failed,
  skipped,
  edited,
}: SummaryFacts): string {
  const count = downloaded === 1 ? "1 attachment" : `${downloaded} attachments`;
  const parts = [
    edited
      ? `Downloaded ${count}.`
      : `Saved ${count} in the vault, but the note was not changed.`,
  ];
  if (failed > 0) {
    parts.push(`${failed} could not be downloaded.`);
  }
  if (skipped.length > 0) {
    const named = skipped.slice(0, 3).join(", ");
    const more = skipped.length > 3 ? ` and ${skipped.length - 3} more` : "";
    parts.push(`${skipped.length} skipped, not an image: ${named}${more}.`);
  }
  return parts.join(" ");
}

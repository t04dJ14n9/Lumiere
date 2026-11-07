import type { Context } from "@workshop/core";
import {
  decodeDataUri,
  downloadStem,
  embedFor,
  loadAttachmentSource,
  remoteImages,
  saveAttachment,
  withDownloadedImages,
  type SavedAttachment,
  type SourceBytes,
} from "../../attachments";
import { contributionId } from "../../shared/setting-schema";
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
 * and replace each with an embed that keeps its alt text.
 */
export async function downloadAttachments(ctx: Context): Promise<void> {
  const panel = ctx.editors.active();
  if (!panel) {
    ctx.dialogs.inform("Open a note to download its attachments.");
    return;
  }
  const urls = [
    ...new Set(remoteImages(panel.document.getText()).map(({ url }) => url)),
  ];
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
  const answer = await ctx.dialogs.ask(
    `Download the ${images} this note shows from the web into the vault?`,
    ["Download"],
  );
  if (answer !== "Download") {
    return;
  }
  const saved = await saveAll(target, urls);
  const edits = withDownloadedImages(panel.document.getText(), (url, alt) => {
    const file = saved.get(url);
    return file && embedFor({ ...target, ...file, alt });
  });
  if (edits.length > 0) {
    await ctx.hostDocuments.apply(panel.document, edits);
  }
  ctx.dialogs.inform(summary(saved.size, urls.length - saved.size));
}

/** Download and save each URL in turn; the ones that fail are left out. */
async function saveAll(
  target: AttachmentTarget,
  urls: readonly string[],
): Promise<Map<string, SavedAttachment>> {
  const saved = new Map<string, SavedAttachment>();
  for (const url of urls) {
    const source = await loadImage(url);
    const file =
      source &&
      (await saveAttachment({
        ...target,
        ...source,
        stem: downloadStem(url),
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
  return saved;
}

function loadImage(url: string): Promise<SourceBytes | undefined> {
  if (/^data:/iu.test(url)) {
    return Promise.resolve(decodeDataUri(url));
  }
  // A note can come from anywhere: keep only what is served or named as an image.
  return loadAttachmentSource(url, {
    imagesOnly: true,
    fetch: (address) => fetch(address),
    readFile: async () => undefined,
  });
}

function summary(downloaded: number, failed: number): string {
  const done =
    downloaded === 1
      ? "Downloaded 1 attachment."
      : `Downloaded ${downloaded} attachments.`;
  return failed > 0 ? `${done} ${failed} could not be downloaded.` : done;
}

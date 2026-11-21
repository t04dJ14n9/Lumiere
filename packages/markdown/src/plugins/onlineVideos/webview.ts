import type { Plugin } from "@workshop/core";
import { protocol as links } from "../links/protocol";
import type { RenderPass } from "../render/api";
import type {} from "../render/api";
import { videoCard } from "./card";
import { parseVideoUrl } from "./parse";

interface Mount {
  isTrusted: boolean;
  open(href: string): void;
}

export const onlineVideosWebview: Plugin = {
  name: "onlineVideos",
  inject: { required: ["render", "rpc"] },
  apply(ctx) {
    const mount: Mount = {
      isTrusted: ctx.render.trusted === true,
      open(href) {
        void ctx.rpc
          .call(links, "open", { href, wiki: false, side: false })
          .catch((error) => ctx.logger.warn("Open video failed", error));
      },
    };
    // Runs before embeds, which would otherwise treat the link as an image.
    ctx.on("render/postProcess", (pass) => mountVideos(pass, mount));
  },
};

function mountVideos(pass: RenderPass, mount: Mount): void {
  const images = pass.container.querySelectorAll<HTMLImageElement>(
    "img.note-image[data-resource]",
  );
  if (images.length === 0) {
    return;
  }
  const events = new AbortController();
  const restore: (() => void)[] = [];
  for (const image of images) {
    const video = parseVideoUrl(image.dataset.resource ?? "");
    if (!video) {
      continue;
    }
    const card = videoCard(video, {
      label: image.alt,
      trusted: mount.isTrusted,
      signal: events.signal,
      measure: pass.measure,
      open: mount.open,
    });
    image.replaceWith(card);
    restore.push(() => card.replaceWith(image));
  }
  if (restore.length) {
    pass.onDispose(() => {
      events.abort();
      for (const undo of restore) {
        undo();
      }
    });
  }
}

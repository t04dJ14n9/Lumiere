import type { Plugin } from "@workshop/core";
import { protocol as links } from "../links/protocol";
import type { RenderPass } from "../render/api";
import type {} from "../render/api";
import { linkCard } from "./card";
import { embedFrame, trackTweetHeights } from "./frame";
import { parseWebEmbed } from "./parse";
import { embedTheme, embedView } from "./player";

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
          .catch((error) => ctx.logger.warn("Open web embed failed", error));
      },
    };
    // Runs before embeds, which would otherwise treat the link as an image.
    ctx.on("render/postProcess", (pass) => mountEmbeds(pass, mount));
  },
};

function mountEmbeds(pass: RenderPass, mount: Mount): void {
  const images = pass.container.querySelectorAll<HTMLImageElement>(
    "img.note-image[data-resource]",
  );
  if (images.length === 0) {
    return;
  }
  const events = new AbortController();
  const trackHeight = trackTweetHeights({
    signal: events.signal,
    measure: pass.measure,
  });
  const restore: (() => void)[] = [];
  for (const image of images) {
    const embed = parseWebEmbed(image.dataset.resource ?? "");
    if (!embed) {
      continue;
    }
    const view = embedView(embed, {
      isTrusted: mount.isTrusted,
      theme: embedTheme(document.body.classList),
    });
    let shown: HTMLElement;
    if (view.kind === "frame") {
      const { shell, frame } = embedFrame(embed, view, events.signal);
      if (embed.kind === "tweet") {
        trackHeight(frame);
      }
      shown = shell;
    } else {
      shown = linkCard(embed, {
        label: image.alt,
        signal: events.signal,
        open: mount.open,
      });
    }
    image.replaceWith(shown);
    restore.push(() => shown.replaceWith(image));
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

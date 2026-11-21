import type { Plugin } from "@workshop/core";
import { protocol as links } from "../links/protocol";
import type { RenderPass } from "../render/api";
import type {} from "../render/api";
import { linkCard } from "./card";
import { trackTweetHeights, tweetFrame } from "./frame";
import { parseTweet } from "./parse";
import { embedTheme, embedView } from "./tweet-embed";

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
          .catch((error) => ctx.logger.warn("Open tweet failed", error));
      },
    };
    // Runs before embeds, which would otherwise treat the link as an image.
    ctx.on("render/postProcess", (pass) => mountTweets(pass, mount));
  },
};

function mountTweets(pass: RenderPass, mount: Mount): void {
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
    const tweet = parseTweet(image.dataset.resource ?? "");
    if (!tweet) {
      continue;
    }
    const view = embedView(tweet, {
      isTrusted: mount.isTrusted,
      theme: embedTheme(document.body.classList),
    });
    let shown: HTMLElement;
    if (view.kind === "frame") {
      const { shell, frame } = tweetFrame(view, events.signal);
      trackHeight(frame);
      shown = shell;
    } else {
      shown = linkCard(tweet, {
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

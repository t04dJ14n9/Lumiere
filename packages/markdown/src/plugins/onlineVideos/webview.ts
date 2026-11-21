import type { Plugin } from "@workshop/core";
import { protocol as links } from "../links/protocol";
import type { RenderPass } from "../render/api";
import type {} from "../render/api";
import { linkCard } from "./card";
import { trackTweetHeights, tweetFrame } from "./frame";
import { parseTweet } from "./parse";
import { TWEET_DEFAULT_HEIGHT, embedTheme, embedView } from "./tweet-embed";

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
    // What each open render pass holds (its frames, its `message` listener, its
    // load timers, the images it swapped out). A pass outlives this plugin
    // when the plugin is switched off, so stopping it undoes every open one.
    const cleanups = new Set<() => void>();
    ctx.effect(() => () => {
      for (const cleanup of [...cleanups]) {
        cleanup();
      }
    });
    // Runs before embeds, which would otherwise treat the link as an image.
    ctx.on("render/postProcess", (pass) => mountTweets(pass, mount, cleanups));
    // Tells Embeds which links get a frame (only in a trusted workspace, and
    // only while this plugin runs) and how tall it starts.
    ctx.on("render/claimedHeight", (target) =>
      mount.isTrusted && parseTweet(target) ? TWEET_DEFAULT_HEIGHT : undefined,
    );
  },
};

function mountTweets(
  pass: RenderPass,
  mount: Mount,
  cleanups: Set<() => void>,
): void {
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
  if (restore.length === 0) {
    return;
  }
  // Run by the pass ending or by the plugin stopping, whichever is first; the
  // other finds nothing left to do.
  const cleanup = () => {
    cleanups.delete(cleanup);
    events.abort();
    for (const undo of restore.splice(0)) {
      undo();
    }
  };
  cleanups.add(cleanup);
  pass.onDispose(cleanup);
}

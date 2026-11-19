import type { Context, Infer, Plugin } from "@workshop/core";
import { protocol as links } from "../links/protocol";
import type { RenderPass } from "../render/api";
import type {} from "../render/api";
import { videoCard } from "./card";
import type { VideoDetails } from "./protocol";
import { config } from "./manifest";
import type { OnlineVideo } from "./parse";
import { parseVideoUrl } from "./parse";
import { protocol } from "./protocol";

interface Mount {
  trusted: boolean;
  bilibiliPlayer: boolean;
  open(href: string): void;
  /** Host lookups; only called in a trusted workspace. */
  details(video: OnlineVideo): Promise<VideoDetails>;
}

const mounts = new WeakMap<Context, Mount>();

export const onlineVideosWebview: Plugin<Infer<typeof config>> = {
  name: "onlineVideos",
  config,
  inject: { required: ["render", "rpc"] },
  // The setting applies to the next render; Features re-renders after it.
  reconfigure(ctx, options) {
    const mount = mounts.get(ctx);
    if (!mount) {
      return false;
    }
    mount.bilibiliPlayer = options.bilibiliPlayer;
    return true;
  },
  apply(ctx, options) {
    // Re-rendered blocks reuse the answer instead of asking the host again.
    const known = new Map<string, Promise<VideoDetails>>();
    const mount: Mount = {
      trusted: ctx.render.trusted === true,
      bilibiliPlayer: options.bilibiliPlayer,
      open(href) {
        void ctx.rpc
          .call(links, "open", { href, wiki: false, side: false })
          .catch((error) => ctx.logger.warn("Open video failed", error));
      },
      details(video) {
        const part = video.part ?? 1;
        const key = `${video.provider}:${video.kind}:${video.id}:${part}`;
        return rememberedDetails(known, key, () =>
          ctx.rpc
            .call(protocol, "details", {
              provider: video.provider,
              id: video.id,
              kind: video.kind,
              ...(video.provider === "bilibili" ? { part } : {}),
            })
            .catch((error) => {
              ctx.logger.debug("Video details unavailable", error);
              return {};
            }),
        );
      },
    };
    mounts.set(ctx, mount);
    // Runs before embeds, which would otherwise treat the link as an image.
    ctx.on("render/postProcess", (pass) => mountVideos(pass, mount));
  },
};

/**
 * The host's answer for a video, kept for re-rendered blocks. An empty one
 * (the lookup failed, or the host had no answer yet) is not kept: the next
 * render asks again, and the host, which caches answers for the window,
 * decides when to retry the provider. A failure was otherwise remembered
 * for as long as the note stayed open.
 */
export function rememberedDetails(
  known: Map<string, Promise<VideoDetails>>,
  key: string,
  ask: () => Promise<VideoDetails>,
): Promise<VideoDetails> {
  const kept = known.get(key);
  if (kept) {
    return kept;
  }
  const answer = ask().then((details) => {
    if (Object.keys(details).length === 0 && known.get(key) === answer) {
      known.delete(key);
    }
    return details;
  });
  known.set(key, answer);
  return answer;
}

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
      trusted: mount.trusted,
      player: video.provider === "bilibili" && mount.bilibiliPlayer,
      ...(mount.trusted ? { details: mount.details(video) } : {}),
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

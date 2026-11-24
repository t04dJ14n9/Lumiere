import {
  TWEET_DEFAULT_HEIGHT,
  TWEET_MAX_WIDTH,
  isEmbedUrl,
  type EmbedView,
} from "./tweet-embed";
import { tweetResizeHeight } from "./tweet-height";

type FrameView = Extract<EmbedView, { kind: "frame" }>;

/**
 * How long a frame waits before it starts loading. The editor renders a block
 * more than once while a note opens (a feature that loads renders it again),
 * and each render drops the frames of the one before. A frame that started
 * loading at once would fetch the widget's page and scripts only to have them
 * thrown away: at opening the last render came 32 ms after the first
 * (browser spec, `online-videos.spec.ts`: one request per frame).
 */
const SETTLE_MS = 100;

/**
 * The shell and frame for a tweet the view says to draw. The frame gets
 * every attribute but `src` here (so the `sandbox` is on it before any
 * load), and its `src` once the render has settled (`SETTLE_MS`) and the page is idle. Aborting
 * `signal`, the render pass ending, cancels the load. A frame not in the page
 * does not load until it is, so no check is made here.
 */
export function tweetFrame(
  view: FrameView,
  signal: AbortSignal,
): { shell: HTMLElement; frame: HTMLIFrameElement } {
  const { src, ...attributes } = view.attributes;
  const frame = document.createElement("iframe");
  for (const [name, value] of Object.entries(attributes)) {
    frame.setAttribute(name, value);
  }
  frame.style.height = `${TWEET_DEFAULT_HEIGHT}px`;
  const shell = document.createElement("span");
  shell.className = "mw-embed mw-embed-tweet";
  shell.style.maxWidth = `${TWEET_MAX_WIDTH}px`;
  shell.append(frame);
  loadWhenSettled(frame, src, signal);
  return { shell, frame };
}

function loadWhenSettled(
  frame: HTMLIFrameElement,
  src: string | undefined,
  signal: AbortSignal,
): void {
  if (src === undefined || !isEmbedUrl(src)) {
    throw new Error(`Refusing embed URL ${src}`);
  }
  // An aborted signal never fires `abort` again, so a timer started now
  // could not be cancelled.
  if (signal.aborted) {
    return;
  }
  let idle: number | undefined;
  const timer = setTimeout(() => {
    // Then when the page is idle: the host's answers to an opening note
    // (property types, the sheet's state) each render the note's blocks
    // again, and on a slow machine they come after the settle time (CI: the
    // tweet loaded two or three times). Idle callbacks run after the
    // messages and renders already waiting; the timeout keeps a page that
    // is never idle from never loading the tweet.
    if (typeof requestIdleCallback !== "function") {
      frame.src = src;
      return;
    }
    idle = requestIdleCallback(
      () => {
        frame.src = src;
      },
      { timeout: IDLE_TIMEOUT_MS },
    );
  }, SETTLE_MS);
  signal.addEventListener(
    "abort",
    () => {
      clearTimeout(timer);
      if (idle !== undefined) {
        cancelIdleCallback(idle);
      }
    },
    { once: true },
  );
}

/** The longest a settled frame waits for the page to be idle. */
const IDLE_TIMEOUT_MS = 2000;

/**
 * Sizes tweet frames to the height their widget asks for. One `message`
 * listener serves every frame of a render pass and goes with its signal.
 * Returns the function that registers a frame.
 */
export function trackTweetHeights(options: {
  signal: AbortSignal;
  /** Called after a frame's height changed. */
  measure(): void;
}): (frame: HTMLIFrameElement) => void {
  const frames = new Set<HTMLIFrameElement>();
  const onMessage = (event: MessageEvent): void => {
    for (const frame of frames) {
      const height = tweetResizeHeight(event, frame.contentWindow);
      if (height === undefined) {
        continue;
      }
      const css = `${height}px`;
      if (frame.style.height !== css) {
        frame.style.height = css;
        options.measure();
      }
      return;
    }
  };
  return (frame) => {
    // Likewise a listener added now would never be removed.
    if (options.signal.aborted) {
      return;
    }
    if (frames.size === 0) {
      window.addEventListener("message", onMessage, { signal: options.signal });
    }
    frames.add(frame);
  };
}

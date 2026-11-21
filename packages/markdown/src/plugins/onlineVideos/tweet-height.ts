import { TWEET_ORIGIN, clampTweetHeight } from "./tweet-embed";

/** The parts of a `message` event this reads. */
export interface FrameMessage {
  readonly source: unknown;
  readonly origin: string;
  readonly data: unknown;
}

/**
 * The height a tweet frame asked for, clamped, or undefined for any message
 * that is not that frame's own resize request. The frame is known by its
 * window (`source`), not by anything the message says, and the message must
 * come from the widget's origin: the page's `message` events also carry
 * VS Code's own and every other frame's.
 */
export function tweetResizeHeight(
  message: FrameMessage,
  frameWindow: unknown,
): number | undefined {
  if (
    frameWindow === null ||
    frameWindow === undefined ||
    message.source !== frameWindow ||
    message.origin !== TWEET_ORIGIN
  ) {
    return undefined;
  }
  const height = requestedHeight(message.data);
  return height === undefined ? undefined : clampTweetHeight(height);
}

/**
 * The widget posts `{"twttr.embed": {method: "twttr.private.resize",
 * params: [{width, height}], jsonrpc, id}}`. Only the fields read are
 * checked: the envelope carries more (and may carry others later), but each
 * field read must have the type it is used as.
 */
function requestedHeight(data: unknown): number | undefined {
  const call = isRecord(data) ? data["twttr.embed"] : undefined;
  if (!isRecord(call) || call.method !== "twttr.private.resize") {
    return undefined;
  }
  const params = call.params;
  if (!Array.isArray(params) || params.length === 0) {
    return undefined;
  }
  const first: unknown = params[0];
  const height = isRecord(first) ? first.height : undefined;
  return typeof height === "number" && Number.isFinite(height) && height > 0
    ? height
    : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Cross-plugin surface for this plugin. Other plugins may import only this
 * file, not internal modules like parse.ts.
 */
export { parseTweet, type Tweet } from "./parse";
export { TWEET_DEFAULT_HEIGHT } from "./tweet-embed";

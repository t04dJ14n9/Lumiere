/**
 * Cross-plugin surface for Online Videos. Other plugins may import only this
 * file, not internal modules like parse.ts.
 */
export {
  parseVideoUrl,
  type OnlineVideo,
  type VideoProvider,
  type MediaKind,
} from "./parse";

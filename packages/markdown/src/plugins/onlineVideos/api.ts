/**
 * Cross-plugin surface for Online Videos. Other plugins may import only this
 * file, not internal modules like parse.ts.
 */
export { parseWebEmbed, type WebEmbed } from "./parse";
export { reservedHeight } from "./player";

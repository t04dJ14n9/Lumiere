import { decodeDataValue } from "../../markdown/html/helpers";
import { parseHtmlEmbedBlock } from "./html-embed-source";

/**
 * A fenced `html-embed` block that names a file becomes the placeholder a
 * `![[page.html]]` embed renders to, so one pass shows both the same way (the
 * card, near the screen, reloading). A block that names no HTML file stays the
 * code it is.
 *
 * Runs in `render/postProcess`, before the pass looks for embeds: the
 * renderer's own `render/fence` event comes after it.
 */
export function convertHtmlEmbedBlocks(container: ParentNode): void {
  for (const block of container.querySelectorAll<HTMLElement>(
    'pre[data-fence="html-embed"]',
  )) {
    const file = parseHtmlEmbedBlock(
      decodeDataValue(block.dataset["source"] ?? ""),
    );
    if (!file) {
      continue;
    }
    const embed = block.ownerDocument.createElement("span");
    embed.className = "file-embed";
    // The file is a vault path as a wikilink writes it, not a relative link.
    embed.dataset["wiki"] = "true";
    embed.dataset["resource"] = file;
    embed.textContent = file;
    block.replaceWith(embed);
  }
}

/** What an embed or Markdown image shows: its target, without size or heading. */
function embedTarget(source: string): string {
  return (
    /^!\[\[([^\]|#^]*)/u.exec(source)?.[1] ??
    /^!\[[^\]]*\]\(\s*<?([^)>\s]*)/u.exec(source)?.[1] ??
    ""
  ).trim();
}

const IMAGE = /\.(?:bmp|png|jpe?g|gif|svg|webp|avif)$/iu;

/**
 * Whether an embed (`![[a.png]]`) or Markdown image (`![](a.png)`) shows an
 * image file, which stays drawn while its source shows (and can be
 * selected and resized).
 */
export function embedsImage(source: string): boolean {
  const target = embedTarget(source);
  // Pasted / inspector data URLs have no file extension but are images
  // like image files.
  return IMAGE.test(target) || /^data:image\//i.test(target);
}

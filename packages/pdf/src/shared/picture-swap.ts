/** The one place a page's whole-page picture is shown: its `<img>` on the web. */
export interface PictureSlot {
  /** Whether a picture is on screen in it now. */
  hasPicture(): boolean;
  /** Show the picture at `url` in it. */
  show(url: string): void;
}

/**
 * Swap the pictures a slot is given so that a page that has a picture keeps
 * it until the next one is ready: the first picture is shown at once, a later
 * one only once `decode` has made it ready to draw. Of pictures given while
 * one is being decoded, only the last is shown; the others were replaced
 * before they could be seen. A picture that cannot be decoded is shown all
 * the same, so its failure reaches the slot as it would have.
 *
 * Returns the function to give the slot a picture with.
 */
export function swapWhenDecoded(
  slot: PictureSlot,
  decode: (url: string) => Promise<unknown>,
): (url: string) => void {
  let latest: string | undefined;
  return (url) => {
    latest = url;
    if (!slot.hasPicture()) {
      slot.show(url);
      return;
    }
    void decode(url)
      .catch(() => undefined)
      .then(() => {
        if (latest === url) {
          slot.show(url);
        }
      });
  };
}

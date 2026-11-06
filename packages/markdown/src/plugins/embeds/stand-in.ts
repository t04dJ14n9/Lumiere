/**
 * An <img> never displays the text inside it, so a Markdown image that could
 * not be shown (`![](missing.png)`) is swapped for a block that can, the same
 * `.file-embed` block `![[…]]` writes its error into. The image stays known
 * so a later retry, or the pass ending, can put it back.
 */
export class ImageStandIns {
  private readonly standIns = new Map<HTMLElement, HTMLElement>();

  /** The element an embed's error is written into. */
  surfaceFor(node: HTMLElement): HTMLElement {
    if (!(node instanceof HTMLImageElement)) {
      return node;
    }
    let standIn = this.standIns.get(node);
    if (!standIn) {
      standIn = document.createElement("span");
      standIn.className = "file-embed";
      node.replaceWith(standIn);
      this.standIns.set(node, standIn);
    }
    return standIn;
  }

  /** Put the image back in place of its stand-in; false if it had none. */
  restore(image: HTMLElement): boolean {
    const standIn = this.standIns.get(image);
    if (!standIn) {
      return false;
    }
    standIn.replaceWith(image);
    this.standIns.delete(image);
    return true;
  }

  restoreAll(): void {
    for (const image of [...this.standIns.keys()]) {
      this.restore(image);
    }
  }
}

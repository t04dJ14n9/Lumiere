import { mediaKind } from "../../shared/media-kinds";

/**
 * How far outside the editor's visible area an embed starts loading: about
 * two screens, so it is drawn (and its height known) before it scrolls in.
 */
export const NEAR_VIEWPORT_MARGIN = "1500px 0px";

/**
 * Whether an embed of `target` waits until it is near the screen: notes,
 * bases and PDFs, which render through the whole pipeline. Images, audio
 * and video load at once (the browser fetches their bytes lazily anyway),
 * and so does a web address.
 */
export function waitsUntilNear(target: string): boolean {
  if (/^(?:https?|data):/i.test(target)) {
    return false;
  }
  const path = target.split("#")[0]!.split("|")[0]!;
  const kind = mediaKind(path);
  return kind !== "image" && kind !== "audio" && kind !== "video";
}

/**
 * Runs each embed's `show` once the embed comes within the margin of its
 * editor scroller's visible area. An embed not inside an editor scroller (a
 * hover preview's popup, a container not on the page yet) and a page without
 * IntersectionObserver show at once: there is nothing to measure against.
 */
export class NearViewport {
  private readonly observers = new Map<Element, IntersectionObserver>();
  private readonly waiting = new Map<Element, () => void>();

  whenNear(node: HTMLElement, show: () => void): void {
    const scroller =
      typeof IntersectionObserver === "function"
        ? node.closest(".cm-scroller")
        : null;
    if (!scroller) {
      show();
      return;
    }
    this.waiting.set(node, show);
    this.observer(scroller).observe(node);
  }

  dispose(): void {
    for (const observer of this.observers.values()) {
      observer.disconnect();
    }
    this.observers.clear();
    this.waiting.clear();
  }

  private observer(scroller: Element): IntersectionObserver {
    let observer = this.observers.get(scroller);
    if (!observer) {
      // The scroller is the root: a margin around the page's viewport would
      // not reach past the scroller's own clipping.
      const created = new IntersectionObserver(
        (entries) => this.reached(created, entries),
        { root: scroller, rootMargin: NEAR_VIEWPORT_MARGIN },
      );
      observer = created;
      this.observers.set(scroller, observer);
    }
    return observer;
  }

  private reached(
    observer: IntersectionObserver,
    entries: readonly Pick<
      IntersectionObserverEntry,
      "target" | "isIntersecting"
    >[],
  ): void {
    for (const { target, isIntersecting } of entries) {
      const show = this.waiting.get(target);
      if (isIntersecting && show) {
        this.waiting.delete(target);
        observer.unobserve(target);
        show();
      }
    }
  }
}

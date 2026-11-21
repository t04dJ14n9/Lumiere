import type { OnlineVideo } from "./parse";
import { thumbnailUrl } from "./player";

interface CardOptions {
  /** The image's alt text, if any. */
  label: string;
  trusted: boolean;
  signal: AbortSignal;
  measure(): void;
  /** Open the video page in the external browser. */
  open(href: string): void;
}

/**
 * A card for a YouTube video: the title (alt text, else "YouTube video"), the
 * ID, the video's still in a trusted workspace, and a button that opens the
 * page in the external browser. Buttons, not anchors: VS Code's webview
 * opens every clicked `<a href>` itself as well.
 */
export function videoCard(
  video: OnlineVideo,
  options: CardOptions,
): HTMLElement {
  const card = element("span", "mw-video");
  card.dataset.provider = video.provider;
  const label = options.label.trim();
  const title = element("span", "mw-video-title", label || "YouTube video");
  const meta = element("span", "mw-video-meta", `YouTube · ${video.id}`);
  meta.title = video.id;
  if (options.trusted) {
    card.append(cover(video, title.textContent!, options));
  }
  const body = element("span", "mw-video-body");
  body.append(title, meta);
  const actions = element("span", "mw-video-actions");
  const open = opener(video, "mw-video-open", options);
  open.textContent = "Open on YouTube";
  actions.append(open);
  body.append(actions);
  if (!options.trusted) {
    body.append(
      element(
        "span",
        "mw-video-note",
        "Covers are off in an untrusted workspace.",
      ),
    );
  }
  card.append(body);
  return card;
}

function cover(
  video: OnlineVideo,
  title: string,
  options: CardOptions,
): HTMLElement {
  const link = opener(video, "mw-video-thumb", options);
  link.setAttribute("aria-label", `Open ${title} on YouTube`);
  const image = document.createElement("img");
  image.src = thumbnailUrl(video);
  image.alt = "";
  image.loading = "lazy";
  image.addEventListener("load", options.measure, { signal: options.signal });
  image.addEventListener("error", () => link.remove(), {
    signal: options.signal,
  });
  link.append(image, element("span", "mw-video-badge", "▶"));
  return link;
}

function opener(
  video: OnlineVideo,
  className: string,
  options: CardOptions,
): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.title = video.page;
  button.addEventListener("click", () => options.open(video.page), {
    signal: options.signal,
  });
  return button;
}

function element(tag: string, className: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) {
    node.textContent = text;
  }
  return node;
}

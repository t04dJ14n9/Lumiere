import type { Tweet } from "./parse";
import { t } from "@workshop/l10n";

interface CardOptions {
  /** The image's alt text, if any. */
  label: string;
  signal: AbortSignal;
  /** Open the page in the external browser. */
  open(href: string): void;
}

/**
 * What an untrusted workspace (Restricted Mode) shows in place of a frame: a
 * title (the alt text, else "Tweet"), the site and ID, and a button that opens
 * the tweet in the external browser. It loads nothing. A button, not an
 * anchor: VS Code's webview opens every clicked `<a href>` itself as well.
 */
export function linkCard(tweet: Tweet, options: CardOptions): HTMLElement {
  const card = document.createElement("span");
  card.className = "mw-embed-card";
  const open = document.createElement("button");
  open.type = "button";
  open.className = "mw-embed-card-open";
  open.textContent = t("Open on X");
  open.title = tweet.page;
  open.addEventListener("click", () => options.open(tweet.page), {
    signal: options.signal,
  });
  card.append(
    element("mw-embed-card-title", options.label.trim() || t("Tweet")),
    element("mw-embed-card-meta", `X · ${tweet.id}`),
    open,
    element(
      "mw-embed-card-note",
      t("Embeds are off in an untrusted workspace."),
    ),
  );
  return card;
}

function element(className: string, text: string): HTMLElement {
  const node = document.createElement("span");
  node.className = className;
  node.textContent = text;
  return node;
}

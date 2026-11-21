import type { WebEmbed } from "./parse";

interface CardOptions {
  /** The image's alt text, if any. */
  label: string;
  signal: AbortSignal;
  /** Open the page in the external browser. */
  open(href: string): void;
}

/**
 * What an untrusted workspace (Restricted Mode) shows in place of a frame: a
 * title (the alt text, else what the link is), the site and ID, and a button
 * that opens the page in the external browser. It loads nothing. A button,
 * not an anchor: VS Code's webview opens every clicked `<a href>` itself as
 * well.
 */
export function linkCard(embed: WebEmbed, options: CardOptions): HTMLElement {
  const names = SITES[embed.kind];
  const card = document.createElement("span");
  card.className = "mw-embed-card";
  card.dataset.embed = embed.kind;
  card.append(
    element("span", "mw-embed-card-title", options.label.trim() || names.thing),
    element("span", "mw-embed-card-meta", `${names.site} · ${embed.id}`),
  );
  const open = document.createElement("button");
  open.type = "button";
  open.className = "mw-embed-card-open";
  open.textContent = `Open on ${names.site}`;
  open.title = embed.page;
  open.addEventListener("click", () => options.open(embed.page), {
    signal: options.signal,
  });
  card.append(
    open,
    element(
      "span",
      "mw-embed-card-note",
      "Embeds are off in an untrusted workspace.",
    ),
  );
  return card;
}

const SITES = {
  youtube: { site: "YouTube", thing: "YouTube video" },
  tweet: { site: "X", thing: "Tweet" },
} as const;

function element(tag: string, className: string, text: string): HTMLElement {
  const node = document.createElement(tag);
  node.className = className;
  node.textContent = text;
  return node;
}

/**
 * Puts sanitized HTML into `container` with its remote content already
 * constrained. An iframe in the page starts loading as soon as it is
 * inserted, and a `sandbox` set afterwards applies only to its next load,
 * so the HTML is parsed in an inert template, where nothing loads, and
 * constrained there before it goes in. (Remote images of an untrusted
 * workspace likewise never start a request.)
 */
export function insertRenderedHtml(
  container: HTMLElement,
  html: string,
  trusted: boolean,
): void {
  const template = container.ownerDocument.createElement("template");
  template.innerHTML = html;
  constrainRemoteContent(template.content, trusted);
  container.replaceChildren(template.content);
}

/** Remote content follows host trust even after sanitization permits its tags. */
export function constrainRemoteContent(
  container: ParentNode,
  trusted: boolean,
): void {
  for (const frame of container.querySelectorAll("iframe")) {
    if (!trusted || !/^https:\/\//i.test(frame.getAttribute("src") ?? "")) {
      frame.remove();
    } else {
      frame.setAttribute(
        "sandbox",
        "allow-scripts allow-same-origin allow-presentation",
      );
      frame.loading = "lazy";
    }
  }
  if (trusted) {
    return;
  }
  for (const media of container.querySelectorAll("[src]")) {
    if (/^https?:/i.test(media.getAttribute("src") ?? "")) {
      media.removeAttribute("src");
    }
  }
}

import { linkClass } from "../../markdown/link-class";

// The pure rule also styles the host's first-paint snapshot.
export { linkClass };

/** The address a bare URL opens: GFM links `www.` to https and plain addresses to mail. */
export function bareUrlTarget(text: string): string {
  if (/^[a-z][a-z\d+.-]*:/i.test(text)) {
    return text;
  }
  return text.includes("@") && !text.includes("/")
    ? `mailto:${text}`
    : `https://${text}`;
}

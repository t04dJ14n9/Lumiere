/**
 * How a host serves a file from a vault to a note's page. The file is
 * someone else's content (a cloned repository, a shared vault) on the
 * origin the editor and its embedder run on, so it must never run there:
 * not as a page of its own, nor as a script the editor's page loads.
 *
 * Pure, for every host that serves vault files over HTTP: host-node's
 * `/lumiere/file` and the web app's service worker.
 */

/**
 * The media types of what a note's page shows from a vault: the images,
 * audio and video the editor embeds (packages/markdown's media-kinds.ts) and
 * PDFs, which a PDF embed fetches. An SVG is shown with `<img>`, which runs
 * none of its scripts.
 */
const MEDIA_TYPES: Readonly<Record<string, string>> = {
  avif: "image/avif",
  bmp: "image/bmp",
  gif: "image/gif",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  png: "image/png",
  svg: "image/svg+xml",
  webp: "image/webp",
  aac: "audio/aac",
  aif: "audio/aiff",
  aiff: "audio/aiff",
  flac: "audio/flac",
  m4a: "audio/mp4",
  mp3: "audio/mpeg",
  ogg: "audio/ogg",
  wav: "audio/wav",
  mkv: "video/x-matroska",
  mov: "video/quicktime",
  mp4: "video/mp4",
  ogv: "video/ogg",
  webm: "video/webm",
  pdf: "application/pdf",
};

const PDF = "application/pdf";

/**
 * A vault file opened as a document of its own (an SVG in a new tab) gets an
 * opaque origin, no scripts and nothing it could load: the policy the web
 * app's worker and host-node both send. A response's policy applies only
 * when it is a document, so an image or a video in a note still shows.
 */
export const VAULT_FILE_POLICY = "default-src 'none'; sandbox";

/**
 * The media type of a vault file a note shows, by its name (a path, with
 * either separator, or a URL's path); undefined for anything else.
 */
export function vaultMediaType(name: string): string | undefined {
  const base = name.slice(
    Math.max(name.lastIndexOf("/"), name.lastIndexOf("\\")) + 1,
  );
  const dot = base.lastIndexOf(".");
  return dot < 0 ? undefined : MEDIA_TYPES[base.slice(dot + 1).toLowerCase()];
}

/**
 * The headers of a vault file's response. A file the editor does not embed
 * (an HTML page, a script, an XML file) is bytes to save: a browser neither
 * renders nor runs `application/octet-stream` with `nosniff`, and opened as
 * a page it downloads. Every file but a PDF carries `VAULT_FILE_POLICY`;
 * Chrome refuses to show a PDF in a sandboxed document, and its viewer runs
 * on an origin of its own.
 */
export function vaultFileHeaders(name: string): Record<string, string> {
  const type = vaultMediaType(name);
  return {
    "content-type": type ?? "application/octet-stream",
    "x-content-type-options": "nosniff",
    ...(type ? {} : { "content-disposition": "attachment" }),
    ...(type === PDF ? {} : { "content-security-policy": VAULT_FILE_POLICY }),
  };
}

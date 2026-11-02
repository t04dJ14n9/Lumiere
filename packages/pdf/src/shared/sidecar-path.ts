/**
 * Where a PDF's sidecar highlights live (settings `lumiere.pdf.sidecar.*`):
 * beside the PDF as `paper.pdf.lumiere.md` (the default), or flat in a folder
 * of the PDF's workspace. Pure: the host turns the result into URIs.
 */

/** The ending that makes `paper.pdf` into its sidecar `paper.pdf.lumiere.md`. */
export const SIDECAR_SUFFIX = ".lumiere.md";

export type SidecarLocation = "sibling" | "directory";

export const SIDECAR_LOCATIONS: readonly SidecarLocation[] = [
  "sibling",
  "directory",
];

/** Where new sidecars go, from the two settings. */
export type SidecarPlacement =
  | { kind: "sibling" }
  /** Path segments under the PDF's workspace folder; empty is its root. */
  | { kind: "directory"; folder: readonly string[] }
  /** The folder setting cannot be used: fall back to sibling, and say so once. */
  | { kind: "misconfigured"; reason: string };

/** The sidecar file name for a PDF file name. */
export function sidecarFileName(pdfName: string): string {
  return `${pdfName}${SIDECAR_SUFFIX}`;
}

export function parseSidecarLocation(value: unknown): SidecarLocation {
  return SIDECAR_LOCATIONS.includes(value as SidecarLocation)
    ? (value as SidecarLocation)
    : "sibling";
}

/** Where new sidecars go, validating the folder when one is asked for. */
export function sidecarPlacement(
  location: unknown,
  directory: unknown,
): SidecarPlacement {
  if (parseSidecarLocation(location) === "sibling") {
    return { kind: "sibling" };
  }
  const folder = workspaceFolderSegments(directory);
  if (typeof folder === "string") {
    return { kind: "misconfigured", reason: folder };
  }
  return { kind: "directory", folder };
}

/**
 * A workspace-relative folder as path segments, or why it cannot be used:
 * empty, absolute, starting at `~`, or climbing out of the workspace with
 * `..`. Backslashes count as separators; `.` and empty segments are dropped.
 */
export function workspaceFolderSegments(value: unknown): string[] | string {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) {
    return "lumiere.pdf.sidecar.directory is empty";
  }
  const path = text.replace(/\\/g, "/");
  if (path.startsWith("/") || path.startsWith("~") || /^[a-z]:/i.test(path)) {
    return `lumiere.pdf.sidecar.directory must be inside the workspace, not ${text}`;
  }
  const segments: string[] = [];
  for (const segment of path.split("/")) {
    if (segment === "" || segment === ".") {
      continue;
    }
    if (segment === "..") {
      if (segments.length === 0) {
        return `lumiere.pdf.sidecar.directory leaves the workspace: ${text}`;
      }
      segments.pop();
      continue;
    }
    segments.push(segment);
  }
  return segments;
}

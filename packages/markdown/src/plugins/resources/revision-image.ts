import type { GitAccess } from "../../shared/git";
import type { HostWorkspace } from "../../shared/host";
import type { Resource } from "./api";

const IMAGE_TYPES: Readonly<Record<string, string>> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  svg: "image/svg+xml",
  bmp: "image/bmp",
};

/**
 * An image in a note opened from Git history, as it was at that commit: its
 * bytes inline, since the webview can only load files from disk. Anything
 * else, or an image the commit cannot give, keeps the working tree's URL.
 */
export async function atRevision(
  resource: Resource,
  ref: string,
  host: {
    git: Pick<GitAccess, "toGitUri">;
    workspace: Pick<HostWorkspace, "read">;
  },
): Promise<Resource> {
  const type = IMAGE_TYPES[extensionOf(resource.source)];
  const revision = host.git.toGitUri(resource.source, ref);
  if (resource.kind !== "image" || !type || !revision) {
    return resource;
  }
  try {
    const bytes = await host.workspace.read(revision);
    return { ...resource, url: `data:${type};base64,${base64(bytes)}` };
  } catch {
    return resource;
  }
}

function extensionOf(uri: string): string {
  return new URL(uri).pathname.split(".").at(-1)?.toLowerCase() ?? "";
}

/** Base64 without Node's Buffer, in chunks `String.fromCharCode` accepts. */
function base64(bytes: Uint8Array): string {
  let binary = "";
  for (let start = 0; start < bytes.length; start += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(start, start + 0x8000));
  }
  return btoa(binary);
}

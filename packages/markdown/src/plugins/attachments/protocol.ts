import { Schema } from "@workshop/core";
import { defineProtocol } from "../../shared/rpc/protocol";

/** The largest file a page can send: enough for a large screenshot. */
export const MAX_ATTACHMENT_BYTES = 15_000_000;
/** `MAX_ATTACHMENT_BYTES` as base64. */
const MAX_BASE64 = Math.ceil(MAX_ATTACHMENT_BYTES / 3) * 4;

const saveResult = Schema.object({
  ok: Schema.boolean(),
  embed: Schema.string().max(8192).optional(),
  path: Schema.string().max(4096).optional(),
  error: Schema.string().max(512).optional(),
});

/**
 * A note's page asks the host to write one attachment and return its embed.
 * The host applies `files.attachmentFolder` and link settings.
 *
 * `save` takes bytes from the webview (clipboard / File / data URI).
 * `importUrl` loads http(s) or file:// on the host — webview CSP blocks fetch.
 */
export const protocol = defineProtocol("attachments", {
  requests: {
    save: {
      params: Schema.object({
        bytesBase64: Schema.string().max(MAX_BASE64),
        // One extension, never a path: the name it ends is the host's.
        ext: Schema.string().pattern(/^[A-Za-z0-9]{1,8}$/u),
      }),
      result: saveResult,
    },
    importUrl: {
      params: Schema.object({
        url: Schema.string().max(8192),
      }),
      result: saveResult,
    },
  },
  notifications: {
    /**
     * The page did not send a dropped or pasted file: the host says why.
     * The page names only the file and a reason; the host writes the words.
     */
    refused: Schema.object({
      name: Schema.string().max(255),
      reason: Schema.union(["tooLarge", "unreadable"]),
    }),
  },
});

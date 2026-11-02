import { Schema } from "@workshop/core";
import { defineProtocol } from "../../shared/rpc/protocol";

export const protocol = defineProtocol("outline", {
  requests: {},
  notifications: {
    /**
     * Where the reader is after a scroll: the caret while it is on screen,
     * else the line at the middle of the editor. `version` is the document
     * version the offset belongs to.
     */
    readingPosition: Schema.object({
      offset: Schema.number().min(0),
      version: Schema.number().min(0),
    }),
  },
});

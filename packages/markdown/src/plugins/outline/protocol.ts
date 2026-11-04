import { Schema } from "@workshop/core";
import { defineProtocol } from "../../shared/rpc/protocol";

export const protocol = defineProtocol("outline", {
  requests: {},
  notifications: {
    /**
     * Where the reader is after a scroll: the line at the top of the editor
     * viewport. `version` is the document version the offset belongs to.
     */
    readingPosition: Schema.object({
      offset: Schema.number().min(0),
      version: Schema.number().min(0),
    }),
  },
});

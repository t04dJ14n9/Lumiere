import { Schema } from "@workshop/core";
import { defineProtocol } from "../../shared/rpc/protocol";

export const protocol = defineProtocol("livePreview", {
  requests: {},
  notifications: {
    /** The panel's mode, sent when it starts and whenever it changes. */
    mode: Schema.object({ mode: Schema.union(["source", "livePreview"]) }),
  },
});

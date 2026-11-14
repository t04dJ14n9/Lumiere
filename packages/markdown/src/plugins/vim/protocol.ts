import { Schema } from "@workshop/core";
import { defineProtocol } from "../../shared/rpc/protocol";

export const protocol = defineProtocol("vim", {
  requests: {
    /**
     * Whether the host shows Vim's mode in its own status bar. When it does,
     * the editor hides its Vim panel except for prompts and messages.
     */
    statusBar: { params: Schema.object({}), result: Schema.boolean() },
  },
  notifications: {
    /** The focused editor's Vim status, as Vim's panel would show it. */
    status: Schema.object({ text: Schema.string().max(256) }),
  },
});

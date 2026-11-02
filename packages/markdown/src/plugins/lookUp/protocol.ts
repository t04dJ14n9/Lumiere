import { Schema } from "@workshop/core";
import { defineProtocol } from "../../shared/rpc/protocol";
import { MAX_LOOK_UP_LENGTH } from "./words";

export const protocol = defineProtocol("lookUp", {
  requests: {
    /** Open `word` in the Dictionary app; false when the host did not. */
    lookUp: {
      params: Schema.object({
        word: Schema.string().min(1).max(MAX_LOOK_UP_LENGTH),
      }),
      result: Schema.boolean(),
    },
  },
  notifications: {},
});

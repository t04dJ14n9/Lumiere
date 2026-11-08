import type { SuggestionContext, SuggestionTrigger } from "../suggest/api";
import { linkTrigger } from "../../markdown/link-trigger";

export const linkSuggestion = ({
  state,
  pos,
}: SuggestionContext): SuggestionTrigger | undefined => {
  const line = state.doc.lineAt(pos);
  const trigger = linkTrigger(state.sliceDoc(line.from, pos));
  return trigger && { ...trigger, from: line.from + trigger.from };
};

import type { EditorState } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import {
  SearchQuery,
  openSearchPanel,
  setSearchQuery,
} from "@codemirror/search";

/**
 * The state after opening the find bar, as Mod+F does, and typing `query`,
 * keeping the selection (Find selects each match it moves to). The state
 * needs CodeMirror's `search()` extension.
 */
export function withFindBar(
  state: EditorState,
  query?: ConstructorParameters<typeof SearchQuery>[0],
): EditorState {
  // openSearchPanel only reads the state and dispatches its effects.
  const view = {
    state,
    dispatch(spec: Parameters<EditorState["update"]>[0]) {
      view.state = view.state.update(spec).state;
    },
  };
  openSearchPanel(view as unknown as EditorView);
  return query
    ? view.state.update({ effects: setSearchQuery.of(new SearchQuery(query)) })
        .state
    : view.state;
}

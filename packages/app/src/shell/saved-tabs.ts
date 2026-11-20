/**
 * The open tabs, kept with the window's layout (`UiState.tabs`) so that the
 * notes open at quit open again at launch, as in Obsidian and VS Code.
 */
import { useEffect, useRef } from "react";
import {
  restoreTabs,
  tabsToSave,
  type TabsAction,
  type TabsState,
} from "./tabs";
import type { UiStateHandle } from "./ui-state";

export function useSavedTabs({
  ui,
  openVaults,
  tabs,
  dispatch,
}: {
  readonly ui: UiStateHandle;
  readonly openVaults: readonly string[];
  readonly tabs: TabsState;
  readonly dispatch: (action: TabsAction) => void;
}): void {
  const restored = useRef(false);
  // Once the layout and a vault are known: tabs of a vault not open stay closed.
  useEffect(() => {
    if (restored.current || !ui.loaded || openVaults.length === 0) {
      return;
    }
    restored.current = true;
    for (const action of restoreTabs(ui.state, openVaults)) {
      dispatch(action);
    }
  }, [ui.loaded, ui.state, openVaults, dispatch]);
  const { update } = ui;
  const { tabs: savedTabs, activeTab } = ui.state;
  useEffect(() => {
    if (!restored.current) {
      return;
    }
    const next = tabsToSave(tabs);
    if (
      next.activeTab !== activeTab ||
      JSON.stringify(next.tabs) !== JSON.stringify(savedTabs)
    ) {
      update(next);
    }
  }, [tabs, update, savedTabs, activeTab]);
}

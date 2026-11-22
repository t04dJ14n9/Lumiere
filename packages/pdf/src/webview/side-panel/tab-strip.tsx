import React, { useRef } from "react";
import { SIDE_PANEL_TABS, type SidePanelTab } from "../../shared/side-panel";

const TABS: Readonly<Record<SidePanelTab, { label: string; icon: string }>> = {
  thumbnails: { label: "Thumbnails", icon: "file-media" },
  outline: { label: "Outline", icon: "list-tree" },
  bookmarks: { label: "Bookmarks", icon: "bookmark" },
  annotations: { label: "Annotations", icon: "note" },
};

export function tabId(tab: SidePanelTab): string {
  return `sp-tab-${tab}`;
}

export function tabPanelId(tab: SidePanelTab): string {
  return `sp-tabpanel-${tab}`;
}

/**
 * The panel's tabs, drawn as the Panel's title tabs are: the chosen one in
 * the title colour with a line under it, the others dimmer until the pointer
 * is on them. Each is an icon, with its name in a tooltip and for assistive
 * technology: four names do not fit across a narrow panel. Left and Right
 * move between them and choose, Home and End go to the ends.
 */
export function TabStrip({
  tab,
  onSelect,
  onClose,
}: {
  tab: SidePanelTab;
  onSelect: (tab: SidePanelTab) => void;
  onClose: () => void;
}): React.JSX.Element {
  const buttons = useRef(new Map<SidePanelTab, HTMLButtonElement>());
  const move = (event: React.KeyboardEvent): void => {
    const next = nextTab(tab, event.key);
    if (next) {
      event.preventDefault();
      onSelect(next);
      buttons.current.get(next)?.focus();
    }
  };
  return (
    <div className="sp-tab-strip">
      <div
        className="sp-tabs"
        role="tablist"
        aria-label="Side panel"
        onKeyDown={move}
      >
        {SIDE_PANEL_TABS.map((name) => (
          <TabButton
            key={name}
            name={name}
            isSelected={name === tab}
            onSelect={onSelect}
            register={(button) => {
              if (button) {
                buttons.current.set(name, button);
              }
            }}
          />
        ))}
      </div>
      <button
        type="button"
        className="sp-action"
        title="Hide Side Panel"
        aria-label="Hide Side Panel"
        onClick={onClose}
      >
        <i className="codicon codicon-close" aria-hidden="true" />
      </button>
    </div>
  );
}

/** The tab a key moves to from `tab`, or undefined when the key is not a tab key. */
function nextTab(tab: SidePanelTab, key: string): SidePanelTab | undefined {
  const at = SIDE_PANEL_TABS.indexOf(tab);
  const last = SIDE_PANEL_TABS.length - 1;
  switch (key) {
    case "ArrowRight":
      return SIDE_PANEL_TABS[at === last ? 0 : at + 1];
    case "ArrowLeft":
      return SIDE_PANEL_TABS[at === 0 ? last : at - 1];
    case "Home":
      return SIDE_PANEL_TABS[0];
    case "End":
      return SIDE_PANEL_TABS[last];
    default:
      return undefined;
  }
}

function TabButton({
  name,
  isSelected,
  onSelect,
  register,
}: {
  name: SidePanelTab;
  isSelected: boolean;
  onSelect: (tab: SidePanelTab) => void;
  register: (button: HTMLButtonElement | null) => void;
}): React.JSX.Element {
  return (
    <button
      ref={register}
      type="button"
      role="tab"
      id={tabId(name)}
      className="sp-tab"
      aria-selected={isSelected}
      aria-controls={tabPanelId(name)}
      aria-label={TABS[name].label}
      title={TABS[name].label}
      tabIndex={isSelected ? 0 : -1}
      onClick={() => onSelect(name)}
    >
      <i className={`codicon codicon-${TABS[name].icon}`} aria-hidden="true" />
    </button>
  );
}

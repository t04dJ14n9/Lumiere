import React from "react";

/**
 * The line over a tab's list, as VS Code draws a view's title in the side
 * bar: the name in small capitals, how many there are as a badge, and the
 * view's actions (small icon buttons) at the right.
 */
export function SectionHeader({
  title,
  count,
  children,
}: {
  title: string;
  /** Shown as a badge; none when missing. */
  count?: number | undefined;
  /** The actions, `ActionButton`s. */
  children?: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className="sp-section-header">
      <span className="sp-section-title">{title}</span>
      {count !== undefined && count > 0 && (
        <span className="sp-badge" aria-label={`${count} in total`}>
          {count}
        </span>
      )}
      <span className="sp-spacer-flex" />
      <span
        className="sp-actions-bar"
        role="toolbar"
        aria-label={`${title} actions`}
      >
        {children}
      </span>
    </div>
  );
}

/** A view action: an icon button with a tooltip, as VS Code's action bars have. */
export function ActionButton({
  icon,
  label,
  onClick,
}: {
  icon: string;
  label: string;
  onClick: () => void;
}): React.JSX.Element {
  return (
    <button
      type="button"
      className="sp-action"
      title={label}
      aria-label={label}
      onClick={onClick}
    >
      <i className={`codicon codicon-${icon}`} aria-hidden="true" />
    </button>
  );
}

/** What a tab says when it has nothing to list, as a view's welcome text does. */
export function EmptyMessage({
  children,
}: {
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className="sp-empty" role="status">
      {children}
    </div>
  );
}

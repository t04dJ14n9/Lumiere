/**
 * The file tree's right-click menu, as VS Code's Explorer has it: New Note
 * and New Folder in the folder clicked (or the file's folder, or the
 * vault), Rename and Delete for the row clicked. And the question asked
 * before deleting for good where there is no trash.
 */
import { useEffect } from "react";
import { nameOf } from "../tree-edits";

export interface TreeMenuItem {
  readonly label: string;
  run(): void;
}

export function TreeMenu({
  at,
  items,
  onClose,
}: {
  readonly at: { readonly x: number; readonly y: number };
  readonly items: readonly TreeMenuItem[];
  readonly onClose: () => void;
}) {
  useEffect(() => {
    const close = () => onClose();
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    // After this click, so the click that opened the menu does not close it.
    const timer = setTimeout(() => window.addEventListener("click", close));
    window.addEventListener("keydown", closeOnEscape);
    window.addEventListener("blur", close);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("click", close);
      window.removeEventListener("keydown", closeOnEscape);
      window.removeEventListener("blur", close);
    };
  }, [onClose]);
  return (
    <div className="tree-menu" role="menu" style={{ left: at.x, top: at.y }}>
      {items.map((item) => (
        <button
          key={item.label}
          type="button"
          role="menuitem"
          onClick={() => {
            onClose();
            item.run();
          }}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}

/** Where the host has no trash: delete for good, once the reader says so. */
export function DeletePrompt({
  path,
  onAnswer,
}: {
  readonly path: string | undefined;
  readonly onAnswer: (deleteForGood: boolean) => void;
}) {
  if (path === undefined) {
    return null;
  }
  return (
    <div className="delete-prompt" role="alertdialog">
      <span>
        “{nameOf(path)}” cannot be moved to a trash here. Delete it for good?
      </span>
      <button type="button" onClick={() => onAnswer(true)}>
        Delete
      </button>
      <button type="button" onClick={() => onAnswer(false)}>
        Cancel
      </button>
    </div>
  );
}

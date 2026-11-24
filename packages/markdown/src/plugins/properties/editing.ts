import { propertyTransaction } from "./edit-transaction";
import type { EditorView } from "@codemirror/view";
import { frontmatter, type PropertyEdit } from "../../markdown/properties";
import { headerParts } from "../../markdown/properties/header-parts";
import { editGroup } from "../document/api";
import type { PropertyContext, Action } from "./context";
import {
  type PropertyKind,
  type PropertyTypes,
} from "../../markdown/properties/types";

interface PropertyEditingOptions {
  view(): EditorView | undefined;
  setStatus(message: string): void;
  action(action: Action): void;
  refresh(): void;
  setType(key: string, kind: PropertyKind | null): void;
  show(): void;
  focusTitle(): void;
  pageHeading(backward: boolean): void;
  signal: AbortSignal;
  propertyNames?(): Promise<readonly string[]>;
  setCollapsed?(collapsed: boolean): void;
}

type PropertyEditor = NonNullable<PropertyContext["propertyEditor"]>;

/**
 * Structured editing of the note's YAML properties (Obsidian's "Properties").
 *
 * Every change is a source edit of the frontmatter, so it shares the note's
 * undo history. Type preferences (text, number, date, ...) are stored by the
 * host per vault and property name, independently of the note’s YAML value.
 */
export class PropertyEditing {
  private preferences: PropertyTypes = {};
  private collapsed = false;
  private sequence = 0;

  constructor(private readonly options: PropertyEditingOptions) {}

  /** The `propertyEditor` capabilities handed to the rendered property sheet. */
  editor(source: string): PropertyEditor {
    return {
      source,
      currentSource: () => this.options.view()?.state.doc.toString() ?? "",
      refresh: () => {
        const owner = this.options.view();
        queueMicrotask(() => {
          if (owner && this.options.view() === owner) {
            this.options.refresh();
          }
        });
      },
      set: (expected, key, value, yaml) =>
        this.edit(expected, { type: "set", key, value, yaml }),
      edit: (expected, operation) => this.edit(expected, operation),
      isReadOnly: () => this.options.view()?.state.readOnly ?? false,
      types: () => this.preferences,
      setType: (key, kind) => {
        this.options.setType(key, kind);
      },
      names: () => this.options.propertyNames?.() ?? Promise.resolve([]),
      collapsed: () => this.collapsed,
      setCollapsed: (collapsed) => this.setCollapsed(collapsed),
      action: this.options.action,
      focusTitle: () => {
        const view = this.options.view();
        if (view) {
          this.options.focusTitle();
        }
      },
      pageHeading: (backward) => this.options.pageHeading(backward),
      focusBody: () => {
        const view = this.options.view();
        if (view) {
          // Place the caret after frontmatter (Obsidian: Escape → document)
          // without scrollIntoView. On tall Sources sheets, scrollIntoView
          // jumps from the key being edited (sheet top) to frontmatter end
          // (sheet tail / decision_confirmation), which is the host Escape
          // jump. Keep the current scroll; the user already sees the sheet.
          view.dispatch({
            selection: {
              anchor: frontmatter(view.state.doc.toString())?.end ?? 0,
            },
          });
          view.focus();
        }
      },
    };
  }

  /**
   * Apply `operation` if the frontmatter still reads `expected`. A display-only
   * sort is persisted together with the edit as one undoable change.
   */
  edit(expected: string, operation: PropertyEdit): boolean {
    const view = this.options.view();
    if (!view || view.state.readOnly) {
      return false;
    }
    const displayed = [
      ...view.dom.querySelectorAll<HTMLElement>(
        ".hybrid-properties .metadata-properties > [data-property-row]",
      ),
    ].map((row) => row.dataset.propertyRow!);
    const changeSet = propertyTransaction({
      document: view.state.doc,
      expected,
      operation,
      displayed,
    });
    if (!changeSet) {
      return false;
    }
    if (!changeSet.empty) {
      view.dispatch({
        changes: changeSet,
        annotations: editGroup.of(`property-${++this.sequence}`),
      });
    }
    return true;
  }

  /**
   * Obsidian's "Add alias": an empty `aliases` property, unless there is one,
   * then the caret in it, ready for a name. False, changing nothing, when
   * the editor is gone or read-only.
   */
  addAlias(): boolean {
    const view = this.options.view();
    if (!view || view.state.readOnly) {
      return false;
    }
    if (document.querySelector("dialog[open]")) {
      return true;
    }
    const header = frontmatter(view.state.doc.toString());
    if (header?.error) {
      this.options.setStatus(
        "Fix the properties source before adding an alias.",
      );
      return true;
    }
    this.options.show();
    if (!header?.values || !("aliases" in header.values)) {
      this.edit(header?.raw ?? "", { type: "add", key: "aliases" });
    }
    focusWhenShown(
      view.dom,
      '[data-property-list="aliases"] [data-property-list-input]',
    );
    return true;
  }

  /** Obsidian's "Clear file properties": the whole properties block goes. */
  clear(): boolean {
    const view = this.options.view();
    const source = view?.state.doc.toString() ?? "";
    const header = view && headerParts(source);
    if (!view || !header || view.state.readOnly) {
      return false;
    }
    // A note whose own text opens with a `---` block would have that block
    // read as its properties; a blank line keeps it text, as removing the
    // last property does. CodeMirror's text always separates lines with \n.
    const rest = source.slice(0, header.start) + source.slice(header.end);
    view.dispatch({
      changes: {
        from: header.start,
        to: header.end,
        insert: headerParts(rest) ? "\n" : "",
      },
      annotations: editGroup.of(`property-${++this.sequence}`),
    });
    return true;
  }

  /**
   * Obsidian's "Add file property": create the sheet if needed and start a
   * new row. False, changing nothing, when the editor is gone or read-only.
   */
  add(): boolean {
    const view = this.options.view();
    if (!view || view.state.readOnly) {
      return false;
    }
    if (document.querySelector("dialog[open]")) {
      return true;
    }
    const source = view.state.doc.toString();
    const header = frontmatter(source);
    if (header?.error || (!header && /^\uFEFF?---(?:\r?\n|$)/.test(source))) {
      this.options.setStatus(
        "Fix the properties source before adding a field.",
      );
      return true;
    }
    this.options.show();
    view.dispatch({
      selection: { anchor: header?.end ?? 0 },
    });
    queueMicrotask(() =>
      this.options
        .view()
        ?.dom.querySelector<HTMLButtonElement>("[data-property-add]")
        ?.click(),
    );
    return true;
  }

  /** Registry updates only change presentation; values and undo remain untouched. */
  receiveTypes(message: { types: PropertyTypes }): void {
    this.preferences = message.types;
    this.options.refresh();
  }

  get isCollapsed(): boolean {
    return this.collapsed;
  }

  /** Collapse or expand the sheet and remember it for the note. */
  setCollapsed(collapsed: boolean): void {
    this.receiveCollapsed(collapsed);
    this.options.setCollapsed?.(collapsed);
  }

  receiveCollapsed(collapsed: boolean): void {
    this.collapsed = collapsed;
    this.options.refresh();
  }
}

export function isNestedPropertyValue(value: unknown): boolean {
  const scalarList =
    Array.isArray(value) &&
    value.every(
      (item) =>
        item === null || ["string", "number", "boolean"].includes(typeof item),
    );
  return typeof value === "object" && value !== null && !scalarList;
}

/**
 * Focus the element `selector` names once the property sheet has rendered
 * it, which can take a few frames after an edit.
 */
function focusWhenShown(
  root: HTMLElement,
  selector: string,
  frames = 30,
): void {
  const target = root.querySelector<HTMLElement>(selector);
  if (target) {
    target.focus();
  } else if (frames > 0) {
    requestAnimationFrame(() => focusWhenShown(root, selector, frames - 1));
  }
}

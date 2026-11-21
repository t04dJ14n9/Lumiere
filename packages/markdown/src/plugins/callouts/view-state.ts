import { Schema } from "@workshop/core";
import type { EditorView } from "@codemirror/view";

/**
 * Which callouts the reader opened or closed in this panel. As in Obsidian,
 * a callout starts as its note says (`-` closed, `+` or nothing open) every
 * time the note loads: a toggle lasts while the panel's view does, through
 * re-renders and a move of the view (a rename, Back and Forward), but is not
 * saved for a reload or another panel.
 */
export class DisclosureState {
  readonly schema = Schema.record(Schema.boolean());
  readonly transient = true;
  private values = new Map<string, boolean>();
  private bindings = new Set<{
    key: string;
    details: { open: boolean };
    initial: boolean;
    measure(): void;
  }>();
  constructor(private readonly source: string) {}
  capture() {
    return Object.fromEntries(this.values);
  }
  restore(_view: EditorView, values: Record<string, boolean>, source: string) {
    this.values.clear();
    for (const [key, open] of Object.entries(values)) {
      const local =
        source &&
        (key.startsWith(source + "|") || key.startsWith(source + "/"));
      this.values.set(
        local ? this.source + key.slice(source.length) : key,
        open,
      );
    }
    for (const binding of this.bindings) {
      binding.details.open = this.values.get(binding.key) ?? binding.initial;
      binding.measure();
    }
  }
  bind(key: string, details: { open: boolean }, measure: () => void) {
    const binding = { key, details, initial: details.open, measure };
    this.bindings.add(binding);
    details.open = this.values.get(key) ?? details.open;
    return {
      remember: () => {
        this.values.set(key, details.open);
      },
      dispose: () => {
        this.bindings.delete(binding);
      },
    };
  }
}

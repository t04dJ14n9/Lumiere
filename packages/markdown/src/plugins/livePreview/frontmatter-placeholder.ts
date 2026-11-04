import { WidgetType } from "@codemirror/view";
import type { EditorState } from "@codemirror/state";
import type { SyntaxNodeRef } from "@lezer/common";
import { headerParts } from "../../markdown/properties/header-parts";
import { blockRenderers } from "./registry";
import type { BlockRenderer } from "./api";

/**
 * Sheet chrome / row floors mirrored from `properties/estimated-height`
 * (COLLAPSED / SHEET_CHROME / ROW / ROW_GAP) — kept local so livePreview does
 * not import the properties plugin. Reserves near the expanded sheet height
 * until the real Properties widget mounts so the heading does not jump.
 */
const TEXT = 14;
const LINE = TEXT * 1.5;
const VALUE_MIN = TEXT * 1.75 + 4;
const ROW = VALUE_MIN;
const ROW_GAP = 3;
const HEADING = LINE + 8;
const ADD_BUTTON = 8 + 8 + LINE;
const SHEET_PADDING = 8 + 32;
const SHEET_CHROME = SHEET_PADDING + HEADING + ADD_BUTTON;
const COLLAPSED = SHEET_PADDING + HEADING;

/** Bound fence probes so match never slices a multi-MB note. */
const FRONTMATTER_PROBE_MAX = 64 * 1024;

/**
 * True when the Lezer Frontmatter node spans a complete `---` / `---` fence.
 * Truncated first-paint trees cut mid-YAML (`node.to` before the closing
 * fence); matching those would hide only the opening band and leave the rest
 * of the fence as raw glyphs.
 */

export function completeFrontmatter(
  state: EditorState,
  node: SyntaxNodeRef,
): boolean {
  if (node.name !== "Frontmatter" || node.from !== 0) {
    return false;
  }
  // Probe the note (not just node.to): a truncated first-paint Frontmatter
  // node ends mid-YAML while headerParts on the real fence still finds the
  // closing marker further down. Lezer's node.to omits the trailing EOL that
  // headerParts includes in `end`.
  const header = headerParts(
    state.doc.sliceString(0, Math.min(state.doc.length, FRONTMATTER_PROBE_MAX)),
  );
  if (!header) {
    return false;
  }
  return node.to >= header.end - header.eol.length;
}

/** Properties (or any later chrome) owns Frontmatter once registered. */
export function propertiesRendererRegistered(state: EditorState): boolean {
  return state
    .facet(blockRenderers)
    .some((renderer) => renderer.kind === "properties");
}

/**
 * Rough expanded Properties height from YAML body lines — no YAML parse.
 * Top-level (non-indented, non-empty) rows each reserve one control; indented
 * continuations are ignored so multiline values stay a floor, not a guess.
 */
export function frontmatterPlaceholderHeight(source: string): number {
  const header = headerParts(source.slice(0, FRONTMATTER_PROBE_MAX));
  if (!header) {
    return 0;
  }
  let rows = 0;
  for (const line of header.body.split(/\r?\n/)) {
    if (!line.trim() || /^[ \t]/.test(line)) {
      continue;
    }
    rows += 1;
  }
  if (rows === 0) {
    return COLLAPSED;
  }
  return SHEET_CHROME + rows * ROW + (rows - 1) * ROW_GAP;
}

/**
 * Collapse a complete YAML fence before the Properties feature chunk
 * configures. Heading + body enter the viewport from core Live Preview alone;
 * Properties replaces this widget when its renderer registers.
 */
export function frontmatterPlaceholderRenderer(): BlockRenderer {
  return {
    kind: "frontmatter-placeholder",
    nodes: ["Frontmatter"],
    editing: "widget",
    match: (node, state) =>
      !propertiesRendererRegistered(state) && completeFrontmatter(state, node),
    widget: (block) => new FrontmatterPlaceholder(block.source),
  };
}

class FrontmatterPlaceholder extends WidgetType {
  constructor(private readonly source: string) {
    super();
  }

  override eq(other: FrontmatterPlaceholder): boolean {
    return this.source === other.source;
  }

  override toDOM(): HTMLElement {
    const wrapper = document.createElement("div");
    wrapper.className = "hybrid-properties mw-frontmatter-placeholder";
    wrapper.setAttribute("aria-hidden", "true");
    // Mirror collapsed Properties chrome so CSS already on the editor sheet
    // paints a familiar bar; the real PropertyWidget replaces this on configure.
    // minHeight still tracks the expanded estimate so body layout stays put.
    wrapper.innerHTML =
      '<div class="properties metadata-container is-collapsed">' +
      '<div class="metadata-properties-heading" data-properties-heading>' +
      '<span class="metadata-properties-title">Properties</span></div></div>';
    const reserve = this.estimatedHeight;
    if (reserve > 0 && wrapper.style) {
      wrapper.style.minHeight = `${reserve}px`;
    }
    return wrapper;
  }

  override get estimatedHeight(): number {
    return frontmatterPlaceholderHeight(this.source);
  }

  override ignoreEvent(): boolean {
    return true;
  }
}

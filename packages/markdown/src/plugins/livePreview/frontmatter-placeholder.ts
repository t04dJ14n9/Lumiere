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
 * True for a line that opens a top-level mapping entry, i.e. one Properties
 * row. Blanks, indented continuations, `#` comments and flush `- item` lines
 * (YAML lets a sequence sit unindented under its key) belong to a row or to
 * none, so they must not add a control to the reserve.
 */
function opensTopLevelEntry(line: string): boolean {
  if (!line.trim() || /^[ \t#]/.test(line)) {
    return false;
  }
  return !/^-(?:[ \t]|$)/.test(line);
}

/**
 * Rough expanded Properties height from YAML body lines — no YAML parse.
 * Each top-level key reserves one control; everything else is ignored so
 * multiline values stay a floor, not a guess.
 *
 * It always reserves the expanded sheet, even for a note whose Properties are
 * stored collapsed (`properties/collapse-store`). That flag lives in the
 * host's preference store and reaches the webview only over the Properties
 * RPC, after the Properties plugin has configured, which is also when this
 * placeholder stops matching. livePreview may not import that plugin, and the
 * editor protocol's `ready` payload that could carry the flag is a contract
 * with the host, so a collapsed note still paints one expanded-height frame
 * first.
 */
export function frontmatterPlaceholderHeight(source: string): number {
  const header = headerParts(source.slice(0, FRONTMATTER_PROBE_MAX));
  if (!header) {
    return 0;
  }
  const rows = header.body.split(/\r?\n/).filter(opensTopLevelEntry).length;
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

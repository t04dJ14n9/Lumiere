import { metadata } from "../../markdown/metadata";
import { SourceCoordinates } from "../../shared/document/coordinates";
import type { TreeNode, TreeSource } from "../../shared/host";
import { OPEN_COMMAND } from "./commands";
import { headingAt, outlineOf } from "./headings";
import type { OutlineHeading } from "./headings";

/**
 * A heading row dropped in the outline: the note and the text the rows were
 * built from, and where the section goes (offsets in that text).
 */
export interface SectionDrop {
  uri: string;
  text: string;
  heading: number;
  /** The heading it goes before; undefined for the end of the note. */
  beforeHeading: number | undefined;
}

/** The active note's headings, indexed for navigation and native tree reveals. */
export class OutlineSource implements TreeSource {
  private uri: string | undefined;
  private outline: OutlineHeading[] = [];
  private coordinates = new SourceCoordinates("");
  private readonly byId = new Map<string, OutlineHeading>();
  /** When true, parents emit `expanded: true` (expandMode `all`). Default false = accordion. */
  parentsStartExpanded = false;

  constructor(
    private readonly moveSection?: (drop: SectionDrop) => Promise<void>,
  ) {}

  get isEmpty(): boolean {
    return this.outline.length === 0;
  }

  set(uri: string | undefined, text: string): void {
    this.uri = uri;
    this.coordinates = new SourceCoordinates(text);
    this.outline = uri ? outlineOf(metadata(text).headings) : [];
    this.byId.clear();
    this.index(this.outline);
  }

  private index(headings: readonly OutlineHeading[]): void {
    for (const heading of headings) {
      this.byId.set(heading.id, heading);
      this.index(heading.children);
    }
  }

  /** The heading section at an editor offset (line breaks count once). */
  activeNode(editorOffset: number): TreeNode | undefined {
    return this.nodeAtSource(this.coordinates.toSource(editorOffset));
  }

  /** The heading section at an offset in the file's own text (CRLF intact). */
  nodeAtSource(sourceOffset: number): TreeNode | undefined {
    const heading = headingAt(this.outline, sourceOffset);
    return heading ? this.node(heading) : undefined;
  }

  roots(): TreeNode[] {
    return this.outline.map((heading) => this.node(heading));
  }

  /** Parents precede their children so Expand All can reveal them in order. */
  allNodes(): TreeNode[] {
    return [...this.byId.values()].map((heading) => this.node(heading));
  }

  children(node: TreeNode): TreeNode[] {
    const heading = this.byId.get(node.id);
    return heading ? heading.children.map((child) => this.node(child)) : [];
  }

  parent(node: TreeNode): TreeNode | undefined {
    const parent = this.byId.get(node.id)?.parent;
    return parent ? this.node(parent) : undefined;
  }

  /**
   * A row dropped on another moves its section before that heading; dropped
   * below the last row, to the end of the note.
   */
  async drop(dragged: TreeNode, target: TreeNode | undefined): Promise<void> {
    const heading = this.byId.get(dragged.id);
    const before = target && this.byId.get(target.id);
    if (!this.uri || !heading || (target && !before)) {
      return;
    }
    await this.moveSection?.({
      uri: this.uri,
      text: this.coordinates.source,
      heading: heading.offset,
      beforeHeading: before?.offset,
    });
  }

  pathTo(node: TreeNode): TreeNode[] {
    const path: TreeNode[] = [];
    let current: TreeNode | undefined = node;
    while (current) {
      path.unshift(current);
      current = this.parent(current);
    }
    return path;
  }

  private node(heading: OutlineHeading): TreeNode {
    return {
      id: heading.id,
      label: heading.title,
      ...(heading.children.length > 0 && {
        expanded: this.parentsStartExpanded,
      }),
      command: { id: OPEN_COMMAND, args: [this.uri, heading.offset] },
    };
  }
}

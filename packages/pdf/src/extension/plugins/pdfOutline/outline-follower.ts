import * as vscode from "vscode";
import type { OutlineItem } from "../../../shared/messages";
import { findActiveOutlineItem, followPosition } from "../../../shared/outline";
import type { PdfSettings } from "../../settings";
import type { PdfPanels } from "../pdf/panels";

export const VIEW_ID = "lumiere.pdf.outline";
export const FOLLOW_SETTING = "lumiere.pdf.outline.followCursor";
const FOLLOW_CONTEXT = "lumiere.pdf.outlineFollowCursor";
/**
 * How long after a click on a bookmark the jump it made is left alone:
 * long enough for a double-click's second click and the viewer's reply.
 */
const OUTLINE_JUMP_MS = 1000;

/** What following reads of the tree's provider. */
export interface OutlineTree {
  /** Every bookmark, parents before children. */
  readonly nodes: readonly OutlineItem[];
  getChildren(item?: OutlineItem): OutlineItem[];
  getParent(item: OutlineItem): OutlineItem | undefined;
  /** With the accordion, every branch starts closed; following opens one path. */
  setAccordion(on: boolean): void;
}

/** A bookmark a click in the outline opened, and whether the viewer got there. */
interface OutlineJump {
  item: OutlineItem;
  until: number;
  landed: boolean;
}

/**
 * With "follow cursor" on, keeps the bookmark of the reading position
 * selected, as an accordion: its parents and its own children are open,
 * every other branch is closed (as Markdown Outline does).
 */
export class OutlineFollower implements vscode.Disposable {
  private disposed = false;
  private enabled = false;
  private following = false;
  private followed: OutlineItem | undefined;
  /** The branches the accordion opened last, top first. */
  private opened: readonly OutlineItem[] | undefined;
  private jump: OutlineJump | undefined;

  constructor(
    private readonly view: vscode.TreeView<OutlineItem>,
    private readonly provider: OutlineTree,
    private readonly panels: PdfPanels,
    private readonly log: Pick<vscode.LogOutputChannel, "warn">,
  ) {}

  get isDisposed(): boolean {
    return this.disposed;
  }

  dispose(): void {
    this.disposed = true;
  }

  /** The reading position moved; with a new tree, select from scratch. */
  treeChanged(newTree: boolean): void {
    if (newTree) {
      this.followed = undefined;
      this.opened = undefined;
    }
    void this.follow();
  }

  /**
   * A click on the bookmark for `page` and `top` opened it. Until the
   * reading position moves on from there, the tree is not laid out again:
   * the row is already selected, and closing branches would move rows under
   * the pointer, so a double-click's second click would land on another
   * bookmark. The viewer may first report where it was, which is left
   * alone too.
   */
  jumpedTo(page: number, top: number | undefined): void {
    const item = findActiveOutlineItem(this.provider.getChildren(), {
      page,
      top: top ?? 0,
    });
    this.jump = item && {
      item,
      until: Date.now() + OUTLINE_JUMP_MS,
      landed: false,
    };
  }

  applySetting(): void {
    const enabled = vscode.workspace
      .getConfiguration()
      .get<boolean>(FOLLOW_SETTING, true);
    if (enabled !== this.enabled) {
      this.enabled = enabled;
      this.followed = undefined;
      this.opened = undefined;
      this.provider.setAccordion(enabled);
    }
    void Promise.resolve(
      vscode.commands.executeCommand("setContext", FOLLOW_CONTEXT, enabled),
    ).catch((error) =>
      this.log.warn(
        `Could not update the PDF outline context: ${String(error)}`,
      ),
    );
    void this.follow();
  }

  async setEnabled(enabled: boolean, settings: PdfSettings): Promise<void> {
    await settings.update(FOLLOW_SETTING, enabled);
    if (!this.disposed) {
      this.applySetting();
    }
  }

  /**
   * Serialize reveals, then re-read the active panel: a scroll or tab switch
   * during a reveal must finish with the newest position selected. Never
   * rejects; event handlers can start it without awaiting it.
   */
  private async follow(): Promise<void> {
    if (this.disposed || this.following) {
      return;
    }
    this.following = true;
    try {
      while (!this.disposed && this.enabled && this.view.visible) {
        if (!(await this.revealNext())) {
          break;
        }
      }
    } finally {
      this.following = false;
    }
  }

  /** Reveal the reading position's bookmark; false when there is no more to do. */
  private async revealNext(): Promise<boolean> {
    const panel = this.panels.active;
    const state = panel?.view;
    if (!state) {
      return false;
    }
    const item = findActiveOutlineItem(
      this.provider.getChildren(),
      followPosition(state),
    );
    if (!item) {
      return false;
    }
    // Before the same-item check: a repeated click must still land.
    if (this.isOutlineJump(item)) {
      this.followed = item;
      return false;
    }
    if (item === this.followed) {
      return false;
    }
    this.followed = item;
    try {
      await this.applyAccordion(item);
      return true;
    } catch (error) {
      this.followed = undefined;
      this.opened = undefined;
      if (this.disposed) {
        return false;
      }
      // Old nodes can disappear while VS Code is resolving their parents.
      if (panel !== this.panels.active || !this.provider.nodes.includes(item)) {
        return true;
      }
      this.log.warn(`Could not follow the PDF outline: ${String(error)}`);
      return false;
    }
  }

  /**
   * Open `item`'s parents and its own children and select it, closing the
   * other branches only when one that is open is not on its path: VS Code can
   * close a single row only through the whole-tree collapse, which flashes the
   * tree shut and open again, so a move that only opens rows (into a bookmark
   * that has children, or deeper) leaves the rest alone.
   */
  private async applyAccordion(item: OutlineItem): Promise<void> {
    const path: OutlineItem[] = [];
    for (
      let node: OutlineItem | undefined = item;
      node;
      node = this.provider.getParent(node)
    ) {
      path.unshift(node);
    }
    const branches = path.filter((node) => node.children.length > 0);
    const opened = this.opened;
    const mustClose =
      !opened || opened.some((branch) => !branches.includes(branch));
    // A flat outline has nothing to close (and `branches` is empty).
    if (mustClose && this.provider.nodes.some((node) => node.children.length)) {
      await vscode.commands.executeCommand(
        `workbench.actions.treeView.${VIEW_ID}.collapseAll`,
      );
    }
    const toOpen =
      mustClose || !opened
        ? branches
        : branches.filter((branch) => !opened.includes(branch));
    for (const branch of toOpen) {
      if (this.disposed) {
        return;
      }
      await this.view.reveal(branch, {
        select: false,
        focus: false,
        expand: true,
      });
    }
    this.opened = branches;
    if (!this.disposed) {
      await this.view.reveal(item, {
        select: true,
        focus: false,
        expand: false,
      });
    }
  }

  /** Whether `item` is still where an outline click put the reader, or on its way. */
  private isOutlineJump(item: OutlineItem): boolean {
    const jump = this.jump;
    if (!jump || Date.now() > jump.until) {
      this.jump = undefined;
      return false;
    }
    if (item === jump.item) {
      jump.landed = true;
      return true;
    }
    if (jump.landed) {
      // The reader moved on from the bookmark the click opened.
      this.jump = undefined;
      return false;
    }
    // The position from before the click, reported before the jump landed.
    return true;
  }
}

import test from "node:test";
import assert from "node:assert/strict";
import Module, { createRequire } from "node:module";
import type * as ReclaimModule from "../../../src/host/reclaim";
import type * as ReclaimTransferModule from "../../../src/host/reclaim-transfer";
import {
  associatedWith,
  Bypass,
  cursorMarkdownEditorTakes,
  Lease,
  isReclaimableNote,
  reclaimEnabled,
  shouldReclaim,
  shouldHoldNativeAfterReclaim,
  shouldWarmBeforeReclaim,
  nativeStayBlocks,
  TabSwaps,
} from "../../../src/host/reclaim-policy";
import { hasNativeOptOut } from "../../../src/host/reclaim-opt-out";
import { readerText } from "../../../src/host/reader-text";
import { setMarkdownAbsentOnDiskForTests } from "../../../src/host/markdown-absent-on-disk";
import { MARKDOWN_EDITOR } from "../../../src/shared/editor-provider";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type {
  TabChange,
  TabKind,
  TabSwap,
} from "../../../src/host/reclaim-policy";

const note = "file:///vault/Note.md";
const context = {
  enabled: true,
  isNote: isReclaimableNote,
  associated: () => true,
  bypassed: () => false,
};
const swap = (before: TabKind, after: TabKind, uri = note) => ({
  uri,
  before,
  after,
});

test("only a materialized text tab can skip the foreground reclaim warm", () => {
  assert.equal(shouldWarmBeforeReclaim("text", true), false);
  assert.equal(shouldWarmBeforeReclaim("text", false), true);
  for (const kind of ["other", "workbench", "none"] as const) {
    assert.equal(shouldWarmBeforeReclaim(kind, true), true);
    assert.equal(shouldWarmBeforeReclaim(kind, false), true);
  }
});

test("auto reclaims only in Cursor; on and off are explicit", () => {
  assert.equal(reclaimEnabled({ mode: "auto", appName: "Cursor" }), true);
  assert.equal(
    reclaimEnabled({ mode: "auto", appName: "Visual Studio Code" }),
    false,
  );
  assert.equal(
    reclaimEnabled({ mode: "on", appName: "Visual Studio Code" }),
    true,
  );
  assert.equal(reclaimEnabled({ mode: "off", appName: "Cursor" }), false);
  assert.equal(
    reclaimEnabled({ mode: "auto", appName: "Visual Studio Code" }, true),
    true,
  );
  assert.equal(reclaimEnabled({ mode: "off", appName: "Cursor" }, true), false);
});

test("in-place reclaim is opt-in (default off); none→text always; bypass still false", () => {
  // Default: workbench→text is not reclaimed (pre-#468 / fcf559b3 text rule).
  assert.equal(shouldReclaim(swap("workbench", "text"), context), false);
  assert.equal(shouldReclaim(swap("other", "text"), context), false);
  // none→text still reclaims either way.
  assert.equal(shouldReclaim(swap("none", "text"), context), true);
  assert.equal(
    shouldReclaim(swap("none", "text"), { ...context, reclaimInPlace: true }),
    true,
  );
  // Opt-in: approach A — before !== "text" for after===text.
  assert.equal(
    shouldReclaim(swap("workbench", "text"), {
      ...context,
      reclaimInPlace: true,
    }),
    true,
  );
  assert.equal(
    shouldReclaim(swap("other", "text"), { ...context, reclaimInPlace: true }),
    true,
  );
  assert.equal(
    shouldReclaim(swap("text", "text"), { ...context, reclaimInPlace: true }),
    false,
  );
  assert.equal(
    shouldReclaim(swap("workbench", "text"), {
      ...context,
      reclaimInPlace: true,
      bypassed: () => true,
    }),
    false,
  );
});

test("a note Cursor remembers as text is reclaimed when it opens", () => {
  assert.equal(shouldReclaim(swap("none", "text"), context), true);
  assert.equal(shouldReclaim(swap("text", "text"), context), false);
});

test("a switch into Cursor's input-less Markdown editor is reclaimed", () => {
  for (const before of ["text", "workbench"] as const) {
    assert.equal(shouldReclaim(swap(before, "other"), context), true);
  }
  assert.equal(shouldReclaim(swap("other", "other"), context), false);
  assert.equal(
    shouldReclaim(swap("workbench", "other"), {
      ...context,
      associated: () => false,
    }),
    false,
  );
  assert.equal(
    shouldReclaim(swap("workbench", "other"), { ...context, enabled: false }),
    false,
  );
  assert.equal(
    shouldReclaim(swap("workbench", "other"), {
      ...context,
      bypassed: () => true,
    }),
    false,
  );
});

test("a restored or primary Cursor Markdown tab is reclaimed when its label names a note", () => {
  // adoptOpenTabs and a first open classify as none→other. labelUri only
  // resolves when exactly one open textDocument matches the tab label, and
  // the file must be one Cursor's Markdown editor takes (not a plan file; see
  // the tests below). Reclaiming none→other restores Lumiere menus (Copy link /
  // Format) on the Preview | Markdown repro path.
  assert.equal(shouldReclaim(swap("none", "other"), context), true);
  assert.equal(
    shouldReclaim(swap("none", "other"), {
      ...context,
      associated: () => false,
    }),
    false,
  );
});

test("Cursor's Markdown editor takes .md files, not plan files or agent config folders", () => {
  for (const uri of [
    "file:///vault/Note.md",
    "file:///vault/sub%20dir/Upper.MD",
    "file:///vault/.hidden/Note.md",
    "file:///vault/notes.plan/Note.md",
  ]) {
    assert.equal(cursorMarkdownEditorTakes(uri), true, uri);
  }
  for (const uri of [
    "file:///vault/My%20Plan.plan.md",
    "file:///vault/My.PLAN.MD",
    "file:///vault/.cursor/plans/feature.plan.md",
    "file:///vault/.cursor/rules/Note.md",
    "file:///vault/.claude/commands/Note.md",
    "file:///vault/pkg/.codex/Note.md",
    "file:///vault/Note.markdown",
    "file:///vault/Note.txt",
  ]) {
    assert.equal(cursorMarkdownEditorTakes(uri), false, uri);
  }
});

test("an input-less tab that opened from nowhere is reclaimed only for a file Cursor's Markdown editor takes", () => {
  // Cursor's plan editor is input-less too and names its tab by basename, so
  // none→other for a plan file (or any file that editor never opens) is not
  // evidence of Cursor Markdown.
  assert.equal(shouldReclaim(swap("none", "other", note), context), true);
  for (const uri of [
    "file:///vault/My.plan.md",
    "file:///vault/.cursor/plans/feature.plan.md",
    "file:///vault/.claude/skills/Note.md",
    "file:///vault/Note.markdown",
  ]) {
    assert.equal(
      shouldReclaim(swap("none", "other", uri), context),
      false,
      uri,
    );
  }
});

test("an in-place switch into an input-less tab is identified by the note tab it replaced", () => {
  // The replaced tab is the positive signal, so the file name is not judged.
  for (const before of ["text", "workbench"] as const) {
    assert.equal(
      shouldReclaim(swap(before, "other", "file:///vault/Note.md"), context),
      true,
    );
  }
  assert.equal(
    shouldReclaim(swap("other", "other", "file:///vault/Note.md"), context),
    false,
  );
});

test("readerText sticks text only; Cursor Markdown still reclaims to Lumiere", () => {
  const stay = { bypass: false, handoff: false, readerText: true };
  assert.equal(nativeStayBlocks("text", stay), true);
  assert.equal(nativeStayBlocks("other", stay), false);
  assert.equal(
    nativeStayBlocks("other", {
      bypass: true,
      handoff: false,
      readerText: true,
    }),
    true,
  );
  assert.equal(
    nativeStayBlocks("other", {
      bypass: false,
      handoff: true,
      readerText: false,
    }),
    true,
  );
});

test("hasNativeOptOut: readerText alone does not block Cursor Markdown transfer", () => {
  // Transfer calls hasNativeOptOut(uri, request.kind). The default after="text"
  // would incorrectly keepNative/abort an other (Cursor Markdown) reclaim when
  // only readerText is stuck — pass kind so other ignores readerText.
  const uri = "file:///vault/ReaderTextOther.md";
  readerText.restore(undefined);
  readerText.keep(uri);
  try {
    assert.equal(hasNativeOptOut(uri), true);
    assert.equal(hasNativeOptOut(uri, "text"), true);
    assert.equal(hasNativeOptOut(uri, "other"), false);
  } finally {
    readerText.clear();
  }

  const transfer = readFileSync(
    join(
      dirname(fileURLToPath(import.meta.url)),
      "../../../src/host/reclaim-transfer.ts",
    ),
    "utf8",
  );
  const calls = [...transfer.matchAll(/hasNativeOptOut\(([^)]+)\)/g)].map(
    (m) => m[1],
  );
  assert.equal(calls.length, 3);
  for (const args of calls) {
    assert.ok(typeof args === "string");
    assert.match(args, /request\.kind/);
  }
});

test("the handoff from Cursor Markdown into Lumiere is left in place", () => {
  assert.equal(shouldReclaim(swap("other", "workbench"), context), false);
  assert.equal(shouldReclaim(swap("text", "workbench"), context), false);
  assert.equal(shouldReclaim(swap("workbench", "workbench"), context), false);
});

test("only notes the workspace routes to Lumiere are reclaimed", () => {
  const associations = { "*.md": "lumiere.markdown.editor" };
  const viewType = "lumiere.markdown.editor";
  assert.equal(associatedWith(associations, note, viewType), true);
  assert.equal(
    associatedWith(associations, "file:///a.markdown", viewType),
    false,
  );
  assert.equal(associatedWith(undefined, note, viewType), false);
  assert.equal(
    associatedWith({ "*.md": "default" }, note, viewType, true),
    true,
  );
  assert.equal(
    associatedWith({ "*.md": "default" }, note, viewType, false),
    false,
  );
  assert.equal(shouldReclaim(swap("none", "text"), context), true);
  assert.equal(
    shouldReclaim(swap("none", "text"), {
      ...context,
      associated: () => false,
    }),
    false,
  );
});

test("diffs and other files are left alone", () => {
  assert.equal(shouldReclaim(swap("workbench", "none"), context), false);
  for (const uri of [
    "untitled:Note.md",
    "git:/vault/Note.md",
    "file:///a.ts",
  ]) {
    assert.equal(
      shouldReclaim(swap("workbench", "other", uri), context),
      false,
    );
  }
  assert.equal(
    shouldReclaim(swap("none", "text", "untitled:Untitled-1"), context),
    false,
  );
  assert.equal(
    shouldReclaim(swap("none", "text", "git:/vault/Note.md"), context),
    false,
  );
  assert.equal(
    shouldReclaim(swap("none", "text", "file:///vault/a.ts"), context),
    false,
  );
  assert.equal(
    shouldReclaim(swap("none", "text"), { ...context, enabled: false }),
    false,
  );
});

test("notes opened as text on purpose, or just reclaimed, keep the text editor", () => {
  let now = 0;
  const bypass = new Bypass(() => now, 10_000);
  bypass.allow(note);
  const withBypass = { ...context, bypassed: (uri: string) => bypass.has(uri) };
  assert.equal(shouldReclaim(swap("none", "text"), withBypass), false);
  now = 10_001;
  assert.equal(shouldReclaim(swap("none", "text"), withBypass), true);
});

test("a tab landing during the post-reclaim hold stays native", () => {
  // Host GUI S6: second Reopen With Text Editor within 10s → hold, and promote
  // textBypass so selection reclaim does not steal the tab.
  assert.equal(
    shouldHoldNativeAfterReclaim({ recentTransfer: true, reclaimable: true }),
    true,
  );
  assert.equal(
    shouldHoldNativeAfterReclaim({ recentTransfer: false, reclaimable: true }),
    false,
  );
  assert.equal(
    shouldHoldNativeAfterReclaim({
      recentTransfer: true,
      reclaimable: false,
    }),
    false,
  );
  assert.equal(
    shouldHoldNativeAfterReclaim({
      recentTransfer: true,
      reclaimable: true,
      hasSelectionTarget: true,
    }),
    false,
    "a search or reference jump carrying a selection target must still reclaim within the cooldown",
  );
});

test("a pending handoff lease suppresses reclaim until released", () => {
  const lease = new Lease();
  const pending = lease.acquire(note);
  const withLease = {
    ...context,
    bypassed: (uri: string) => lease.has(uri),
  };
  assert.equal(shouldReclaim(swap("none", "text"), withLease), false);
  pending.release();
  assert.equal(shouldReclaim(swap("none", "text"), withLease), true);
});

test("overlapping tokens keep the lease until every owner releases", () => {
  const lease = new Lease();
  const first = lease.acquire(note);
  first.promote();
  const second = lease.acquire(note);
  const withLease = {
    ...context,
    bypassed: (uri: string) => lease.has(uri),
  };
  assert.equal(shouldReclaim(swap("none", "text"), withLease), false);
  second.release();
  assert.equal(lease.has(note), true);
  assert.equal(shouldReclaim(swap("none", "text"), withLease), false);
  first.release();
  assert.equal(lease.has(note), false);
  assert.equal(shouldReclaim(swap("none", "text"), withLease), true);
});

test("session clear preserves pending tokens until they are promoted", () => {
  const lease = new Lease();
  const established = lease.acquire(note);
  established.promote();
  const pending = lease.acquire(note);
  lease.clear(note);
  assert.equal(lease.has(note), true);
  lease.clear(note);
  assert.equal(
    lease.has(note),
    true,
    "repeated tab events must keep pending owners",
  );

  pending.promote();
  pending.promote();
  lease.clear(note);
  assert.equal(lease.has(note), false);
});

test("failed pending tokens release only themselves after session clear", () => {
  const lease = new Lease();
  lease.acquire(note).promote();
  const firstPending = lease.acquire(note);
  const secondPending = lease.acquire(note);
  lease.clear(note);
  firstPending.release();
  firstPending.release();
  assert.equal(
    lease.has(note),
    true,
    "another pending handoff still owns the URI",
  );
  secondPending.release();
  assert.equal(lease.has(note), false);
});

test("released and cleared tokens cannot revive sessions or release newer owners", () => {
  const lease = new Lease();
  const cancelled = lease.acquire(note);
  cancelled.release();
  cancelled.promote();
  assert.equal(lease.has(note), false);

  const expired = lease.acquire(note);
  expired.promote();
  lease.clear(note);
  expired.promote();
  assert.equal(lease.has(note), false);
  const retry = lease.acquire(note);
  cancelled.release();
  expired.release();
  expired.promote();
  assert.equal(lease.has(note), true);
  lease.clear(note);
  assert.equal(
    lease.has(note),
    true,
    "stale promotion must not establish the retry",
  );
  retry.release();
  assert.equal(lease.has(note), false);
});

test("clearing one URI leaves other pending and established owners alone", () => {
  const lease = new Lease();
  const other = "file:///vault/Other.md";
  lease.acquire(note).promote();
  const pending = lease.acquire(other);
  lease.acquire(other).promote();
  lease.clear(note);
  pending.release();
  assert.equal(lease.has(note), false);
  assert.equal(lease.has(other), true);
  lease.clear(other);
  assert.equal(lease.has(other), false);
});

interface FakeTab {
  readonly uri: string | undefined;
  readonly kind: TabKind;
  readonly group: FakeGroup;
}
interface FakeGroup {
  tabs: FakeTab[];
  activeTab: FakeTab | undefined;
}

/** Tab groups that report changes in the order VS Code does. */
function workbench(groupCount = 1) {
  const groups: FakeGroup[] = Array.from({ length: groupCount }, () => ({
    tabs: [],
    activeTab: undefined,
  }));
  let focused = groups[0]!;
  const swaps = new TabSwaps<FakeTab>({
    facts: (tab) => ({ uri: tab.uri, kind: tab.kind }),
    groupOf: (tab) => tab.group,
    shownTab: () => focused.activeTab,
  });
  const judged: TabSwap[] = [];
  /** Notes in a Cursor Edit session: their swaps are held, as reclaim does. */
  const leased = new Set<string>();
  const emit = (
    change: Partial<TabChange<FakeTab>>,
    endedSessions: readonly string[] = [],
  ) => {
    const due = swaps.next(
      { opened: [], changed: [], ...change },
      new Set(endedSessions),
    );
    for (const { tab, swap } of due) {
      if (leased.has(swap.uri)) {
        swaps.hold(tab, swap);
      } else {
        judged.push(swap);
      }
    }
  };
  const activate = (tab: FakeTab) => {
    tab.group.activeTab = tab;
    emit({ changed: [tab] });
  };
  /** A new tab opens inactive, right after the active one. */
  const add = (kind: TabKind, uri: string | undefined, group: FakeGroup) => {
    const tab = { uri, kind, group };
    const active = group.activeTab ? group.tabs.indexOf(group.activeTab) : -1;
    group.tabs.splice(active + 1, 0, tab);
    emit({ opened: [tab] });
    return tab;
  };
  return {
    groups,
    judged,
    leased,
    add,
    activate,
    focus(group: FakeGroup) {
      focused = group;
    },
    open(kind: TabKind, uri = note, group = groups[0]!) {
      const tab = add(kind, uri, group);
      activate(tab);
      return tab;
    },
    /**
     * Cursor's Preview | Markdown switch and Reopen Editor With… replace the
     * active tab: the new tab opens at its index, becomes active, and the old
     * tab closes last, which is when a Cursor Edit session can end.
     */
    switchTo(kind: TabKind, old: FakeTab, { endsSession = false } = {}) {
      const group = old.group;
      const tab = { uri: old.uri, kind, group };
      group.tabs.splice(group.tabs.indexOf(old), 0, tab);
      emit({ opened: [tab] });
      activate(tab);
      group.tabs.splice(group.tabs.indexOf(old), 1);
      if (endsSession && old.uri) {
        leased.delete(old.uri);
      }
      emit({}, endsSession && old.uri ? [old.uri] : []);
      return tab;
    },
    /** Closing the active tab activates a neighbour before removing it. */
    close(tab: FakeTab) {
      const group = tab.group;
      if (group.activeTab === tab) {
        const neighbour = group.tabs.find((candidate) => candidate !== tab);
        group.activeTab = neighbour;
        if (neighbour) {
          emit({ changed: [neighbour] });
        }
      }
      group.tabs.splice(group.tabs.indexOf(tab), 1);
      emit({});
    },
  };
}

test("a new tab is judged once, at its first activation", () => {
  const tabs = workbench();
  const text = tabs.add("text", note, tabs.groups[0]!);
  assert.deepEqual(tabs.judged, [], "VS Code opens a tab before activating it");
  tabs.activate(text);
  assert.deepEqual(tabs.judged, [swap("none", "text")]);
  tabs.activate(text);
  assert.equal(tabs.judged.length, 1, "later updates are not arrivals");
});

test("Cursor's Preview | Markdown switch is classified against the tab it replaces", () => {
  const tabs = workbench();
  const lumiere = tabs.open("workbench");
  const markdown = tabs.switchTo("other", lumiere);
  tabs.switchTo("text", markdown);
  assert.deepEqual(tabs.judged, [
    swap("none", "workbench"),
    swap("workbench", "other"),
    swap("other", "text"),
  ]);
});

test("closing a Lumiere tab beside a Cursor Markdown tab of the same note judges nothing", () => {
  const tabs = workbench();
  tabs.switchTo("other", tabs.open("workbench"));
  for (let attempt = 0; attempt < 3; attempt++) {
    // Reclaim's openWith, or the reader, opens the note in Lumiere again.
    const lumiere = tabs.open("workbench");
    const judged = tabs.judged.length;
    tabs.close(lumiere);
    assert.equal(
      tabs.judged.length,
      judged,
      "the Cursor Markdown tab was already there",
    );
  }
});

test("a tab opened beside the active tab of the same note is new, not a switch", () => {
  const tabs = workbench();
  tabs.open("workbench");
  tabs.open("text");
  assert.deepEqual(tabs.judged.at(-1), swap("none", "text"));
});

test("a tab first activated in a group without focus is never judged", () => {
  const tabs = workbench(2);
  const beside = tabs.open("text", note, tabs.groups[1]);
  assert.deepEqual(tabs.judged, []);
  tabs.focus(tabs.groups[1]!);
  tabs.activate(beside);
  assert.deepEqual(tabs.judged, []);
});

test("tabs that name no note are not classified", () => {
  const tabs = workbench();
  const unnamed = tabs.add("text", undefined, tabs.groups[0]!);
  tabs.activate(unnamed);
  tabs.switchTo("other", unnamed);
  assert.deepEqual(tabs.judged, []);
});

test("a switch held by a Cursor Edit session is judged when that session's text tab closes", () => {
  const tabs = workbench();
  const text = tabs.open("text");
  tabs.leased.add(note);
  tabs.switchTo("other", text, { endsSession: true });
  assert.deepEqual(tabs.judged, [swap("none", "text"), swap("text", "other")]);
});

test("a held swap stays held when its session ends some other way", () => {
  const tabs = workbench();
  tabs.leased.add(note);
  const text = tabs.open("text");
  // A failed handoff releases its own lease token; no tab change ends it.
  tabs.leased.delete(note);
  tabs.activate(text);
  assert.deepEqual(tabs.judged, []);
});

test("tabs open before reclaim starts are judged: the shown one now, the rest when first activated", () => {
  // A restored window: a note shown as text, another note behind it, and a
  // note already in Lumiere.
  const group: FakeGroup = { tabs: [], activeTab: undefined };
  const shown: FakeTab = { uri: note, kind: "text", group };
  const behind: FakeTab = {
    uri: "file:///vault/Other.md",
    kind: "text",
    group,
  };
  const lumiere: FakeTab = {
    uri: "file:///vault/Third.md",
    kind: "workbench",
    group,
  };
  group.tabs.push(shown, behind, lumiere);
  group.activeTab = shown;
  const swaps = new TabSwaps<FakeTab>({
    facts: (tab) => ({ uri: tab.uri, kind: tab.kind }),
    groupOf: (tab) => tab.group,
    shownTab: () => group.activeTab,
  });
  const due = swaps.adopt(group.tabs);
  assert.deepEqual(
    due.map(({ swap }) => swap),
    [swap("none", "text")],
  );
  assert.equal(shouldReclaim(due[0]!.swap, context), true);
  // The note behind it is judged when the reader first opens it, once.
  group.activeTab = behind;
  const next = swaps.next({ opened: [], changed: [behind] }, new Set());
  assert.deepEqual(
    next.map(({ swap }) => swap),
    [swap("none", "text", "file:///vault/Other.md")],
  );
  assert.deepEqual(
    swaps.next({ opened: [], changed: [behind] }, new Set()),
    [],
  );
  // A tab already in Lumiere is never reclaimed.
  group.activeTab = lumiere;
  const kept = swaps.next({ opened: [], changed: [lumiere] }, new Set());
  assert.equal(shouldReclaim(kept[0]!.swap, context), false);
});

test("skip keep: unassociated none→text does not permanently stick", () => {
  const note = "file:///vault/Core.md";
  assert.equal(
    shouldReclaim(
      { uri: note, before: "none", after: "text" },
      {
        enabled: true,
        reclaimInPlace: true,
        isNote: () => true,
        associated: () => false,
        bypassed: () => false,
      },
    ),
    false,
  );
});

test("a missing note kept in the text editor stays there on command selection after Save, and reclaims on reopen", async (t) => {
  class FakeUri {
    static parse(value: string) {
      return new FakeUri(value);
    }
    constructor(private readonly value: string) {}
    get path() {
      return decodeURIComponent(new URL(this.value).pathname);
    }
    toString() {
      return this.value;
    }
  }
  class FakeTabInputText {
    constructor(readonly uri: FakeUri) {}
  }
  class FakeTabInputCustom {
    constructor(
      readonly uri: FakeUri,
      readonly viewType: string,
    ) {}
  }
  class FakePosition {
    constructor(
      readonly line: number,
      readonly character: number,
    ) {}
  }
  class FakeRange {
    constructor(
      readonly start: FakePosition,
      readonly end: FakePosition,
    ) {}
  }
  class Emitter<T> {
    private readonly listeners = new Set<(value: T) => void>();
    readonly event = (listener: (value: T) => void) => {
      this.listeners.add(listener);
      return { dispose: () => this.listeners.delete(listener) };
    };
    fire(value: T) {
      for (const listener of this.listeners) {
        listener(value);
      }
    }
  }

  interface NativeTab {
    input: unknown;
    label: string;
    isDirty: boolean;
    isPreview: boolean;
    group: {
      viewColumn: number;
      tabs: NativeTab[];
      activeTab: NativeTab | undefined;
    };
  }

  const group = {
    viewColumn: 1,
    tabs: [] as NativeTab[],
    activeTab: undefined as NativeTab | undefined,
  };
  const tabsChanged = new Emitter<{
    opened: NativeTab[];
    changed: NativeTab[];
    closed: NativeTab[];
  }>();
  const selectionChanged = new Emitter<{
    textEditor: unknown;
    kind?: number;
  }>();
  const activeEditorChanged = new Emitter<unknown>();
  const commands: unknown[][] = [];

  const pathUri = "file:///vault/missing-after-save.md";
  const doc = {
    uri: FakeUri.parse(pathUri),
    isDirty: true,
    languageId: "markdown",
    getText: () => "# Heading\nBody text\n",
    offsetAt: (pos: FakePosition) =>
      pos.line === 0 ? pos.character : 10 + pos.character,
  };
  const textDocuments = [doc];

  const fakeVscode = {
    Uri: FakeUri,
    TabInputText: FakeTabInputText,
    TabInputCustom: FakeTabInputCustom,
    Position: FakePosition,
    Range: FakeRange,
    TextEditorSelectionChangeKind: { Keyboard: 1, Mouse: 2, Command: 3 },
    Disposable: {
      from: (...items: { dispose(): unknown }[]) => ({
        dispose: () => items.forEach((item) => item.dispose()),
      }),
    },
    env: { appName: "Cursor" },
    workspace: {
      textDocuments,
      getConfiguration(section: string) {
        return {
          get(key: string, fallback?: unknown) {
            if (section === "workbench" && key === "editorAssociations") {
              return { "*.md": MARKDOWN_EDITOR.viewType };
            }
            return fallback;
          },
        };
      },
      async openTextDocument() {
        return doc;
      },
    },
    window: {
      activeTextEditor: undefined as unknown,
      onDidChangeTextEditorSelection: selectionChanged.event,
      onDidChangeActiveTextEditor: activeEditorChanged.event,
      tabGroups: {
        all: [group],
        activeTabGroup: group,
        onDidChangeTabs: tabsChanged.event,
        async close(tab: NativeTab) {
          group.tabs = group.tabs.filter((candidate) => candidate !== tab);
        },
      },
    },
    commands: {
      async executeCommand(id: string, uri?: FakeUri, ...rest: unknown[]) {
        commands.push([id, uri?.toString(), ...rest]);
      },
    },
  };

  const require = createRequire(import.meta.url);
  for (const rel of [
    "../../../src/host/reader-text.ts",
    "../../../src/host/reclaim-opt-out.ts",
    "../../../src/host/reclaim-context.ts",
    "../../../src/host/reclaim-transfer.ts",
    "../../../src/host/reclaim.ts",
  ]) {
    delete require.cache[require.resolve(rel)];
  }
  const loader = Module as typeof Module & {
    _load(id: string, ...args: unknown[]): unknown;
  };
  const originalLoad = loader._load;
  loader._load = (id, ...args) =>
    id === "vscode" ? fakeVscode : originalLoad.call(Module, id, ...args);
  let reclaimModule: typeof ReclaimModule;
  let transferModule: typeof ReclaimTransferModule;
  let hostReaderText: typeof readerText;
  try {
    ({
      readerText: hostReaderText,
    } = require("../../../src/host/reader-text.ts"));
    reclaimModule = require("../../../src/host/reclaim.ts");
    transferModule = require("../../../src/host/reclaim-transfer.ts");
  } finally {
    loader._load = originalLoad;
  }

  let absent = true;
  setMarkdownAbsentOnDiskForTests((uri) => uri === pathUri && absent);
  t.after(() => {
    setMarkdownAbsentOnDiskForTests();
    hostReaderText.clear();
  });

  const stop = reclaimModule.registerReclaim();
  t.after(() => stop.dispose());

  const first: NativeTab = {
    input: new FakeTabInputText(FakeUri.parse(pathUri)),
    label: "missing-after-save.md",
    isDirty: true,
    isPreview: true,
    group,
  };
  group.tabs.push(first);
  group.activeTab = first;
  tabsChanged.fire({ opened: [first], changed: [], closed: [] });
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(
    commands.some((entry) => entry[0] === "vscode.openWith"),
    false,
    "missing note must stay in the built-in Text Editor",
  );

  // User saves the buffer (file now exists on disk) and runs Select All / Find
  // (TextEditorSelectionChangeKind.Command) in the same text editor.
  absent = false;
  first.isDirty = false;
  doc.isDirty = false;
  const editor = {
    viewColumn: 1,
    document: doc,
    selection: new FakeRange(new FakePosition(0, 0), new FakePosition(0, 9)),
    visibleRanges: [
      new FakeRange(new FakePosition(0, 0), new FakePosition(1, 0)),
    ],
  };
  fakeVscode.window.activeTextEditor = editor;
  selectionChanged.fire({
    textEditor: editor,
    kind: fakeVscode.TextEditorSelectionChangeKind.Command,
  });
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(
    commands.some((entry) => entry[0] === "vscode.openWith"),
    false,
    "command selection after Save must not reclaim the kept text editor",
  );
  assert.equal(group.tabs.includes(first), true);
  assert.equal(hostReaderText.has(pathUri), true);

  // Also check transfer.open directly when absent: it keeps readerText too.
  hostReaderText.clear();
  absent = true;
  const directTransfer = transferModule.createReclaimTransfer(
    undefined,
    new Bypass(),
  );
  t.after(() => directTransfer.dispose());
  directTransfer.open(first as never, pathUri);
  assert.equal(
    hostReaderText.has(pathUri),
    true,
    "transfer.open for an absent text tab must record readerText.keep",
  );
  absent = false;

  // Closing the kept text tab forgets it; reopening the now-existing note
  // reclaims to Lumiere per the 2026-11-04 lock.
  group.tabs = [];
  group.activeTab = undefined;
  tabsChanged.fire({ opened: [], changed: [], closed: [first] });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(hostReaderText.has(pathUri), false);

  const second: NativeTab = {
    input: new FakeTabInputText(FakeUri.parse(pathUri)),
    label: "missing-after-save.md",
    isDirty: false,
    isPreview: true,
    group,
  };
  group.tabs.push(second);
  group.activeTab = second;
  tabsChanged.fire({ opened: [second], changed: [], closed: [] });
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(
    commands.some(
      (entry) =>
        entry[0] === "vscode.openWith" &&
        entry[1] === pathUri &&
        entry[2] === MARKDOWN_EDITOR.viewType,
    ),
    true,
    "reopening the saved note must reclaim to Lumiere",
  );
});

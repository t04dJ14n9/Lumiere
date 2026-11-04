# PDF backlink overlays (Chrome-aligned) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace sidecar-as-highlight-store with Chrome-aligned Copy link Quotes (`#page=` + `#:~:text=`) and vault-Markdown backlink overlays in the Lumia PDF viewer.

**Architecture:** Pure shared helpers encode/decode Text Fragments and build Quote clipboard payloads. A derived in-memory vault index (cache only) maps PDF identity → backlink hits from `.md` files. The viewer resolves `#:~:text=` to glyph boxes, paints overlays above hard-written EmbedPDF annotations, and ignores Del on overlays. `pdfRegions` gates empty-page / Select Region (default off). Sidecar create/write tears down; legacy `#hl-` open stays best-effort.

**Tech Stack:** TypeScript, EmbedPDF (`@embedpdf/plugin-annotation`, selection glyphs), VS Code webview + Cordis PDF plugins, Vitest/node:test unit tests, Playwright browser tests in `packages/pdf`, shared handoff fixtures in `packages/agents`.

## Global Constraints

- Work only on the box filesystem; no Cursor Cloud Agents; do not push or open a PR from this plan's prep commits.
- Follow repo `AGENTS.md`, `REVIEW.md`, and `packages/pdf/AGENTS.md` (update the Copy-link clipboard rule in the same change set as the formatter).
- Source of truth for highlights = workspace Markdown links; index is derived cache only — never a second store.
- New Copy link never emits `#hl-`, never PDF++ `selection=`, never RFC `search=`; emits `viewrect=` only when regions are enabled.
- Text fragment shape is Chrome `#:~:text=` (combined as `path.pdf#page=N#:~:text=…`).
- Del/Backspace ignore backlink overlays; still delete hard-written Note/freeText (and other embedded annots).
- No auto-migrate / auto-delete of `*.pdf.lumiere.md`; user deletes by hand.
- Synthetic fixtures only — no real vault notes on GitHub.
- TDD: failing test before production code for each behavior.
- Risk Medium (product/UI): Host GUI screenshots required before merge ask.
- Update `packages/agents` handoff docs + fixture in the same change set as PDF Quote format.

## File map

| File | Role |
|------|------|
| `packages/pdf/src/shared/text-fragment.ts` (new) | Chrome Text Fragment encode/decode + combine with `#page=` |
| `packages/pdf/src/shared/pdf-location.ts` | Parse `#page=` / `viewrect=` / tolerate `#:~:text=`; format page-only and optional viewrect |
| `packages/pdf/src/shared/agent-text.ts` | Quote-first clipboard builders; no `#hl-`; viewrect gated |
| `packages/pdf/src/shared/pdf-backlink-index.ts` (new) | Pure index: parse MD → hits; build/refresh/lookup by PDF key |
| `packages/pdf/src/shared/pdf-backlink-resolve.ts` (new) | Text fragment → char range → glyph line rects (reuse `lineRects` / find helpers) |
| `packages/pdf/src/shared/annotation-delete-keys.ts` | Keep Del predicate for embedded annots only (overlays never set `hasAnnotationSelection`) |
| `packages/pdf/src/extension/plugins/agentBridge/handoff.ts` | Clipboard Quote only; page-only when no selection; no `openAgentChat` |
| `packages/pdf/src/extension/plugins/pdfBacklinks/` (new) | Vault scan/idle + onDidSaveMarkdown; per-panel lookup push |
| `packages/pdf/src/extension/plugins/pdfRegions/` | Own `lumiere.pdf.regions.enabled` (default false); expose flag |
| `packages/pdf/src/extension/plugins/pdfSidecar/` | Tear down create/write; keep `#hl-` open best-effort |
| `packages/pdf/src/webview/sidecar-highlight-tool.ts` + `plugins.ts` | Remove sidecar highlight override → EmbedPDF highlight burns into PDF again |
| `packages/pdf/src/webview/sidecar-writing.ts` / `sidecar-selection.ts` / `sidecar-layer.tsx` | Stop create/delete UI; drop sidecar paint layer |
| `packages/pdf/src/webview/backlink-layer.tsx` (new) | Paint overlays; hover preview; click → open note |
| `packages/pdf/src/webview/page.tsx` | Paint order: AnnotationLayer then backlink overlays; gate empty-page marquee |
| `packages/pdf/src/webview/tool-mode.ts` | No Select Region / no empty marquee when regions off |
| `packages/pdf/src/webview/selection.ts` | Ignore empty-page region ends when regions off |
| `packages/pdf/contributes.json` | Copy link enablement without selection; regions setting; hide region tool when off |
| `packages/agents/docs/agent-handoff-format.md` + fixture | Quote-first / `#page=`+`#:~:text=` contract |
| `packages/pdf/docs/sidecar-highlights.md`, `README.md`, `CHANGELOG.md`, `AGENTS.md` | Docs: vault Markdown is highlight store |
| Unit + browser tests | Cover Tasks A–F |
| Spec | `docs/superpowers/specs/2026-11-04-pdf-backlink-overlays-chrome-design.md` |

---

### Task 1: Text fragment encode/decode helpers

**Files:**
- Create: `packages/pdf/src/shared/text-fragment.ts`
- Create: `packages/pdf/test/unit/text-fragment.test.ts`
- Modify: `packages/pdf/src/shared/pdf-location.ts` (split PDF fragment before `#:~:`)

**Interfaces:**
- Produces:
  - `encodeTextFragment(text: string): string` → `:~:text=<encoded>` (no leading `#`)
  - `decodeTextFragment(directive: string): { textStart: string; textEnd?: string; prefix?: string; suffix?: string } | undefined`
  - `formatPdfDeepLink(path: string, opts: { page: number; text?: string; viewRect?: ViewRect }): string`
  - `parsePdfDeepLinkFragment(fragment: string): { page?: number; viewRect?: ViewRect; textFragment?: ReturnType<typeof decodeTextFragment>; highlightId?: string }`
- Consumes: `ViewRect` from `geometry.ts`; existing `formatLocationFragment` / `parseLocationFragment` for the `#page=` / `viewrect=` half

- [ ] **Step 1: Write the failing test**

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  encodeTextFragment,
  decodeTextFragment,
  formatPdfDeepLink,
  parsePdfDeepLinkFragment,
} from "../../src/shared/text-fragment";

test("encodeTextFragment percent-encodes Chrome reserved characters", () => {
  assert.equal(encodeTextFragment("a-b,c&d"), ":~:text=a%2Db%2Cc%26d");
});

test("formatPdfDeepLink with text uses page then text fragment", () => {
  assert.equal(
    formatPdfDeepLink("papers/a.pdf", { page: 3, text: "hello" }),
    "papers/a.pdf#page=3#:~:text=hello",
  );
});

test("formatPdfDeepLink without text is page only", () => {
  assert.equal(
    formatPdfDeepLink("papers/a.pdf", { page: 3 }),
    "papers/a.pdf#page=3",
  );
});

test("formatPdfDeepLink never emits hl-/selection=/search=", () => {
  const href = formatPdfDeepLink("p.pdf", { page: 1, text: "x" });
  assert.doesNotMatch(href, /#hl-|selection=|search=/u);
});

test("parsePdfDeepLinkFragment reads page and text across double hash", () => {
  const parsed = parsePdfDeepLinkFragment("page=2#:~:text=Scaled%20dot");
  assert.deepEqual(parsed, {
    page: 2,
    textFragment: { textStart: "Scaled dot" },
  });
});

test("decodeTextFragment rejects empty text", () => {
  assert.equal(decodeTextFragment(":~:text="), undefined);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/pdf && pnpm exec tsx --test test/unit/text-fragment.test.ts`
Expected: FAIL with `Cannot find module` / `encodeTextFragment is not a function`

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/pdf/src/shared/text-fragment.ts
import { formatLocationFragment, parseLocationFragment } from "./pdf-location";
import type { ViewRect } from "./geometry";
import { highlightIdOfFragment } from "./sidecar-format";

/** Encode one textStart value per WICG Text Fragments (dash/amp/comma). */
export function encodeTextFragment(text: string): string {
  const body = encodeURIComponent(text)
    .replace(/-/gu, "%2D")
    .replace(/'/gu, "%27");
  return `:~:text=${body}`;
}

export function decodeTextFragment(
  directive: string,
):
  | { textStart: string; textEnd?: string; prefix?: string; suffix?: string }
  | undefined {
  const raw = directive.replace(/^#?/, "");
  if (!raw.startsWith(":~:text=")) {
    return undefined;
  }
  const value = raw.slice(":~:text=".length);
  if (!value) {
    return undefined;
  }
  // v1: single textStart only (prefix-/textEnd/,-suffix deferred).
  try {
    const textStart = decodeURIComponent(value);
    return textStart ? { textStart } : undefined;
  } catch {
    return undefined;
  }
}

export function formatPdfDeepLink(
  path: string,
  opts: { page: number; text?: string; viewRect?: ViewRect },
): string {
  const pdfPart = formatLocationFragment({
    page: opts.page,
    ...(opts.viewRect ? { viewRect: opts.viewRect } : {}),
  });
  const text = opts.text?.trim();
  if (!text) {
    return `${path}#${pdfPart}`;
  }
  return `${path}#${pdfPart}#${encodeTextFragment(text)}`;
}

export function parsePdfDeepLinkFragment(fragment: string): {
  page?: number;
  viewRect?: ViewRect;
  textFragment?: ReturnType<typeof decodeTextFragment>;
  highlightId?: string;
} {
  const cleaned = fragment.replace(/^#/, "");
  const textAt = cleaned.indexOf("#:~:");
  const pdfHalf = textAt >= 0 ? cleaned.slice(0, textAt) : cleaned;
  const textHalf = textAt >= 0 ? cleaned.slice(textAt + 1) : undefined;
  const location = parseLocationFragment(pdfHalf);
  const highlightId = highlightIdOfFragment(pdfHalf);
  const textFragment = textHalf ? decodeTextFragment(textHalf) : undefined;
  return {
    ...(location?.page ? { page: location.page } : {}),
    ...(location?.viewRect ? { viewRect: location.viewRect } : {}),
    ...(textFragment ? { textFragment } : {}),
    ...(highlightId ? { highlightId } : {}),
  };
}
```

Update `parseLocationFragment` callers that receive a full URL fragment containing `#:~:` to use `parsePdfDeepLinkFragment` instead (Open Location path in Task 5 / navigation).

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/pdf && pnpm exec tsx --test test/unit/text-fragment.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/pdf/src/shared/text-fragment.ts packages/pdf/test/unit/text-fragment.test.ts
git commit -m "$(cat <<'EOF'
feat(pdf): add Chrome Text Fragment encode/decode helpers

EOF
)"
```

---

### Task 2: Quote payload builders (Copy link shape)

**Files:**
- Modify: `packages/pdf/src/shared/agent-text.ts`
- Modify: `packages/pdf/test/unit/agent-text.test.ts`
- Modify: `packages/agents/docs/agent-handoff-format.md`
- Modify: `packages/agents` handoff fixture JSON (`test/fixtures/agent-handoff-format.json` or equivalent path under `packages/agents`)
- Modify: `packages/pdf/test/unit/handoff-format.test.ts` (pinned hash / fixture assert)

**Interfaces:**
- Consumes: `formatPdfDeepLink`, `PdfSelection`, `PdfSource`
- Produces:
  - `agentText(selection, source, options?: { regionsEnabled?: boolean }): string`
  - `pageLinkText(source, page: number): string` → `[name · p.N](path#page=N)`
  - Options: when `regionsEnabled !== true`, never include `viewRect`; never use `highlightId` / `#hl-`

Clipboard shapes (locked):

Text selected:
```markdown
> selected text
>
> [path.pdf · p.N](path.pdf#page=N#:~:text=…)
```

No text (page only):
```markdown
[path.pdf · p.N](path.pdf#page=N)
```

Region when regions enabled (optional text):
```markdown
> region text if any
>
> [path.pdf · p.N](path.pdf#page=N&viewrect=…)
```
(or link-only if no text). When regions disabled, region selections must not be produced by the viewer (Task 6).

- [ ] **Step 1: Write the failing test**

```ts
test("text selection Quote puts blockquote before the deep link", () => {
  const text = agentText(
    {
      kind: "text",
      text: "Scaled dot-product attention",
      pages: [{ page: 3, rects: [[72, 83, 150, 95]] }],
    },
    source,
  );
  assert.equal(
    text,
    [
      "> Scaled dot-product attention",
      ">",
      "> [attention_v2.pdf · p.3](papers/attention_v2.pdf#page=3#:~:text=Scaled%20dot-product%20attention)",
    ].join("\n"),
  );
  assert.doesNotMatch(text, /#hl-|viewrect=|selection=|search=/u);
});

test("pageLinkText is page only", () => {
  assert.equal(
    pageLinkText(source, 3),
    "[attention_v2.pdf · p.3](papers/attention_v2.pdf#page=3)",
  );
});

test("selected sidecar highlightId is ignored for new Copy link", () => {
  const text = agentText(
    {
      kind: "region",
      page: 3,
      rect: [72, 410, 292, 436],
      text: "scaled",
      highlightId: "hl-a1b2c3d4",
    },
    source,
    { regionsEnabled: true },
  );
  assert.doesNotMatch(text, /#hl-/u);
  assert.match(text, /viewrect=/u);
});

test("region without regionsEnabled omits viewrect and uses text fragment when text present", () => {
  const text = agentText(
    {
      kind: "region",
      page: 3,
      rect: [72, 410, 292, 436],
      text: "scaled",
    },
    source,
    { regionsEnabled: false },
  );
  assert.doesNotMatch(text, /viewrect=/u);
  assert.match(text, /#:~:text=/u);
});
```

- [ ] **Step 2: Run test — expect FAIL** (old link-first + viewrect shape)

Run: `cd packages/pdf && pnpm exec tsx --test test/unit/agent-text.test.ts`

- [ ] **Step 3: Implement `agentText` / `pageLinkText`**

```ts
export function pageLinkText(source: PdfSource, page: number): string {
  const name = fileBasename(source.path);
  return `[${name} · p.${page}](${formatPdfDeepLink(source.path, { page })})`;
}

export function agentText(
  selection: PdfSelection,
  source: PdfSource,
  options: { regionsEnabled?: boolean } = {},
): string {
  const regionsEnabled = options.regionsEnabled === true;
  const name = fileBasename(source.path);
  const pages = selectedPages(selection);
  const quote = selection.text?.trim() ?? "";
  const links = pages.map(({ page, rects }) => {
    const label = `${name} · p.${page}`;
    if (quote && selection.kind === "text") {
      return `[${label}](${formatPdfDeepLink(source.path, { page, text: quote })})`;
    }
    if (selection.kind === "region" && regionsEnabled) {
      return `[${label}](${formatPdfDeepLink(source.path, {
        page,
        viewRect: toViewRect(boundingRect(rects)),
        ...(quote ? {} : {}),
      })})`;
    }
    if (quote) {
      return `[${label}](${formatPdfDeepLink(source.path, { page, text: quote })})`;
    }
    return `[${label}](${formatPdfDeepLink(source.path, { page })})`;
  });
  if (!quote) {
    return links.join("\n");
  }
  // Quote block, blank quoted line, then each link as a quoted Markdown line.
  return [blockquote(quote), ">", ...links.map((link) => `> ${link}`)].join(
    "\n",
  );
}
```

Update agents fixture + `handoff-format.test.ts` expected strings to match. Update `packages/pdf/AGENTS.md` clipboard bullet to the new shape.

- [ ] **Step 4: Tests pass**

Run: `cd packages/pdf && pnpm exec tsx --test test/unit/agent-text.test.ts test/unit/handoff-format.test.ts`
Also: `pnpm --filter @workshop/agents test` (or the package's unit script that pins the fixture).

- [ ] **Step 5: Commit**

```bash
git add packages/pdf/src/shared/agent-text.ts packages/pdf/test/unit/agent-text.test.ts \
  packages/pdf/test/unit/handoff-format.test.ts packages/pdf/AGENTS.md \
  packages/agents/docs/agent-handoff-format.md packages/agents/test/fixtures/agent-handoff-format.json
git commit -m "$(cat <<'EOF'
feat(pdf): Quote-first Copy link with Chrome text fragments

EOF
)"
```

---

### Task 3: Copy link command — clipboard only, page fallback, no Add notes

**Files:**
- Modify: `packages/pdf/src/extension/plugins/agentBridge/handoff.ts`
- Modify: `packages/pdf/contributes.json` (enablement / webview when-clauses)
- Modify: `packages/pdf/test/unit/contributions.test.ts`
- Modify: `packages/pdf/src/extension/plugins/agentBridge/chat.ts` usage (Copy link must not call `openAgentChat`)
- Verify: no `Add notes` command exists; do not add one

**Interfaces:**
- Consumes: `agentText`, `pageLinkText`, `panel.selectionSnapshot()`, `panel.view?.readingPage ?? panel.view?.page`
- Produces: `copyLinkForAgent(panel): Promise<boolean>` writes clipboard only; returns true when something was copied

- [ ] **Step 1: Failing unit / contribution tests**

```ts
test("Copy link to this is enabled when the PDF is active even without selection", () => {
  // assert contributes.json enablement includes lumiere.pdf.pdfActive
  // and webview/context when does not require hasSelection exclusively
});

test("copyLinkForAgent with no selection copies pageLinkText for readingPage", async () => {
  // fake panel: selectionSnapshot() undefined, view.readingPage = 4
  // assert clipboard == pageLinkText(...)
  // assert openAgentChat not called
});
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement**

In `handoff.ts`:

```ts
async copyLinkForAgent(panel: PdfPanel): Promise<boolean> {
  const regionsEnabled = isRegionsEnabled(); // from config, Task 6 wires the helper
  const selected = panel.selectionSnapshot();
  let text: string | undefined;
  if (selected) {
    text = agentText(selected.selection, { path: displayPath(panel.uri) }, {
      regionsEnabled,
    });
  } else {
    const page = panel.view?.readingPage ?? panel.view?.page;
    if (page) {
      text = pageLinkText({ path: displayPath(panel.uri) }, page);
    }
  }
  if (!text) {
    void vscode.window.showWarningMessage(
      "Open a PDF page to copy a link.",
    );
    return false;
  }
  await vscode.env.clipboard.writeText(text);
  return true;
}
```

`contributes.json`:
- Command enablement: `lumiere.pdf.pdfActive` (or `activeCustomEditorId == 'lumiere.pdf.viewer'`)
- `webview/context` when: `webviewId == 'lumiere.pdf.viewer'` (drop `&& lumiere.pdf.hasSelection`)
- Keep title **Copy link to this**; do not add Add notes
- Setting `lumiere.pdf.copyLinkForAgent.target` description: note that Copy link no longer opens agent chat (IDE Context / MCP remain separate)

- [ ] **Step 4: Tests pass; commit**

```bash
git commit -m "$(cat <<'EOF'
feat(pdf): Copy link is clipboard Quote only with page fallback

EOF
)"
```

---

### Task 4: Vault PDF-link index (derived cache)

**Files:**
- Create: `packages/pdf/src/shared/pdf-backlink-index.ts`
- Create: `packages/pdf/test/unit/pdf-backlink-index.test.ts`
- Create: `packages/pdf/src/extension/plugins/pdfBacklinks/plugin.ts` (+ `manifest.ts`)
- Modify: `packages/pdf/src/extension/plugins/catalog.ts` (register after `pdfPlugin`)
- Modify: `packages/pdf/src/extension/plugins/services.ts` (provide `pdfBacklinkIndex`)
- Create: host→webview message type for backlink hits (extend `messages.ts` + validator)

**Interfaces:**
- Produces (pure):
```ts
export interface PdfBacklinkHit {
  noteUri: string;       // vscode URI string or workspace path
  notePath: string;      // display path
  linkOffset: number;    // char offset in note (for open-at-link)
  pdfKey: string;        // normalized workspace-relative PDF path
  page: number;
  textFragment?: { textStart: string };
  viewRect?: ViewRect;
  highlightId?: string;  // legacy open only
}

export function extractPdfBacklinks(
  noteText: string,
  notePath: string,
  noteUri: string,
): PdfBacklinkHit[];

export class PdfBacklinkIndex {
  replaceNote(noteUri: string, notePath: string, text: string): void;
  removeNote(noteUri: string): void;
  lookup(pdfKey: string): readonly PdfBacklinkHit[]; // O(hits for file), not full scan
  clear(): void;
}
```
- Markdown link regex: `[label](target)` / `[label](<target>)` where target ends with `.pdf` + optional fragment; use `parsePdfDeepLinkFragment` on the fragment.
- `pdfKey`: normalize like `displayPath` (workspace-relative, `/` separators, decode once).
- Extension plugin: on activate, idle-scan `**/*.md` via `vscode.workspace.findFiles` in chunks; `onDidSaveTextDocument` / create / delete refresh one note; on PDF open, `lookup(displayPath(panel.uri))` and `panel.post({ type: "pdfBacklinks", hits })`.
- Never write index to disk.

- [ ] **Step 1: Failing pure tests**

```ts
test("extractPdfBacklinks finds page+text links and ignores non-pdf", () => {
  const md = [
    "See [x](papers/a.pdf#page=3#:~:text=hello)",
    "and [y](notes/other.md#page=1)",
    "legacy [z](papers/a.pdf#hl-deadbeef)",
  ].join("\n");
  const hits = extractPdfBacklinks(md, "notes/n.md", "file:///notes/n.md");
  assert.equal(hits.length, 2);
  assert.equal(hits[0]!.page, 3);
  assert.equal(hits[0]!.textFragment?.textStart, "hello");
  assert.equal(hits[1]!.highlightId, "hl-deadbeef");
});

test("lookup returns only that PDF's hits", () => {
  const index = new PdfBacklinkIndex();
  index.replaceNote("u1", "n.md", "[a](papers/a.pdf#page=1)\n[b](papers/b.pdf#page=2)");
  assert.equal(index.lookup("papers/a.pdf").length, 1);
  assert.equal(index.lookup("papers/b.pdf").length, 1);
});

test("replaceNote refreshes without full rebuild API on open", () => {
  const index = new PdfBacklinkIndex();
  index.replaceNote("u1", "n.md", "[a](papers/a.pdf#page=1)");
  index.replaceNote("u1", "n.md", "[a](papers/a.pdf#page=9#:~:text=z)");
  assert.equal(index.lookup("papers/a.pdf")[0]!.page, 9);
});
```

- [ ] **Step 2: Implement pure index + plugin wiring; message validator**

Webview message (host→viewer):
```ts
{ type: "pdfBacklinks"; load: number; hits: PdfBacklinkHit[] }
```

- [ ] **Step 3: Unit tests pass; commit**

```bash
git commit -m "$(cat <<'EOF'
feat(pdf): derived vault index for PDF backlink overlays

EOF
)"
```

---

### Task 5: Overlay resolve, paint order, hover/click, Del ignore

**Files:**
- Create: `packages/pdf/src/shared/pdf-backlink-resolve.ts`
- Create: `packages/pdf/test/unit/pdf-backlink-resolve.test.ts`
- Create: `packages/pdf/src/webview/backlink-layer.tsx`
- Create: `packages/pdf/src/webview/backlink-store.ts`
- Modify: `packages/pdf/src/webview/page.tsx` (paint AnnotationLayer, then BacklinkLayer)
- Modify: `packages/pdf/src/webview/host-messages.ts` (handle `pdfBacklinks`)
- Modify: `packages/pdf/src/webview/mark-selection.ts` / delete path — overlays must not set `hasAnnotationSelection`
- Create: `packages/pdf/test/browser/backlink-overlays.spec.ts`
- Reuse: `lineRects` from `sidecar-reattach.ts` (import or move shared glyph helpers to `pdf-backlink-resolve.ts` / keep import)

**Interfaces:**
- Produces:
```ts
export function resolveTextToLineRects(
  pageText: string,
  glyphBoxes: readonly GlyphBox[],
  textStart: string,
): SegmentRect[] | undefined; // soft-fail → undefined
```
- Matching: first exact `indexOf(textStart)` on pageText; if missing, undefined (skip overlay paint, still honor page flash if navigating).
- Paint: `.pdf-backlink-overlay` lines; `pointer-events: auto` for hover/click only on overlay chrome; z-order after AnnotationLayer.
- Hover: title / small preview with `notePath`.
- Click: `post({ type: "openBacklinkNote", noteUri, linkOffset })`; host opens the Markdown doc at that offset.
- Del: overlays never enter `useMarkSelection` / never `mark: true`; existing `shouldDeleteAnnotationOnKey` unchanged — add unit proving overlay ids are not annotation selections.

Paint order helper test:
```ts
test("page layer order lists AnnotationLayer before BacklinkLayer in source", () => {
  const src = fs.readFileSync("src/webview/page.tsx", "utf8");
  assert.ok(src.indexOf("<AnnotationLayer") < src.indexOf("<BacklinkLayer"));
});
```

- [ ] **Step 1: Failing resolve + paint-order + Del tests**
- [ ] **Step 2: Implement resolve + layer + host open handler**
- [ ] **Step 3: Browser test with synthetic MD + fixture PDF** (no real vault): inject `pdfBacklinks` hits → overlay visible → click posts open; Del with overlay selected does nothing; Del on freeText still deletes
- [ ] **Step 4: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat(pdf): paint vault backlink overlays above embedded annots

EOF
)"
```

---

### Task 6: Teardown sidecar create path; keep legacy `#hl-` open

**Files:**
- Modify: `packages/pdf/src/webview/plugins.ts` — remove `sidecarHighlightTool` from AnnotationPlugin tools
- Modify: `packages/pdf/src/webview/sidecar-writing.ts` — no-op or delete hook registration from `mark-selection`
- Modify: `packages/pdf/src/webview/mark-selection.ts` — drop `useSidecarHighlightWriting`; keep optional read-only load if still needed for `#hl-` flash only
- Modify: `packages/pdf/src/webview/sidecar-layer.tsx` — stop painting (or remove from `page.tsx`)
- Modify: `packages/pdf/src/extension/plugins/pdfSidecar/sidecars.ts` — reject / ignore `upsert` writes; allow read + `reveal` for `#hl-`
- Modify: `packages/pdf/src/extension/plugins/pdfSidecar/plugin.ts` — keep `handleFragment` for `#hl-`
- Modify: browser `sidecar.spec.ts` — rewrite: create path absent; `#hl-` open still works from a pre-existing sidecar fixture on disk in the test harness
- Modify: settings copy for `lumiere.pdf.sidecar.*` — document legacy / unused for new highlights (or leave settings but describe as legacy)

**Interfaces:**
- Produces: no new `sidecarWrite` upserts from the highlight tool; `#hl-` `panels.handleFragment` still `sidecars.reveal`
- Consumes: existing sidecar parse/locate

- [ ] **Step 1: Failing tests** — highlight tool no longer emits `sidecarWrite`; preloaded sidecar file still resolves `#hl-` via Open Location unit test
- [ ] **Step 2: Implement teardown**
- [ ] **Step 3: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat(pdf): drop sidecar highlight create; keep legacy #hl- open

EOF
)"
```

---

### Task 7: `pdfRegions` default off — no empty-page region when off

**Files:**
- Modify: `packages/pdf/src/extension/plugins/pdfRegions/manifest.ts` / plugin — document region selection ownership
- Modify: `packages/pdf/contributes.json` — add `lumiere.pdf.regions.enabled` default `false`; gate Select Region tool menus with `config.lumiere.pdf.regions.enabled`
- Modify: `packages/pdf/src/webview/tool-mode.ts` — do not register/activate `REGION_MODE` when disabled; disable marquee on default mode when disabled
- Modify: `packages/pdf/src/webview/selection.ts` — ignore marquee end when regions disabled
- Modify: `packages/pdf/src/host/viewer/` or preferences — pass `regionsEnabled` into webview init / settings sync
- Modify: `packages/pdf/test/browser/region-selection.spec.ts` / `tool-mode.spec.ts` — default off: empty drag does not create region; when enabled, prior behavior
- Wire `isRegionsEnabled()` used by Task 3

**Interfaces:**
- Setting: `lumiere.pdf.regions.enabled: boolean` default `false`
- When false: no empty-page region drag; Select Region tool hidden; Copy link never emits `viewrect=`
- When true: existing marquee + Select Region; Copy link may emit `viewrect=` (Task 2)
- UX polish when on is out of scope

EmbedPDF default mode today enables empty-space marquee via Selection plugin defaults. Explicitly:

```ts
selection.enableForMode(
  interaction.getDefaultMode(),
  { enableSelection: true, enableMarquee: regionsEnabled },
  documentId,
);
```

- [ ] **Step 1: Failing tests for default-off**
- [ ] **Step 2: Implement setting + webview gates**
- [ ] **Step 3: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat(pdf): default-off pdfRegions; no empty-page region when off

EOF
)"
```

---

### Task 8: Docs, CAPABILITIES/CHANGELOG, browser suite, Host GUI checklist

**Files:**
- Modify: `packages/pdf/README.md`, `packages/pdf/docs/sidecar-highlights.md` (legacy note + pointer to vault Markdown)
- Modify: `packages/pdf/CHANGELOG.md` Unreleased
- Modify: `packages/pdf/AGENTS.md` (already touched in Task 2 — ensure final wording)
- Modify: root `CHANGELOG.md` if product-facing
- Create or update: Host GUI checklist comment in PR template notes (do not open PR yet) — list screenshots: Copy link Quote, overlays, Del split, regions off
- Run: `pnpm --filter @workshop/pdf test` and `pnpm --filter @workshop/pdf test:browser` (fixtures only)

Checklist (Host GUI, Risk Medium):
1. Text select → Copy link to this → clipboard Quote with `#page=` + `#:~:text=`
2. No selection → Copy link → `#page=N` only
3. Note with deep link → open PDF → overlay → hover preview → click opens note
4. Del on overlay no-op; Del on Note/freeText deletes
5. Regions setting off → empty-page drag does nothing; Select Region absent
6. Legacy `#hl-` from an old sidecar still opens/flashes if file present
7. No auto deletion of `*.pdf.lumiere.md`

- [ ] **Step 1: Update docs/CHANGELOG**
- [ ] **Step 2: Run unit + browser; paste evidence in commit body / handoff**
- [ ] **Step 3: Commit**

```bash
git commit -m "$(cat <<'EOF'
docs(pdf): CAPABILITIES/CHANGELOG for Chrome backlink overlays

EOF
)"
```

---

## Spec coverage self-check

| Spec decision | Task |
|---------------|------|
| Drop sidecar-as-highlight-store create; no auto-migrate | Task 6 |
| Copy link Quote only; remove Add notes (N/A — never existed; no auto-paste) | Task 3 |
| Text → `#page=N#:~:text=`; no text → `#page=N` | Tasks 1–3 |
| Chrome `#:~:text=` not selection=/search= | Task 1–2 |
| pdfRegions default off; no empty-page region when off | Task 7 |
| Vault pre-index; per-file lookup; refresh on MD save | Task 4 |
| Overlays from page+text → glyphs; paint after hard annots; hover/click; Del ignore | Task 5 |
| Keep EmbedPDF Note/freeText; Del deletes those | Task 5–6 |
| Legacy `#hl-` / viewrect open best-effort; new Copy never `#hl-` | Tasks 2, 6, 7 |
| Docs/CHANGELOG/Host GUI | Task 8 |

## Placeholder scan

No TBD/TODO left in task steps. Open product choices fixed here:
- Regions gate = `lumiere.pdf.regions.enabled` (default false) owned by pdfRegions (Cordis start/stop not available for PDF plugins today).
- "Add notes" absent in tree → treat as clipboard-only + do not add.
- v1 Text Fragment = `textStart` only (no prefix/suffix ranges).
- Sidecar paint removed; `#hl-` open remains via sidecar read + `goTo` flash.

## Type consistency

- `formatPdfDeepLink` / `parsePdfDeepLinkFragment` / `encodeTextFragment` names shared by Tasks 1–5.
- `PdfBacklinkHit` and `pdfBacklinks` message shared by Tasks 4–5.
- `regionsEnabled` / `lumiere.pdf.regions.enabled` shared by Tasks 2, 3, 7.
- `agentText(..., { regionsEnabled })` + `pageLinkText` shared by Tasks 2–3.

## Execution handoff

Plan complete and saved to `docs/superpowers/plans/2026-11-04-pdf-backlink-overlays-chrome.md`. Two execution options:

1. **Subagent-Driven (recommended)** — dispatch a fresh subagent per task, review between tasks
2. **Inline Execution** — executing-plans with checkpoints

Which approach?

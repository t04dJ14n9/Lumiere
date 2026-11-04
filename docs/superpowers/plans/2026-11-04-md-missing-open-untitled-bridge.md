# Missing `.md` open untitled bridge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Opening a missing `.md` path (e.g. `code test.md`) shows empty Markdown in Lumia with tab title `test.md`; Save writes the workspace file; open never creates the file.

**Architecture:** On reclaim/`openWith` failure for a missing Markdown `file:` URI, open a named `untitled:` bridge document (path ends with intended basename so the tab label is correct), openWith Lumia, map bridge→intended URI; on Save write the path and swap to the real file editor.

**Tech Stack:** VS Code extension API (`CustomTextEditorProvider`, `untitled:` URIs, `WorkspaceEdit` / `workspace.fs`), existing reclaim + document warm in `packages/markdown`.

## Global Constraints

- No workspace disk create on open (金扬 lock).
- Tab title before Save MUST be intended basename (e.g. `test.md`), never `Untitled-N`.
- Implement in worktree `/workspace/worktrees/lumiere-md-missing-open` on branch `fix/md-missing-open-untitled-bridge`.
- TDD: failing test first for each behavior.
- No new Cursor Cloud Agents.

## File map

- Create: `packages/markdown/src/host/missing-open-bridge.ts` — detect missing target, open named untitled, map, save-to-path, swap.
- Create: `packages/markdown/test/unit/host/missing-open-bridge.test.ts` — unit tests with vscode fake / injected deps.
- Modify: `packages/markdown/src/host/reclaim-transfer.ts` — on transfer failure for missing file, call bridge instead of only logging.
- Modify: maybe `packages/markdown/src/host/navigation.ts` open path if `openWith` used for missing notes outside reclaim.
- Modify: `REVIEW.md` when PR-ready (Testing / Risk / How to revert).
- Spec already at `docs/superpowers/specs/2026-11-04-md-missing-open-untitled-bridge-design.md`.

---

### Task 1: Bridge helpers + failing tests

**Files:**
- Create: `packages/markdown/src/host/missing-open-bridge.ts`
- Create: `packages/markdown/test/unit/host/missing-open-bridge.test.ts`

**Interfaces:**
- Produces: `isMissingMarkdownFileUri`, `untitledBridgeUriFor`, `MissingOpenBridge` (remember / take intended on save / clear)

- [ ] Write failing tests for: basename from intended path; untitled URI path ends with basename; map remember/take; reject non-markdown.
- [ ] Run tests — expect FAIL.
- [ ] Implement minimal helpers to pass.
- [ ] Commit.

### Task 2: Wire reclaim failure → open Lumia on bridge

**Files:**
- Modify: `packages/markdown/src/host/reclaim-transfer.ts`
- Test: extend unit tests with injected openWith/openUntitled doubles

- [ ] Failing test: when openWith fails because file missing, bridge opens and openWith(viewType) called with bridge URI.
- [ ] Implement catch path: stat/exists check or FileNotFound; open named untitled empty markdown; openWith Lumia; close leftover native tab when safe.
- [ ] Commit.

### Task 3: Save writes intended path and swaps

**Files:**
- Modify: `packages/markdown/src/host/missing-open-bridge.ts` (+ document willSave / save hook registration from host activation)
- Find existing save hooks (`hostDocuments.onWillSave` / document plugin) and register once.

- [ ] Failing test: save of bridge doc writes intended file contents and clears mapping (use fs temp dir).
- [ ] Implement: on willSave/save of mapped untitled, write to intended `file:`, openWith Lumia on file URI, close untitled.
- [ ] Commit.

### Task 4: Verify package checks

- [ ] `pnpm check` (or package-scoped check used by recent PRs) green for touched packages.
- [ ] Note Host GUI for later (before/after `code test.md`).


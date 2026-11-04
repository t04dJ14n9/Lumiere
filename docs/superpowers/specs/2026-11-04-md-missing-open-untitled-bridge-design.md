# Design: Missing `.md` open → empty Lumia buffer (Save writes path)

**Date:** 2026-11-04  
**Approved:** 金扬 via Lumia Projects (Approach A; tab title must show intended basename before Save)  
**Repo:** `t04dJ14n9/Lumia`  
**Package:** `packages/markdown`  
**Risk:** Medium (editor open/save)

## Goal

`code test.md` (or equivalent open of a missing `.md` / `.markdown` path) opens an empty Markdown note **in Lumia**, not “The editor could not be opened because the file was not found.” The workspace file is created **only on Save** at the intended path.

## Locked decisions

| Topic | Decision |
|--------|----------|
| On open | In-memory / untitled-style bridge only — **no** workspace `createFile` / disk create |
| On Save | Write the real file at the intended `file:` path, then show that file in Lumia |
| Tab title before Save | **Must** show intended basename (e.g. `test.md`), never `Untitled-N` |
| Scope | Host open / reclaim path when Lumia owns Markdown in the workspace |
| Out of scope | Wiki / Quick Switcher create-on-disk; PDF; forcing Lumia without Use Lumia for Markdown |

## Approach

When reclaim / `vscode.openWith` would open a missing `file:` Markdown URI:

1. Open an empty bridge `TextDocument` whose URI/path makes the tab label the intended basename (prefer `untitled:` URI with path ending in that basename, or equivalent that CustomTextEditor accepts and labels correctly).
2. `vscode.openWith` → `lumiere.markdown.editor`.
3. Remember intended `file:` URI for that bridge document.
4. Close the failed / leftover native “file not found” or empty text tab when safe.
5. On first Save of the bridge: create parents if needed, write content to the intended path, open the real `file:` in Lumia, dispose the bridge mapping.

## Non-goals

- Creating the workspace file on open  
- Changing wiki / Quick Switcher create semantics  
- Deferring Lumia until after Save (native-only empty buffer)

## Verify

- Unit tests: missing URI → bridge + basename mapping; Save writes path; no create on open  
- Host GUI before/after for `code test.md`  
- `pnpm check` + relevant package tests  
- REVIEW.md Testing / Risk / How to revert  

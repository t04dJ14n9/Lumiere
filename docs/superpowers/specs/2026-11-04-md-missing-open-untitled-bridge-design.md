# Design: Missing `.md` open → built-in Text Editor (not Lumia)

**Date:** 2026-11-04  
**Approved:** 金扬 via Lumia Projects (Nov 4 2026 product lock — Approach A abandoned)  
**Repo:** `t04dJ14n9/Lumia`  
**Package:** `packages/markdown`  
**Risk:** Medium (editor open)

## Goal

`code test.md` / `cursor test.md` (open of a **missing** `.md` / `.markdown` path) leaves the **built-in Text Editor** dirty buffer until Save. Lumia must **not** `openWith` that missing `file:` URI (no FileNotFound UI from Lumia, no untitled absolute-path bridge).

**Existing** `.md` files still reclaim to Lumia as today (Use Lumia associations → default then openWith Lumia).

## Locked decisions (supersedes Approach A)

| Topic | Decision |
|--------|----------|
| On open (missing) | Built-in Text Editor only — **no** workspace create, **no** Lumia openWith, **no** untitled bridge |
| On Save (missing) | Host/default Save creates the file; reclaim then applies to the existing path |
| Existing files | Reclaim / openWith Lumia unchanged |
| Out of scope | Wiki / Quick Switcher create-on-disk; PDF; forcing Lumia without Use Lumia for Markdown |

## Approach (current)

When reclaim would transfer a `file:` Markdown URI that is **absent on disk**, **skip** the transfer (leave the native text tab). Do not open a named `untitled:` bridge or call `vscode.openWith` for Lumia on the missing path.

## Abandoned

Approach A (named untitled absolute-path bridge / custom scheme): Cursor treats named untitled as associated-resource → FileNotFound; path abandoned for this PR.

## Verify

- Unit / host fakes: missing URI → no Lumia `openWith`; existing → `openWith` Lumia  
- Host GUI: missing `test.md` → built-in editor; `Welcome.md` → Lumia  
- Relevant package reclaim / handoff-host tests green  

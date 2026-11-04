# Design: vault HTML embeds (HTML Embed–style)

**Date:** 2026-11-04  
**Status:** Approved for implementation planning (design locked with 金扬)  
**Approved:** 金扬, 2026-11-04 (Asia/Singapore)  
**Repo:** `t04dJ14n9/lumiere` (GitHub remote `t04dJ14n9/Lumia`)  
**Package:** `packages/markdown` (`@workshop/markdown`), embeds + render security  
**Risk:** Low for this docs PR; **Medium** when the feature is implemented (trusted-workspace script execution in a sealed iframe)  
**Scope:** Design only in this PR — no runtime implementation here.

## Summary

Add Obsidian **HTML Embed**–style support for vault `.html` files: `![[file.html]]` (optional `|WxH`) renders a **sandboxed iframe** that can run the file’s own JavaScript, isolated from Lumia’s webview. This is **not** allowing raw `<script>` (or other active HTML) inside Markdown notes. v1 extends the existing **embeds** plugin with an `html` media kind (Approach A), gates on **workspace trust** the same way https iframes do today, loads HTML via a **blob / opaque URL**, and uses sandbox **`allow-scripts` only** (no `allow-same-origin`). Missing or untrusted targets show the existing broken-embed / missing-embed placeholder path. There is **no** Lumia HTML viewer tab for plain `[[file.html]]` clicks in v1.

## Goals

- Let authors embed vault `.html` demos and widgets with `![[…]]` so the page’s scripts run inside a sealed iframe.
- Match the Obsidian HTML Embed authoring surface for v1: wiki embed syntax only, with optional size.
- Keep note Markdown sanitization unchanged: note-authored `<script>`, `<style>`, forms, `object`, `embed`, and `srcdoc` remain stripped by DOMPurify.
- Seal the iframe from Lumia’s webview origin (HTML Docs–style: scripts allowed, same-origin not).
- Reuse the existing embeds plugin and resource pipeline rather than a new plugin or a render-pass-only hook.

## Non-goals (v1)

- An `html-embed` / `html` fenced code block that runs or displays HTML.
- A Lumia **HTML viewer** editor tab or custom editor for opening `[[file.html]]` (non-embed) clicks.
- Changing DOMPurify / render rules so scripts or `srcdoc` can appear inline in note HTML.
- Remote `.html` embeds over `http(s)` (vault-local `.html` only).
- `allow-same-origin`, `allow-forms`, `allow-popups`, `allow-top-navigation`, or other sandbox flags beyond `allow-scripts`.
- A new Cordis plugin or a post-process that bypasses the embeds plugin.
- Markdown image / link syntax as the primary authoring form for HTML embeds (`![…](file.html)` is out of v1; wiki embed only).
- Editing the `.html` file inside the embed chrome; the file remains a normal vault attachment opened by the host when the user navigates to it outside this embed path.

## Locked decisions

| Topic | Decision |
| --- | --- |
| Product goal | Obsidian HTML Embed–style: sandboxed iframe for vault `.html` so JS can run; **not** inline `<script>` in `.md` |
| Authoring syntax | `![[file.html]]` and `![[file.html\|WxH]]` only; **no** html-embed code block in v1 |
| Surface | **Embeds only** in v1 — no Lumia HTML viewer tab for `[[file.html]]` clicks |
| Default size | Height **600px**, width **full note content width** when no size token is written |
| Sandbox | `allow-scripts` only; **no** `allow-same-origin` (sealed from Lumia); load via **blob / opaque URL** (HTML Docs style) |
| Trust | **Trusted workspaces only**, same gate as https iframes today (`render.trusted` / `workspace.isTrusted`) |
| Architecture | **Approach A:** extend the existing embeds plugin (add `html` media kind); not a new plugin; not render-pass-only |
| Note HTML | `<script>` / `<style>` / forms / `object` / `embed` / `srcdoc` stay stripped via DOMPurify (`sanitizer-options.ts`) |
| Failure UX | Missing or untrusted → broken-embed / missing-embed placeholder (existing embeds missing path) |
| Docs on ship | Update `packages/markdown/CAPABILITIES.md` when the feature lands |
| Verification | Unit + browser tests for size / sandbox / trust; Host GUI shot of `![[demo.html]]` |

## Authoring

### Syntax (v1)

- **Embed (supported):** `![[path/to/file.html]]`
- **Sized embed (supported):** `![[path/to/file.html|640x480]]` (same size token shape as image embeds: optional `|W` or `|WxH`, digits only)
- **Not in v1:** fenced `html-embed` / `html` blocks that execute or frame HTML; Markdown `![…](file.html)` as an HTML iframe embed

Path resolution follows the existing embeds / resources rules (vault-relative and note-relative wiki targets, same as other attachment embeds).

### Sizing

| Written size | Iframe layout |
| --- | --- |
| None | Width = 100% of the note content column; height = **600px** |
| `\|W` (width only) | Width = `W` CSS pixels; height = **600px** |
| `\|WxH` | Width = `W` CSS pixels; height = `H` CSS pixels |

Reuse the existing wiki size parsing helpers in `packages/markdown/src/plugins/embeds/image-size.ts` (`writtenWidth` / `writtenHeight`) so `|WxH` tokens stay consistent with images. Default height **600** applies only to the `html` kind when height is omitted; it does not change image defaults.

### Clicks and non-embed links

- `![[file.html]]` → sandboxed iframe embed (this feature).
- `[[file.html]]` (non-embed) → **unchanged host open / attachment behavior**; v1 does **not** add a Lumia HTML viewer tab or claim a custom editor for `.html`.

## Security

### Two separate surfaces

1. **Note Markdown / rendered HTML** — unchanged. `sanitizerOptions` continues to `FORBID_TAGS` `script`, `style`, `form`, `object`, `embed` and `FORBID_ATTR` `srcdoc`. Trusted workspaces may keep author-written https `<iframe>` tags (existing render path); those frames are constrained by `constrainRemoteContent` today (`allow-scripts allow-same-origin allow-presentation` for https only). Vault HTML embeds are **not** authored as raw iframe tags in the note; they are produced by the embeds plugin.
2. **Vault `.html` embed iframe** — new. The frame’s document is the vault file’s bytes, loaded so its origin is **opaque** relative to Lumia’s webview. Sandbox is **`allow-scripts` only** (no `allow-same-origin`). Scripts inside the HTML file may run in that sealed context; they must not obtain Lumia’s origin, DOM, or extension messaging.

### Trust gate

- HTML embeds render the iframe **only** when the workspace is trusted (`render.trusted` / the same host trust used for https iframes and remote media).
- In an **untrusted** workspace, do not create the iframe, do not fetch or blob the HTML for scripting, and show the broken-embed / missing-embed placeholder (with the same class of messaging used when remote content is disabled — title or missing text as fits the existing embeds UI).

### Load model (HTML Docs style)

- Resolve the vault file through **resources** (contained vault read; outside-vault / escaping paths refused as today).
- Build a **blob URL** (or other opaque URL) from the file bytes with an HTML MIME type, and set that as the iframe `src`.
- Do **not** point the iframe at a `vscode-webview:` / same-origin resource URL that would share Lumia’s origin.
- Revoke blob URLs when the embed pass disposes or the node is restored, following existing media lifetime patterns in embeds.
- Iframe attributes: `sandbox="allow-scripts"`, `loading="lazy"`. Do not set `srcdoc`. Do not add `allow-same-origin`.

### Explicit non-goals for the frame

- No parent↔child `postMessage` protocol in v1.
- No reading Lumia settings, vault index, or RPC from inside the HTML file.
- No promotion of note-inline scripts; authors who need scripts put them in a vault `.html` file and embed it.

## Architecture (Approach A)

Extend the **existing embeds plugin** (`packages/markdown/src/plugins/embeds`), not a new plugin and not a render-pass-only sanitizer hook.

### Touch points (implementation plan; not done in this PR)

1. **Kind detection** — Treat `.html` / `.htm` as a first-class embed kind (preferred: extend `media-kinds` or a sibling helper used by resources + embeds so `html` is not mistaken for a generic attachment card).
2. **Resources** — Load vault HTML bytes / blob URL for embed resolution; keep containment rules.
3. **`post-process.ts` `apply`** — New branch alongside image / audio / video / note / base / pdf: mount the sandboxed iframe for `kind === "html"` when trusted; otherwise missing/broken placeholder.
4. **Estimated height** — Reserve **600px** (or written `H`) so off-viewport remounts do not collapse to one line (`estimated-height.ts` pattern used for `|WxH` images).
5. **CSS** — Embed chrome for the iframe (full content width by default; no shrink-to-fit that fights the written size).
6. **Render security** — Leave `sanitizer-options.ts` forbid lists as they are; do not teach the note sanitizer to allow scripts. Vault HTML iframes are created by embeds, not by author HTML tags.
7. **CAPABILITIES.md** — When shipping, document HTML embeds under the embeds row (trusted-only; sandboxed; wiki embed syntax).

### Rejected alternatives

| Approach | Why rejected |
| --- | --- |
| New Cordis plugin | Duplicates embeds resolution, missing UX, lifetime, and trust wiring |
| Render-pass-only | Would fight DOMPurify and blur “note HTML” vs “vault HTML file”; harder to size and dispose cleanly |
| `sandbox` with `allow-same-origin` | Breaks the seal; HTML could touch Lumia’s webview origin |
| Inline `<script>` in Markdown | Explicitly out of product goal; remains stripped |

## Data flow

1. Dialect / live preview emits an embed placeholder for `![[file.html]]` (existing wiki embed path).
2. Embeds post-process resolves the target through **resources** (syntax `wikilink`, document URI as today).
3. Resources classify the target as **`html`** when the path is a vault `.html` / `.htm` file and return a contained payload suitable for blob URL creation (or equivalent opaque URL).
4. If the workspace is **untrusted**, or the file is **missing** / refused by containment: mark the node missing / broken and set placeholder text via the existing missing-embed path; do not create an iframe.
5. If **trusted** and resolved: create `iframe` with `sandbox="allow-scripts"`, `src=<blob/opaque URL>`, width/height per [Sizing](#sizing); register dispose to revoke the URL and clear children on pass restore.
6. Pass `measure()` after mount so CodeMirror height maps stay correct.

```
![[demo.html|800x400]]
        │
        ▼
  embeds post-process
        │
        ├─ untrusted / missing ──► broken / missing placeholder
        │
        └─ trusted + resolved
                 │
                 ▼
           resources (vault read)
                 │
                 ▼
           blob / opaque URL
                 │
                 ▼
           <iframe sandbox="allow-scripts" src=… width=800 height=400>
```

## Error handling

| Condition | Behavior |
| --- | --- |
| File not found | Existing missing-embed text (`missingEmbedText`); no iframe |
| Outside vault / escaping symlink | Resources refuse; same missing / broken treatment as other refused attachments |
| Untrusted workspace | No iframe; broken-embed / disabled-remote style placeholder (do not run scripts) |
| Empty or unreadable file | Missing / broken placeholder; no iframe |
| Blob URL creation failure | Missing / broken placeholder; no partial frame |
| Pass disposed / node restored | Revoke blob URL; restore original placeholder HTML (existing `rememberPlaceholder` pattern) |

Do not fall back to an attachment-open button for `![[file.html]]` once the html kind ships: the embed either frames the file or shows the broken/missing placeholder. Non-embed `[[file.html]]` keeps today’s open behavior.

## Testing

When implementing (not in this design PR):

- **Unit**
  - Kind detection: `.html` / `.htm` → `html`; other extensions unchanged.
  - Size: no token → height 600 + full width; `|W` → width W, height 600; `|WxH` → both.
  - Trust: untrusted → no iframe / placeholder; trusted → iframe with `sandbox === "allow-scripts"` and **no** `allow-same-origin`.
  - Sanitizer regression: note HTML still strips `script` / `style` / `form` / `object` / `embed` / `srcdoc`.
- **Browser**
  - Fixture `demo.html` with a small script that mutates its own document; assert the mutation is visible inside the iframe and that the parent document is unchanged.
  - Missing file and untrusted workspace paths show placeholders without an iframe.
  - Blob URL revoked / no leaked listeners after pass dispose (follow embeds lifetime tests).
- **Host GUI**
  - Screenshot of a note containing `![[demo.html]]` (and optionally a sized variant) on real Cursor / VS Code Host GUI; prefer GitHub-hosted `host-gui-shot-images/…` when attaching to the implementation PR.
- **Docs**
  - Update `packages/markdown/CAPABILITIES.md` embeds row and any embeds README limits section to describe vault HTML embeds (trusted-only, sandboxed, wiki syntax).

## How to revert

**This design PR:** revert the single docs commit (or close the PR without merging). No runtime behavior changes.

**After implementation:** revert the implementation PR(s); HTML embeds fall back to pre-change attachment-card / missing behavior. Sandbox and trust tests in this design are the acceptance gate before merge of the feature PR. Product risk for the feature is **Medium** (script execution in-editor, mitigated by trust gate + opaque origin + `allow-scripts` only).

## Open questions

None — all decisions in [Locked decisions](#locked-decisions) were fixed by 金扬 on 2026-11-04 (Asia/Singapore).

## Approval record

- Goal, syntax, embeds-only surface, default size, sandbox (no same-origin + blob/opaque URL), trust gate, Approach A, DOMPurify unchanged for notes, missing/untrusted placeholder, and test/CAPABILITIES expectations locked in chat 2026-11-04 (Asia/Singapore).
- Design-only deliverable: `docs/superpowers/specs/2026-11-04-html-embed-design.md`. Implementation and CAPABILITIES update follow in a separate PR after plan.

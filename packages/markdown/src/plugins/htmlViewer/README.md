# HTML Viewer

Opens an HTML file from a link (`[Open](/wiki/diagram.html)`, `[[diagram.html]]`) or from the Open button of an HTML embed's card, as a page in a tab of its own, in a trusted workspace. Obsidian has no HTML viewer: it opens such a file in the system's program.

## How it works

Link navigation hands an `.html` or `.htm` file to the command `lumiere.markdown.htmlViewer.open` with the file's URI and the vault it was linked from, instead of opening it as text. The plugin checks what it is given (two URIs, the first an HTML file, a column VS Code has), then:

- **Both modes**, before anything is opened and with no disk read: the vault must be inside a workspace folder (with none, a `file:` vault, which is where a note opened on its own has one), and the file inside the vault by path. A file that fails is refused with a message, never shown and never opened as text: the command is public, and a caller that names a file outside the vault, or a URI of another scheme in no workspace folder, gets nothing.
- In **Restricted Mode** it then opens the file as text, as a link to it did before this plugin, in the group the link asked for (Open Link to Side is `-2`), and reads nothing. A link opened through `host/navigation.ts` never gets here in Restricted Mode: navigation opens the file as text itself, with the options main gave it (a kept tab for Mod-click, the focus, the group), and asks for the viewer only in a trusted workspace; this branch is for callers that run the command directly.
- Otherwise it checks the file through symbolic links too (the rule embeds follow, `resources/containment.ts`, exported through `resources/api.ts`). A file that fails is refused as above.
- It reads the file in the extension host (UTF-8, at most 16 MB) and makes a webview panel per file (`views.panel` with a key) whose page **is the file** (`document.ts`): the file's own markup, with a `<meta>` policy and a `<base href>` put at the top of its `<head>`. The panel's resource roots are the vault and nothing else, scripts are enabled and command links are not. The `<base>` is the webview address of the file's folder, so a relative stylesheet, script, image or font loads from the vault (VS Code serves the panel's own document its roots; whether it also serves a `fetch` across its origins is to be confirmed in a real window). Opening a link to a file that is already open shows its tab and loads the file again (the page's text carries the time it was loaded, so VS Code does not skip the reload).

The page runs in a webview of its own, with an origin of its own, so it cannot reach Lumiere's editors. It does have VS Code's `acquireVsCodeApi`, as every page with scripts does; **the host registers no message handler for this panel and posts nothing to it**, so nothing it posts is heard, and it has no `command:` links (`enableCommandUris` is false). No frame is used: a frame in a webview is not served the vault's files (a probe in VS Code 1.147 found a sandboxed child frame blank), and the page itself is what VS Code serves them to.

The policy (`viewerPolicy`, tested to the character), for a webview source `S`:

```text
default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' S https:; style-src 'unsafe-inline' S https:; img-src S data: blob: https:; font-src S data: https:; media-src S data: blob: https:; connect-src S blob: https:; frame-src https:; worker-src S blob:; base-uri S; form-action 'none'
```

It lets the page's own inline scripts and styles, and the vault's, run; and `https:` scripts and styles, for the library a page loads from a CDN, which a trusted workspace allows. `unsafe-eval` is there because many generated pages (charts, dashboards) need it, and a page that can run its own script gains nothing from it. Images, fonts and media also come from `data:` and `blob:` and `https:`; the page may `fetch` the vault and `https:`. Forms cannot navigate, no other `<base>` takes effect (ours is first, and `base-uri` allows no other), and nothing is allowed that is not named.

If the plugin is turned off the command does not exist, and navigation opens an HTML file as text.

## Files

- `manifest.ts`: the plugin, its setting and the command `htmlViewer.open` (hidden from the palette: link navigation calls it).
- `host.ts`: the command, the trust check, containment, the read and the panel.
- `request.ts`: the command's arguments, checked, and the tab's title.
- `document.ts`: the policy, and the page with the policy and the base put in its head.
- `test/unit/htmlViewer/document.test.ts`, `host.test.ts`, `request.test.ts`: the policy to the character, the injection (with and without a head, a comment, a byte order mark, a base or policy of the file's own), the panel's options, that the host listens and posts to nothing, trust, containment and size refusals.

## Services injected and provided, events, settings

Injects the host services `hostCommands`, `views`, `workspace` and `dialogs`; provides none and emits and listens to no events. `lumiere.markdown.plugins.htmlViewer.enabled` defaults to true. No other settings. The command is public (`lumiere.markdown.htmlViewer.open`, arguments `(uri, vaultRoot, { viewColumn })`, all strings but the column) and is no entry in the palette.

## Limits and differences from Obsidian

- The page is the panel's document, so it can reach whatever its webview can: the vault's files (as the panel's roots allow), `https:`, and `acquireVsCodeApi` (to a host that listens to nothing). It runs arbitrary script from a vault file: only in a trusted workspace, which is the whole of the protection against a hostile vault.
- The file is set as text: UTF-8 only (a `<meta charset>` for another encoding does not apply), 16 MB at most. A `<base>` of the file's own is ignored; a policy of its own can only narrow ours.
- No popups, downloads or `target="_blank"` that VS Code's webview does not allow; a link in the page is handled by VS Code's webview, not by Lumiere. A relative link to another page does not open it.
- A tab keeps its page while hidden (`retainContextWhenHidden`), so a diagram keeps its state, at a memory cost; closing the tab ends it. The page is not restored when the window reloads, and the file is not watched: opening the link again loads it again.
- A `#subpath` of the link is not passed to the page.

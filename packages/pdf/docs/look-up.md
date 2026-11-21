# macOS Look Up

Look Up shows the Dictionary entry of a word, as Preview does. It is the
plugin `pdfLookUp`, on by default on macOS only
(`lumiere.pdf.lookUp.enabled`; it does nothing on Windows and Linux).

## What works natively, and what is a fallback

| Gesture | Works? | How |
| --- | --- | --- |
| Force click (hard press) or three-finger tap, in VS Code and Cursor | **Yes**, the system's own popover, unverified on a Mac | Chromium never tells a webpage about the force of a click: on a force click (with the system's Look Up gesture set to "Force Click with one finger") or a three-finger tap, it reads the word under the pointer from the page's DOM and shows the Dictionary popover itself. This viewer draws pages as images, so there was no text to read. While Look Up is on, the viewer now puts the word the pointer rests on (or presses) into the page as invisible text, stretched over the word's glyphs (`look-up-word.tsx`), so Chromium finds it. The text sits just above the page picture and below links and annotations, so those keep their clicks; it never becomes a DOM selection (its `selectstart` is cancelled). |
| Force click in WebKit (Safari, and the desktop app on the `hosts-snapshot-2026-11-21` branch; not VS Code, which is Chromium) | **Fallback** | WebKit fires `webkitmouseforcedown`: the viewer finds the word from the PDF's glyph boxes and the extension opens `dict://<word>` in the Dictionary app. |
| Right-click → **Look Up** | **Fallback**, works wherever the menu does | The menu is available when Look Up is enabled on macOS. Its command resolves the saved right-click point, then opens Dictionary for that word. Blank space does nothing. A later hover cannot replace the clicked word, and scrolling or new reader input cancels the old target. |

The right-click entry and the WebKit fallback open the Dictionary app
(`dict://`); only the native gesture shows the small popover, because
Electron's `webContents.showDefinitionForSelection()` is not exposed to
extensions.

## Verifying on a Mac

Unit and browser tests cover the word finder (`wordGlyphRange`, `coreWord`,
`glyphRangeBox`), the hidden word (it is the text Chromium finds at the
pointer, it follows the pointer, drags and double clicks still select the
PDF's text, links and marks keep their clicks), the viewer's event
wiring (force click and context menu messages) and the plugin's on/off
switch. Only a real Mac can show the popover:

1. In System Settings → Trackpad, set Look up & data detectors to "Force
   Click with one finger".
2. Open a PDF in VS Code on macOS, rest the pointer on a word and press hard.
   The Dictionary popover opens on that word.
3. Right-click a word and choose **Look Up**: the Dictionary app opens at it.
4. Set `lumiere.pdf.lookUp.enabled` to `false`: the menu entry disappears and
   a hard press finds nothing.

## Design

- `src/shared/look-up.ts`: pure word finding, URL and platform rule (unit tested).
- `src/webview/look-up.ts`: the events; off until the host sends `lookUp { enabled }`.
- `src/webview/look-up-target.ts`, `src/webview/look-up-word.tsx`: the word
  under the pointer, shown in its page as invisible text.
- `src/extension/plugins/pdfLookUp`: the plugin; stopping it switches every viewer's side off.

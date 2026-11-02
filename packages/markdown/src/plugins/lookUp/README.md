# Look Up (plugin id `lookUp`; command Look Up)

On macOS, **Look Up** in a note's right-click menu opens the word you
right-clicked in the Dictionary app, as the same item does in Lumia PDF.
In Obsidian, as in other Chromium-based apps, the equivalent is macOS's own
gesture (a force click or a three-finger tap on a word), which this plugin
does not replace.

## How it works

macOS's gesture never reaches the page: Chromium reads the word under the
pointer from the DOM itself, so all Lumia can do for it is keep notes'
text real, uncovered and selectable (`test/browser/look-up.spec.ts` guards
that). The menu item is the path that does not depend on the system setting
or on VS Code. When the menu opens, the webview half records the word: the
selection if it is one word (a secondary click on macOS selects the word
under the pointer first), else the word drawn under the pointer, read from
the rendered text with Unicode word boundaries and its punctuation trimmed.
It reads it then rather than when the item runs, because selecting the word
moves the caret and Live Preview reveals that line's Markdown, shifting the
text under the pointer. Choosing the item sends the word to the host half,
which checks it again, builds the `dict://` URL and opens it with
`navigation.external`, on macOS only.

## Files

- `manifest.ts`: the Look Up command and its menu item (macOS, note text).
- `protocol.ts`: the validated `lookUp` request.
- `words.ts`: pure word rules: trimming, one-word selections, word
  boundaries, the host's check and the Dictionary URL.
- `pointer-word.ts`: the word in the selection or under a point in the DOM.
- `webview.ts`: records the menu's word and registers the command.
- `host.ts`: answers the request: macOS and word checks, then the URL.

## Services, events and settings

The webview half injects `editor`, `commands` and `rpc`; the host half, one
per note, injects `rpc` and the host service `navigation`. Neither provides
a service or listens to or emits kernel events. The webview command is
`editor:look-up`, behind `lumiere.markdown.lookUp` (context menu only; not in
the palette). `lumiere.markdown.plugins.lookUp.enabled` defaults to true. The
plugin needs VS Code's window (`needs: ["workbench"]`): host-node's menu
has no `isMac` key, so the item could not show there, and it stays off.

## Limits and differences from Obsidian

- macOS only: the menu item needs VS Code's `isMac`, and the host opens
  nothing on another system. In a remote window (SSH, WSL, a container) the
  extension host is not macOS, so the item shows but does nothing.
- VS Code menus cannot name the word, so the item reads "Look Up", not
  macOS's "Look Up “word”"; it opens the Dictionary app rather than the
  popover beside the word.
- One word: a selected phrase gives way to the word under the pointer. A
  word split across differently styled runs (`un**believ**able`) is read as
  the run under the pointer. A hyphenated word splits at the hyphen when
  right-clicked (Unicode word boundaries); select it whole to look it up.

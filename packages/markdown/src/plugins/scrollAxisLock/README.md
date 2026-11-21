# Axis-locked scrolling

A trackpad or wheel scroll that is nearly straight up and down, or nearly
sideways, moves the note and everything in it that scrolls (wide tables, code
blocks, diagrams, formulas) along that one axis; a clearly diagonal one still
pans freely. It follows VS Code's `editor.scrollPredominantAxis` (on by
default) for Markdown files. Obsidian 1.15.0 has no such setting (a static
search of its `obsidian.asar` finds none); the equivalents are VS Code's own
editor and macOS's `NSScrollView.usesPredominantAxisScrolling`.

## How it works

`@workshop/scroll`'s `AxisLock` reads each wheel event of the editor and
decides, once per gesture (wheel events with no pause of 150 ms, momentum
included) and from its first few events, whether the gesture is within about
26.6 degrees of an axis. If it is, the gesture is locked to that axis.

The browser scrolls wheel gestures itself, off the page's thread, unless a
wheel listener could cancel them; the quality check "no wheel or touch
listener makes scrolling wait for the page" holds the page to none. So the
plugin's listener on the editor's root is passive, and stays so for a straight
swipe, a mouse wheel (which has no sideways movement) and a diagonal gesture.
Only when a gesture is locked and still carries movement across its axis does
the listener become one that can cancel (a few events later, once the browser
honours it), and it is passive again a gesture's pause after the last event.
While it can cancel, each event of the gesture is taken: its movement along
the axis scrolls the nearest scroller that can go that way (the table for a
sideways gesture over a table, the note for an up and down one), and its
movement across the axis is dropped. The events the browser already had are
not taken back, but whatever they moved across the axis is put back in the
next frame.

## Files

- `manifest.ts`: enablement; `predominantAxis` is read from
  `editor.scrollPredominantAxis` (`nativeConfigKeys`), so no setting is
  contributed.
- `webview.ts`: starts and stops the listener with the plugin and the setting.
- `wheel-rails.ts`: the listener, swapped between passive and cancelling.
- `scroll-route.ts`: which scroller a locked gesture moves, and what must not
  move on the other axis.
- `wheel-rails.test.ts`, `scroll-route.test.ts`: the listener's phases, the
  events it takes and the scrollers it picks.

## Services, events and settings

Injects `editor`; provides no service and listens to and emits no kernel
events. `lumiere.markdown.plugins.scrollAxisLock.enabled` defaults to true;
`editor.scrollPredominantAxis` (VS Code's setting) switches the locking.
No commands or keybindings. Other wheel code in the note cooperates through
the event itself: a wheel the plugin has taken is `defaultPrevented`, and the
pinned headings' wheel forwarding and the table's diagonal handler leave such
a wheel alone.

## Limits and differences from VS Code

- VS Code's editor decides each wheel event on its own and keeps the larger
  axis; this decides a gesture once, so a swipe that wobbles across the
  45-degree line does not change axis in the middle. A gesture that is later
  clearly a new swipe across the locked axis (its sideways movement outgrows
  its movement along the axis by 48 px) starts a new gesture.
- The first event or two of a locked gesture reach the browser before the
  plugin can cancel anything, so up to that much movement across the axis
  (a few pixels at the start of a swipe) can remain.
- Ctrl and Cmd wheels (pinch and zoom) and Shift wheels are never touched.
- The note's own scroller rarely scrolls sideways (lines wrap), so most of
  what this does is for nested scrollers; the gesture is judged the same way
  wherever it lands.
- While a gesture is locked, the page waits for the main thread before each
  wheel event, as VS Code's own editor does. Turn `editor.scrollPredominantAxis`
  off to leave every gesture to the browser.

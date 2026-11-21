# Online Videos

A YouTube video or a tweet written as an image, `![](https://www.youtube.com/watch?v=ID)`
or `![](https://x.com/user/status/ID)`, plays or shows in the note, as it does
in Obsidian 1.15.0 (code read; it embeds the same two sites from a web link).
Nothing else is embedded: a link to any other site is an ordinary remote image,
which Embeds shows as `failed to fetch image`, as for any non-image link. In an
untrusted workspace (Restricted Mode) the video or tweet shows as a card with
an **Open on YouTube** / **Open on X** button, and nothing is loaded.

## How it works

`parse.ts` turns the link into a YouTube video or a tweet, with a validated ID
(11 characters of `[A-Za-z0-9_-]`; up to 19 digits) and, for a video, a start
time. It accepts:

- YouTube: `youtube.com`, `www.` or `m.youtube.com` with `/watch?v=ID`,
  `/embed/ID` or `/v/ID`; `youtu.be/ID` (also with `www.` or `m.`); `t=` or
  `start=` as seconds or `1h2m3s`.
- Tweets: `twitter.com`, `x.com`, `mobile.twitter.com` and `mobile.x.com`,
  `/{handle}/status/{ID}` or `/i/web/status/{ID}`, with an optional `/photo/N`
  or `/video/N`; a query or fragment is ignored.

`player.ts` builds the frame's URL from that ID only, never from the link
text: `https://www.youtube-nocookie.com/embed/ID` (`?start=N`) or
`https://platform.twitter.com/embed/Tweet.html?dnt=true&theme={light|dark}&id=ID`,
then checks it against an allowlist of origin, path and query. `embedView`
returns a frame only in a trusted workspace; otherwise a link card. The frame
gets:

- `sandbox`: `allow-scripts allow-same-origin allow-presentation` for a video
  (it runs its player and goes full screen); a tweet adds `allow-popups
  allow-popups-to-escape-sandbox`, because a tweet is made of links, which
  open pages. Neither gets `allow-top-navigation`, `allow-forms` or
  `allow-modals`.
- `referrerpolicy="strict-origin-when-cross-origin"`, `loading="lazy"`, and
  `allow` limited to fullscreen (and picture-in-picture and encrypted media
  for a video). A tweet also has `scrolling="no"`.

`webview.ts` listens to `render/postProcess`, registered before Embeds, and
replaces each `img.note-image` whose `data-resource` parses with the frame or
the card; the image comes back when the pass is disposed. A frame starts
loading 100 ms after it is made (`frame.ts`): the editor renders a block more
than once while a note opens, and each render drops the frames of the one
before, so a frame that loaded at once would load, heavily, to be dropped.

Heights are reserved before the frame is measured, so the block does not
jump: a video is 16:9 (at most 560 px wide, 315 px tall) and a tweet starts
400 px tall (`reservedHeight`, shared with Embeds' height estimate through
`api.ts`). The tweet widget posts its height to the page
(`{"twttr.embed": {method: "twttr.private.resize", params: [{height}]}}`);
`tweet-height.ts` takes it only from a message whose `source` is that frame's
window and whose `origin` is `https://platform.twitter.com`, reads only the
fields it uses and requires each to have its type, and clamps the height to
100–1000 px. The theme comes from VS Code's body class (`vscode-dark` and
`vscode-high-contrast` are dark), read when the frame is made, as Obsidian
reads its own.

The Render sanitizer and `constrainRemoteContent` are unchanged: they decide
which iframes written in a note's HTML survive (https, sandboxed, trusted
only). The webview's CSP admits `https:` frames only in a trusted workspace
(`frame-src`, plugins/editor/webview-html.ts); `webview-html.test.ts` pins that
both origins pass it then and none does otherwise.

## Files

- `manifest.ts`: enablement.
- `webview.ts`: the post-processor that swaps images for frames or cards.
- `parse.ts`: link recognition and ID validation.
- `player.ts`: frame URLs, the allowlist, sandboxes, attributes, the theme,
  height constants and which of frame or card an embed gets.
- `frame.ts`: the frame's DOM and its delayed load, and the tweet height
  listener (one `message` listener per render pass).
- `tweet-height.ts`: which messages count as a tweet frame's height, and the
  clamp.
- `card.ts`: the Restricted Mode card.
- `api.ts`: what Embeds may import (`parseWebEmbed`, `reservedHeight`).
- `onlineVideos.css`: frames and the card, bundled through
  `src/webview/styles/index.css`.
- `parse.test.ts`, `player.test.ts`, `tweet-height.test.ts`: unit tests;
  `test/browser/online-videos.spec.ts`, `online-video-remount-height.spec.ts`:
  frames, one request per frame, the tweet's height, reveal, trust and the
  height held across a remount.

## Services, events and settings

Injects `render` (for workspace trust) and `rpc` (Links `open`, for the card's
button); provides no services; has no host half. Listens to
`render/postProcess`. Emits no events.
`lumiere.markdown.plugins.onlineVideos.enabled` (default true) is the only
setting; switched off, the links fall back to Embeds (a remote image).

## Limits and known differences from Obsidian

- **YouTube may refuse to play in VS Code.** The webview page is not http(s), so
  its frames get no referrer, and YouTube answers "Video player configuration
  error, Error 153". It did for `youtube-nocookie.com` and `youtube.com`, with
  or without `origin` and `widget_referrer`, in VS Code 1.141 (Electron 43,
  Chromium 150) on 2026-10-09, when this plugin's card offered no player for
  that reason. Obsidian's desktop app, whose page is not https either, embeds
  YouTube through a page of its own (`releases.obsidian.md/youtube`, line
  98291 of its code); this embed has the URL Obsidian uses on the web and
  cannot supply a referrer, so it may show the same error, and playing in VS
  Code is not guaranteed.
- Shorts, live, playlist and channel links, `music.youtube.com`,
  `youtube-nocookie.com` links and `www.twitter.com` / `www.x.com` links are not
  embedded. Obsidian's YouTube pattern takes the first path word as the ID, so a
  Shorts or live link becomes the broken player `/embed/shorts` (`/embed/live`),
  and its tweet pattern takes the last number in the path, so a `/photo/1` link
  embeds tweet 1. Here the ID must be well formed and in one of the shapes
  above. Obsidian's patterns do not match `www.` on Twitter or `music.` and
  `-nocookie` on YouTube either.
- A start time written `1m30s` is 90 seconds here; Obsidian reads the digits
  only and starts at 1.
- Obsidian's widget selects its source when clicked; a frame takes the click
  itself, so the caret reveals the source as for an image instead.
- The theme is read when the tweet is drawn: a theme change shows after the note
  renders again.
- A tweet frame's height follows only a resize message that is an object, as
  Obsidian reads it; a widget that posts it as a JSON string keeps the starting
  height.
- The Spotify, SoundCloud, Vimeo, Hugging Face and npm cards, all Bilibili cards
  and the YouTube playlist and channel cards, and the setting
  `lumiere.markdown.onlineVideos.bilibiliPlayer`, no longer exist: Obsidian has
  none of them, and a link to them is a plain image. A Bilibili inline player is
  tracked in issue #835.

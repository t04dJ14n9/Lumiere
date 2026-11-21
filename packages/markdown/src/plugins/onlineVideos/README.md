# Online Videos (embedded tweets)

A tweet written as an image, `![](https://x.com/user/status/ID)`, shows in the
note as the tweet itself, as it does in Obsidian 1.15.0 (code read; it embeds
the same site from a web link). Nothing else is embedded: a link to any other
site, YouTube included, is an ordinary remote image, which Embeds shows as
`failed to fetch image`, as for any non-image link. In an untrusted workspace
(Restricted Mode) the tweet shows as a card with an **Open on X** button, and
nothing is loaded.

The plugin keeps the id `onlineVideos`, and so its setting
`lumiere.markdown.plugins.onlineVideos.enabled`, from when it carded video
sites; renaming it would drop users' settings. Its title is "Embedded tweets".

## How it works

`parse.ts` turns the link into a tweet with a validated ID (up to 19 digits).
It accepts `twitter.com`, `x.com`, `mobile.twitter.com` and `mobile.x.com`
with `/{handle}/status/{ID}` or `/i/web/status/{ID}`, and an optional
`/photo/N` or `/video/N`; a query or fragment is ignored.

`tweet-embed.ts` builds the frame's URL from that ID only, never from the link
text:
`https://platform.twitter.com/embed/Tweet.html?dnt=true&theme={light|dark}&id=ID`,
then checks it against an allowlist of origin, path and exact query.
`embedView` returns a frame only in a trusted workspace; otherwise a link card.
The frame gets:

- `sandbox="allow-scripts allow-same-origin allow-presentation allow-popups
  allow-popups-to-escape-sandbox"`: the widget runs its scripts, and it is made
  of links (the author, the tweet, a link card, its media), so it needs popups;
  the pair lets the page that opens run unsandboxed, as a page opened from a
  link would. No `allow-top-navigation`, `allow-forms` or `allow-modals`: it
  cannot send the editor elsewhere.
- `referrerpolicy="strict-origin-when-cross-origin"`, `loading="lazy"`,
  `allow="fullscreen"` and `scrolling="no"`.

`webview.ts` listens to `render/postProcess`, registered before Embeds, and
replaces each `img.note-image` whose `data-resource` parses with the frame or
the card; the image comes back when the pass is disposed. A frame starts
loading 100 ms after it is made (`frame.ts`): the editor renders a block more
than once while a note opens, and each render drops the frames of the one
before, so a frame that loaded at once would load, heavily, to be dropped.

The frame starts 400 px tall (`TWEET_DEFAULT_HEIGHT`, shared with Embeds'
height estimate through `api.ts`), so the block does not jump while it loads.
The widget posts its height to the page
(`{"twttr.embed": {method: "twttr.private.resize", params: [{width, height}]}}`);
`tweet-height.ts` takes it only from a message whose `source` is that frame's
window and whose `origin` is `https://platform.twitter.com`, reads only the
fields it uses and requires each to have its type (the envelope carries more,
`jsonrpc`, `id` and a `data` object among them), and clamps the height to
100–1000 px. The theme comes from VS Code's body class (`vscode-dark` and
`vscode-high-contrast` are dark), read when the frame is made, as Obsidian
reads its own.

The Render sanitizer and `constrainRemoteContent` are unchanged: they decide
which iframes written in a note's HTML survive (https, sandboxed, trusted
only). The webview's CSP admits `https:` frames only in a trusted workspace
(`frame-src`, plugins/editor/webview-html.ts); `webview-html.test.ts` pins that
the widget's origin passes it then and not otherwise.

## Files

- `manifest.ts`: enablement (the id and why it stays).
- `webview.ts`: the post-processor that swaps images for frames or cards.
- `parse.ts`: link recognition and ID validation.
- `tweet-embed.ts`: the frame URL, the allowlist, the sandbox, attributes,
  the theme, the height constants and which of frame or card a tweet gets.
- `frame.ts`: the frame's DOM and its delayed load, and the height listener
  (one `message` listener per render pass).
- `tweet-height.ts`: which messages count as a frame's height, and the clamp.
- `card.ts`: the Restricted Mode card.
- `api.ts`: what Embeds may import (`parseTweet`, `TWEET_DEFAULT_HEIGHT`).
- `onlineVideos.css`: frames and the card, bundled through
  `src/webview/styles/index.css`.
- `parse.test.ts`, `tweet-embed.test.ts`, `tweet-height.test.ts`: unit tests;
  `test/browser/online-videos.spec.ts`, `online-video-remount-height.spec.ts`:
  the frame, one request per frame, its height, reveal, trust and the height
  held across a remount.

## Services, events and settings

Injects `render` (for workspace trust) and `rpc` (Links `open`, for the card's
button); provides no services; has no host half. Listens to
`render/postProcess`. Emits no events.
`lumiere.markdown.plugins.onlineVideos.enabled` (default true) is the only
setting; switched off, the links fall back to Embeds (a remote image).

## Limits and known differences from Obsidian

- **YouTube is not embedded; Obsidian embeds it.** In VS Code's webview the
  `youtube-nocookie.com` player answers "Video player configuration error,
  Error 153" and does not play: the webview page is not http(s), so its frames
  get no referrer (the frame's `document.referrer` is empty). Measured in VS
  Code 1.147 on 2026-11-22, and in 1.141 on 2026-10-09 with `youtube.com` as
  well, with or without `origin` and `widget_referrer`. Obsidian's desktop app,
  whose page is not https either, embeds YouTube through a page of its own
  (`releases.obsidian.md/youtube`); that is not copied. A YouTube link is an
  ordinary remote image.
- Obsidian's tweet pattern takes any path and the last number in it, so a
  `/photo/1` link embeds tweet 1; here the ID must follow `/status/`, and
  `www.twitter.com` and `www.x.com` links, which Obsidian's pattern does not
  match either, are not embedded.
- Obsidian's widget selects its source when clicked; a frame takes the click
  itself, so the caret reveals the source as for an image instead.
- The theme is read when the tweet is drawn: a theme change shows after the note
  renders again.
- A frame's height follows only a resize message that is an object, as Obsidian
  reads it; a widget that posts it as a JSON string keeps the starting height.
- The Spotify, SoundCloud, Vimeo, Hugging Face and npm cards, all Bilibili cards,
  the YouTube cards (video, playlist and channel) and the setting
  `lumiere.markdown.onlineVideos.bilibiliPlayer` no longer exist: Obsidian has
  none of the cards, and a link to those sites is a plain image. A Bilibili
  inline player is tracked in issue #835.

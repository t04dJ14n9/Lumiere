# Download Attachments: remaining parity work (issue #695)

This note records what is left after the first, pure step of issue #695. That
step adds two helpers in
`src/plugins/attachments/download-response.ts`:
`contentDispositionFilename` parses a `Content-Disposition` file name
(RFC 6266, including RFC 5987 `filename*=UTF-8''…`), and `isImageResponse`
decides whether a fetched response is actually an image. They are **not wired
into the command yet**; this commit changes no behaviour. Unit tests live in
`test/unit/attachments/download-response.test.ts`.

The gap is against Obsidian 1.15.0's **Download attachments for current
file** (read from its app.js with REA, static; see `docs/PARITY.md:215`).

## Still to do

- **Gallery to untick images.** Obsidian shows the images it found and lets
  the user untick some before downloading; Lumia still asks one yes/no
  question in `src/plugins/attachments/download-command.ts`. Wire a host
  dialog that returns the selected URLs and download only those.
- **Property URLs.** Obsidian also downloads image URLs in the note's
  properties/frontmatter and turns them into `[[…]]` embeds. Lumia only reads
  Markdown images (`src/attachments/download.ts`), so property URLs are never
  offered.
- **Skipping non-image URLs.** Feed `isImageResponse` into
  `loadAttachmentSource` (`src/attachments/source.ts`) so a URL that serves no
  image is skipped rather than left alone. Two decisions remain: how to treat
  a generic `application/octet-stream` answer at an image URL (the helper
  currently trusts any declared type), and how a
  `content-disposition` name replaces `downloadStem` when naming and giving a
  unique name to the saved file. The helper returns only the last path segment;
  the caller must still sanitise it as `downloadStem` does.

## Not in this step

- No change to the download dialogs, saves, embeds, or property handling.
- No browser/native regression: coverage is unit tests only (AGENTS.md).
- Runtime/visual parity against a live 1.15.0 vault has not been observed;
  verify in a disposable vault, never the owner's.

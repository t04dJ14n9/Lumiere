# Large PDFs

What the viewer does with a PDF's bytes, and the largest file it opens.

## One read per change, for every pane

Each editor of a PDF has its `PdfSource` (`src/host/viewer/source.ts`), but
the file behind them is shared (`src/host/viewer/shared-file.ts`), one per
file URI and host, kept while an editor of it is open:

- one watcher for the file, however many panes show it;
- a change on disk, once it has settled (150 ms), is read and hashed once,
  and the bytes go to every pane, each of which reloads only if they differ
  from what it shows (or from what it just wrote);
- panes that read the file at the same moment (opening it, a reload) share
  that read. A read that has finished is not handed out again: the next one
  reads the file, so a pane never opens bytes older than the file.

The SHA-256 (which names the annotation file) is computed in 16 MB slices,
yielding between them, so a large PDF does not hold up the extension host.

Outside VS Code (`packages/host-node`), the pages of one workspace share
one set of files, so they share reads the same way.

## The size limit

The viewer opens PDFs up to **512 MB** (`MAX_PDF_BYTES`; a host may set
`PdfFiles.maxBytes`). A larger file is refused before it is read, when the
host can tell its size (VS Code and host-node both can), with a message
naming the file and the limit; a host that cannot is refused once the bytes
are read. The file is not streamed instead: the engine opens a PDF only
from its whole bytes in memory, and those are held by the extension host,
the message to the viewer, and the engine's WASM heap, so a much larger
file would risk the webview rather than only be slow.

The bookmark reader for `[[paper.pdf#` completions has its own, lower
limit (200 MB), as it runs in the extension host.

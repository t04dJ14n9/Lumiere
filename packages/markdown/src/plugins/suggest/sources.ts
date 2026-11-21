import { materialize } from "./insertion";
import type { VaultIndex, VaultChange, VaultFile } from "../vault/api";
import type { Query, Suggestion } from "./protocol";
import {
  candidate,
  fileCandidates,
  noteBlockCandidates,
  pdfSectionCandidates,
  tagCandidates,
  type Candidate,
} from "./candidates";
import { noteBlocks } from "../../markdown/metadata/note-blocks";
import type { PdfSection } from "../../shared/pdf-outlines";
import { rankedCandidates } from "./rank";
const isPdf = (file: VaultFile) => file.extension.toLowerCase() === "pdf";
/** How many notes `[[^^` reads at once. */
const READ_BATCH = 16;
/** Groups rebuild after index changes; unchanged files retain prepared ranking text. */
export class SuggestionIndex {
  private readonly groups = new Map<string, readonly Candidate[]>();
  private readonly files = new Map<string, readonly Candidate[]>();
  /** The bookmarks last read from each PDF, and what they were made into. */
  private readonly pdfSections = new Map<
    string,
    { read: readonly PdfSection[]; candidates: readonly Candidate[] }
  >();
  /**
   * @param readText A note's current text, to offer every one of its blocks;
   *   without it only blocks with an id are offered.
   * @param readSections A PDF's bookmarks, to offer them after `[[paper.pdf#`;
   *   without it a PDF has nothing to offer there.
   */
  constructor(
    private readonly vault: VaultIndex,
    private readonly readText?: (file: VaultFile) => Promise<string>,
    private readonly readSections?: (
      file: VaultFile,
    ) => Promise<readonly PdfSection[]>,
  ) {}

  /**
   * Read what `request` asks for beyond the vault's metadata, so `query` can
   * answer at once: every block of a note (of every note, for `[[^^`), or the
   * bookmarks of a PDF.
   */
  async prepare(
    source: string,
    request: Query,
    isCancelled: () => boolean = () => false,
  ): Promise<void> {
    if (request.kind === "block" && request.note === undefined) {
      await this.prepareVaultBlocks(isCancelled);
      return;
    }
    const path = this.targetPath(source, request);
    const file = path === undefined ? undefined : this.vault.file(path);
    if (!file) {
      return;
    }
    if (request.kind === "block") {
      await this.prepareBlocks(file);
    } else if (request.kind === "heading" && isPdf(file)) {
      await this.prepareSections(file);
    }
  }
  /**
   * Every block of every note, as Obsidian's `[[^^` reads them all. Each
   * note is read once and kept until it changes; a cancelled query leaves
   * the rest for the next one, which offers what is read so far.
   */
  private async prepareVaultBlocks(isCancelled: () => boolean): Promise<void> {
    if (!this.readText) {
      return;
    }
    const unread = this.vault
      .files()
      .filter(
        (file) => !file.excluded && !this.files.has(`allBlocks:${file.path}`),
      );
    for (let start = 0; start < unread.length; start += READ_BATCH) {
      if (isCancelled()) {
        return;
      }
      await Promise.all(
        unread
          .slice(start, start + READ_BATCH)
          .map((file) => this.prepareBlocks(file)),
      );
    }
  }
  private async prepareBlocks(file: VaultFile): Promise<void> {
    const note = this.vault.metadata(file.path);
    const key = `allBlocks:${file.path}`;
    if (!this.readText || !note || this.files.has(key)) {
      return;
    }
    const text = await this.readText(file);
    this.files.set(
      key,
      noteBlockCandidates(file, text, noteBlocks(text, note)),
    );
    this.groups.clear();
  }
  /**
   * Asked on every keystroke: the reader answers from its own cache until the
   * PDF changes, so what was made into candidates is reused while it is the
   * same list.
   */
  private async prepareSections(file: VaultFile): Promise<void> {
    if (!this.readSections) {
      return;
    }
    const read = await this.readSections(file);
    if (this.pdfSections.get(file.path)?.read === read) {
      return;
    }
    this.pdfSections.set(file.path, {
      read,
      candidates: pdfSectionCandidates(file, read),
    });
    this.groups.clear();
  }
  invalidate(change?: VaultChange): void {
    this.groups.clear();
    if (change) {
      this.forget(change.path);
      if (change.type === "rename") {
        this.forget(change.oldPath);
      }
    }
  }
  private forget(path: string): void {
    for (const kind of ["link", "heading", "block", "allBlocks"]) {
      this.files.delete(`${kind}:${path}`);
    }
    this.pdfSections.delete(path);
  }
  query(source: string, request: Query, useWikilinks = true): Suggestion[] {
    const entries = withoutCaretBlock(
      this.candidates(source, request),
      source,
      request,
    );
    const selected =
      request.kind === "tag" && !request.query
        ? entries.slice(0, 50)
        : rankedCandidates(entries, request.query);
    // BH-041 / BH-042: the live overlay indexes the token being typed. That
    // exact literal then ranks first (fuzzy exact match), so Tab accepts a
    // no-op instead of a real completion (Wel above Welcome; fi above
    // fixture). Drop unresolved link literals that equal the query. For tags,
    // drop the query-exact literal only when a longer tag still matches —
    // otherwise Enter can still finish a fully typed tag with a space.
    const query = request.query;
    const useful = (() => {
      if (query.length === 0) {
        return selected;
      }
      if (request.kind === "link") {
        return selected.filter(
          (entry) =>
            !(
              entry.value.kind === "literal" &&
              entry.detail === "Unresolved link" &&
              entry.value.text.toLowerCase() === query.toLowerCase()
            ),
        );
      }
      if (request.kind === "tag") {
        const lower = query.toLowerCase();
        const hasLonger = selected.some(
          (entry) =>
            entry.value.kind === "literal" &&
            entry.value.text.toLowerCase().startsWith(lower) &&
            entry.value.text.length > query.length,
        );
        if (!hasLonger) {
          return selected;
        }
        return selected.filter(
          (entry) =>
            !(
              entry.value.kind === "literal" &&
              entry.value.text.toLowerCase() === lower
            ),
        );
      }
      return selected;
    })();
    return useful
      .map((entry) =>
        materialize({
          vault: this.vault,
          source,
          entry,
          globalBlock: request.note === undefined,
          bare: request.bare === true,
          useWikilinks: useWikilinks || request.kind === "tag",
        }),
      )
      .filter((item) => item.insert.length <= 8192);
  }
  private candidates(source: string, request: Query): readonly Candidate[] {
    const path = this.targetPath(source, request);
    const key = JSON.stringify([request.kind, path]);
    let entries = this.groups.get(key);
    if (!entries) {
      entries = this.collect(request.kind, path).filter(
        (item) => item.label.length <= 8192 && item.detail.length <= 8192,
      );
      this.groups.set(key, entries);
    }
    return entries;
  }
  private targetPath(source: string, request: Query): string | undefined {
    if (
      request.kind === "link" ||
      request.kind === "tag" ||
      request.note === undefined
    ) {
      return undefined;
    }
    if (request.note === "") {
      return source;
    }
    return this.vault.resolveLink(request.note, source)?.path ?? "";
  }
  private collect(kind: Query["kind"], path: string | undefined): Candidate[] {
    if (kind === "tag") {
      return tagCandidates(this.vault);
    }
    const target = path === undefined ? undefined : this.vault.file(path);
    const files =
      path === undefined
        ? this.vault.files()
        : [target].filter((file): file is VaultFile => !!file);
    const result: Candidate[] = [];
    const unresolved = new Set<string>();
    for (const file of files) {
      // Obsidian still suggests an excluded note, 10 points lower.
      if (file.excluded && kind !== "link") {
        continue;
      }
      result.push(...this.offered(file, kind));
      if (kind === "link") {
        for (const text of this.vault.unresolvedLinks(file.path).keys()) {
          unresolved.add(text);
        }
      }
    }
    for (const text of unresolved) {
      result.push(
        candidate(text, "Unresolved link", { kind: "literal", text }),
      );
    }
    return result;
  }
  /**
   * What `file` offers for `kind`. A note's blocks are all offered once its
   * text is read; until then (or with no way to read it), its blocks with an
   * id. A PDF offers its bookmarks where a note offers its headings.
   */
  private offered(
    file: VaultFile,
    kind: "link" | "heading" | "block",
  ): readonly Candidate[] {
    if (kind === "block") {
      const all = this.files.get(`allBlocks:${file.path}`);
      if (all) {
        return all;
      }
    }
    if (kind === "heading" && isPdf(file)) {
      return this.pdfSections.get(file.path)?.candidates ?? [];
    }
    return this.forFile(file, kind);
  }
  private forFile(
    file: VaultFile,
    kind: "link" | "heading" | "block",
  ): readonly Candidate[] {
    const key = `${kind}:${file.path}`;
    let entries = this.files.get(key);
    if (!entries) {
      entries = fileCandidates(this.vault, file, kind);
      this.files.set(key, entries);
    }
    return entries;
  }
}
/**
 * `[[^^` leaves out the block the caret is in, as Obsidian does: a block
 * does not link to itself, nor get an id while it is being typed.
 */
function withoutCaretBlock(
  entries: readonly Candidate[],
  source: string,
  request: Query,
): readonly Candidate[] {
  const caret = request.caret;
  if (
    request.kind !== "block" ||
    request.note !== undefined ||
    caret === undefined
  ) {
    return entries;
  }
  return entries.filter(
    ({ value, range }) =>
      !(
        range &&
        value.kind === "block" &&
        value.target.path === source &&
        range.from <= caret &&
        caret <= range.to
      ),
  );
}
export function suggestions(
  vault: VaultIndex,
  source: string,
  request: Query,
): Suggestion[] {
  return new SuggestionIndex(vault).query(source, request);
}

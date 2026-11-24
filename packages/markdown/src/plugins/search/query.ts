import type { VaultIndex, VaultFile } from "../vault/api";
import type { Cancellation } from "../../shared/rpc/lifecycle";
import { RpcError } from "../../shared/rpc/lifecycle";
import { folderOf, nameOf, relativeVaultPath } from "../../shared/vault-path";
import {
  SearchTimeoutError,
  type SearchEvaluator,
  type SearchVerdict,
} from "./runner";
import type { SearchResponse } from "./protocol";
import { SEARCH_RESULT_LIMIT, SEARCH_SKIP_LIMIT } from "./limits";
import type { SearchDocument } from "../../markdown/search/evaluate";
import { readAhead } from "./read-ahead";
export interface SearchInput {
  vault: VaultIndex;
  /**
   * The note holding the query block: links are relative to it, and its own
   * query blocks are not searched. Undefined for the Vault Search view, whose
   * links are relative to the vault's root.
   */
  source?: string;
  /** Evaluates the query, and finds a hit's match lines, in a worker. */
  worker: SearchEvaluator;
  token: Cancellation;
  read(uri: string): Promise<string>;
  /** Called with the matches found since the last call, as files are scored (throttled). */
  onPartial?: (snapshot: SearchResponse) => void;
}
/** Minimum gap between partial snapshots; final sort still arrives via the RPC result. */
const PARTIAL_INTERVAL_MS = 32;
/**
 * Notes read ahead of the one being evaluated. Reads overlap, so a vault on
 * a slow disk is not searched one round trip at a time; evaluation stays in
 * order, one document at a time, so each keeps its own worker deadline.
 */
const READ_AHEAD = 8;

/** A file's search document, or why it has none. */
type Prepared =
  | { kind: "document"; document: SearchDocument }
  | { kind: "skip" }
  | { kind: "failed"; error: unknown };

export async function searchVault(input: SearchInput): Promise<SearchResponse> {
  const { vault, source, worker, token } = input;
  const origin =
    source === undefined
      ? { path: undefined }
      : vault.files().find((file) => file.uri === source);
  if (!origin) {
    throw new Error("Unknown search source");
  }
  await worker.ready;
  const results: SearchResponse["results"] = [];
  const skipped: string[] = [];
  let unreadable = 0;
  let stopped: Stop | undefined;
  const emit = createPartialEmitter(results, input.onPartial);
  const files = vault
    .files()
    .filter((file) => !file.excluded)
    .sort((a, b) => a.path.localeCompare(b.path));
  const documents = readAhead(
    files,
    (file) => prepareDocument(input, origin.path, file),
    READ_AHEAD,
  );
  for (const file of files) {
    stopped = stopBefore(results, skipped);
    if (stopped) {
      break;
    }
    const prepared = token.cancelled ? undefined : await documents.next();
    const outcome = prepared
      ? await evaluateDocument(input, { origin, file, prepared }, results)
      : "cancel";
    if (outcome === "cancel") {
      emit.flush();
      throw new RpcError("Cancelled", "Search cancelled");
    }
    if (outcome === "unreadable") {
      emit.push(++unreadable);
    } else if (outcome === "hit") {
      emit.push(unreadable);
    } else if (outcome === "timeout") {
      skipped.push(file.path);
    }
  }
  emit.flush();
  results.sort(
    (a, b) =>
      nameOf(a.path).localeCompare(nameOf(b.path)) ||
      a.path.localeCompare(b.path),
  );
  return {
    results,
    unreadable,
    ...(skipped.length > 0 ? { skipped } : {}),
    ...(stopped ? { [stopped]: true } : {}),
  };
}

/** Why a search ends before its next note: a limit it has reached. */
type Stop = "truncated" | "tooSlow";

/**
 * Checked before each note, so a search whose last note reaches a limit is
 * not reported as cut short.
 */
function stopBefore(
  results: readonly unknown[],
  skipped: readonly string[],
): Stop | undefined {
  if (results.length >= SEARCH_RESULT_LIMIT) {
    return "truncated";
  }
  return skipped.length >= SEARCH_SKIP_LIMIT ? "tooSlow" : undefined;
}

/** Never rejects: a read that fails counts as an unreadable file. */
async function prepareDocument(
  input: SearchInput,
  originPath: string | undefined,
  file: VaultFile,
): Promise<Prepared> {
  if (documentKind(file.extension) === "file" && !input.worker.includesFiles) {
    return { kind: "skip" };
  }
  try {
    const document = await searchDocument(input, file, originPath);
    return { kind: "document", document };
  } catch (error) {
    return { kind: "failed", error };
  }
}

async function evaluateDocument(
  input: SearchInput,
  target: {
    origin: { path: string | undefined };
    file: VaultFile;
    prepared: Prepared;
  },
  results: SearchResponse["results"],
): Promise<"skip" | "hit" | "unreadable" | "timeout" | "cancel"> {
  const { worker, token } = input;
  const { origin, file, prepared } = target;
  if (token.cancelled) {
    return "cancel";
  }
  if (prepared.kind === "skip") {
    return "skip";
  }
  if (prepared.kind === "failed") {
    return "unreadable";
  }
  let verdict: SearchVerdict;
  try {
    verdict = await worker.matches(prepared.document);
  } catch (error) {
    if (worker.stopped || token.cancelled) {
      throw error;
    }
    return error instanceof SearchTimeoutError ? "timeout" : "unreadable";
  }
  if (!verdict.matched) {
    return "skip";
  }
  const href = relativeVaultPath(folderOf(origin.path ?? ""), file.path)
    .split("/")
    .map(encodeURIComponent)
    .join("/");
  // The worker found the match lines: they run the user's regexes.
  const matches = verdict.matches ?? [];
  results.push({
    path: file.path,
    href,
    ...(matches.length > 0 ? { matches } : {}),
  });
  return "hit";
}

/**
 * Streams the matches found since the last partial, at most once per
 * PARTIAL_INTERVAL_MS. It reads `results` when it sends, so a hit costs no
 * copy, and a search with n hits sends n results in all, not n²/2.
 */
function createPartialEmitter(
  results: SearchResponse["results"],
  onPartial?: (snapshot: SearchResponse) => void,
) {
  if (!onPartial) {
    return { push() {}, flush() {} };
  }
  let last = 0;
  let sent = 0;
  let unreadable = 0;
  let isPending = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const send = () => {
    last = Date.now();
    isPending = false;
    const added = results.slice(sent);
    sent = results.length;
    onPartial({ results: added, unreadable });
  };
  const cancelTimer = () => {
    clearTimeout(timer);
    timer = undefined;
  };
  return {
    push(count: number) {
      unreadable = count;
      isPending = true;
      const now = Date.now();
      if (now - last >= PARTIAL_INTERVAL_MS) {
        cancelTimer();
        send();
        return;
      }
      timer ??= setTimeout(
        () => {
          timer = undefined;
          if (isPending) {
            send();
          }
        },
        PARTIAL_INTERVAL_MS - (now - last),
      );
    },
    flush() {
      cancelTimer();
      if (isPending) {
        send();
      }
    },
  };
}
function documentKind(extension: string): "markdown" | "canvas" | "file" {
  if (/^(md|markdown)$/i.test(extension)) {
    return "markdown";
  }
  return extension.toLowerCase() === "canvas" ? "canvas" : "file";
}

async function searchDocument(
  input: Pick<SearchInput, "vault" | "worker" | "read">,
  file: VaultFile,
  originPath?: string,
): Promise<SearchDocument> {
  const kind = documentKind(file.extension);
  const cached =
    input.worker.requiresMetadata && !input.worker.requiresText
      ? input.vault.metadata(file.path)
      : undefined;
  const metadata = cached
    ? {
        tags: cached.tags.map(({ tag }) => tag.replace(/^#/, "")),
        properties: cached.frontmatter ?? {},
      }
    : undefined;
  const needsMetadata =
    input.worker.requiresMetadata && kind === "markdown" && !metadata;
  const read = kind !== "file" && (input.worker.requiresText || needsMetadata);
  const raw = read ? await input.read(file.uri) : "";
  const text =
    kind === "markdown" && file.path === originPath
      ? blankQueryFences(raw)
      : raw;
  return {
    path: file.path,
    kind,
    text,
    ...(!read && metadata && { metadata }),
  };
}

function blankQueryFences(text: string): string {
  return text.replace(
    /^(`{3,}|~{3,})[ \t]*query\b[^\r\n]*\r?\n[\s\S]*?(?:^\1[ \t]*$|$)/gm,
    (match) => match.replace(/[^\r\n]/g, " "),
  );
}

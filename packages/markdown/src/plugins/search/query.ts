import type { VaultIndex, VaultFile } from "../vault/api";
import type { Cancellation } from "../../shared/rpc/lifecycle";
import { RpcError } from "../../shared/rpc/lifecycle";
import { folderOf, nameOf, relativeVaultPath } from "../../shared/vault-path";
import type { SearchEvaluator, SearchVerdict } from "./runner";
import type { SearchResponse } from "./protocol";
import type { SearchDocument } from "../../markdown/search/evaluate";
import { readAhead } from "./read-ahead";
export interface SearchInput {
  vault: VaultIndex;
  source: string;
  /** Evaluates the query, and finds a hit's match lines, in a worker. */
  worker: SearchEvaluator;
  token: Cancellation;
  read(uri: string): Promise<string>;
  /** Called with the accumulated match set as files are scored (may be throttled). */
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
  const origin = vault.files().find((file) => file.uri === source);
  if (!origin) {
    throw new Error("Unknown search source");
  }
  await worker.ready;
  const results: SearchResponse["results"] = [];
  let unreadable = 0;
  const emit = createPartialEmitter(input.onPartial);
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
    const prepared = token.cancelled ? undefined : await documents.next();
    const outcome = prepared
      ? await evaluateDocument(input, { origin, file, prepared }, results)
      : "cancel";
    if (outcome === "cancel") {
      emit.flush();
      throw new RpcError("Cancelled", "Search cancelled");
    }
    if (outcome === "unreadable") {
      unreadable++;
      emit.push({ results: [...results], unreadable });
    } else if (outcome === "hit") {
      emit.push({ results: [...results], unreadable });
    }
  }
  emit.flush();
  results.sort(
    (a, b) =>
      nameOf(a.path).localeCompare(nameOf(b.path)) ||
      a.path.localeCompare(b.path),
  );
  return { results, unreadable };
}

/** Never rejects: a read that fails counts as an unreadable file. */
async function prepareDocument(
  input: SearchInput,
  originPath: string,
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
  target: { origin: { path: string }; file: VaultFile; prepared: Prepared },
  results: SearchResponse["results"],
): Promise<"skip" | "hit" | "unreadable" | "cancel"> {
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
    return "unreadable";
  }
  if (!verdict.matched) {
    return "skip";
  }
  const href = relativeVaultPath(folderOf(origin.path), file.path)
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

function createPartialEmitter(onPartial?: (snapshot: SearchResponse) => void) {
  if (!onPartial) {
    return { push() {}, flush() {} };
  }
  let last = 0;
  let pending: SearchResponse | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const send = (snapshot: SearchResponse) => {
    last = Date.now();
    pending = undefined;
    onPartial(snapshot);
  };
  return {
    push(snapshot: SearchResponse) {
      const now = Date.now();
      if (now - last >= PARTIAL_INTERVAL_MS) {
        if (timer) {
          clearTimeout(timer);
          timer = undefined;
        }
        send(snapshot);
        return;
      }
      pending = snapshot;
      if (!timer) {
        timer = setTimeout(
          () => {
            timer = undefined;
            if (pending) {
              send(pending);
            }
          },
          PARTIAL_INTERVAL_MS - (now - last),
        );
      }
    },
    flush() {
      if (timer) {
        clearTimeout(timer);
        timer = undefined;
      }
      if (pending) {
        send(pending);
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

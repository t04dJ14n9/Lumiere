import { frontmatter } from "../../markdown/properties";
import {
  buildMarkdownEnvelope,
  parseBridgeEnvelope,
  type BridgeEnvelope,
} from "../../shared/bridge/envelope";
import {
  durableMarkdownLocator,
  noteIdentity,
} from "../../shared/bridge/identity";
import { markdownHandoffText } from "../../shared/bridge/text";
import type { SourceSelection } from "../editor/api";
import type { MarkdownHandoff } from "./api";

export interface CaptureInput {
  readonly uri: string;
  readonly viewId: string;
  readonly selection: SourceSelection;
  readonly documentText: string;
  readonly roots: readonly string[];
  readonly capturedAt: string;
  readonly fingerprint: (text: string) => string;
}

const PUBLICATION_KEYS = [
  "published",
  "date",
  "captured",
  "last_modified",
] as const;

/**
 * When the source itself was published or captured, from frontmatter. This
 * is not the selection's capture time.
 */
function publicationTime(
  values: Record<string, unknown> | undefined,
): string | undefined {
  for (const key of PUBLICATION_KEYS) {
    const value = values?.[key];
    if (typeof value === "string" && value.trim() !== "") {
      return value.trim();
    }
  }
  return undefined;
}

/** Builds the envelope for one captured selection. Throws on a bad hash. */
export function handoffFromSelection(input: CaptureInput): MarkdownHandoff {
  const identity = noteIdentity(input.uri, input.roots);
  const saved = !input.selection.isDirty && identity.kind !== "untitled";
  const durable =
    identity.kind === "untitled"
      ? undefined
      : durableMarkdownLocator(
          identity,
          input.uri,
          input.selection.startLine,
          input.selection.endLine,
        );
  const values = frontmatter(input.documentText)?.values;
  const publishedAt = publicationTime(values);
  const title = stringTitle(values?.title);
  const sourceSha256 = saved
    ? (input.selection.sourceSha256 ?? input.fingerprint(input.documentText))
    : undefined;
  const envelope = buildMarkdownEnvelope({
    identity: identity.identity,
    kind: identity.kind,
    capturedAt: input.capturedAt,
    ...(publishedAt ? { publishedAt } : {}),
    ...(title ? { title } : {}),
    ...(durable ? { durable } : {}),
    startLine: input.selection.startLine,
    endLine: input.selection.endLine,
    viewId: input.viewId,
    text: input.selection.text,
    selectionSha256: input.fingerprint(input.selection.text),
    documentVersion: input.selection.version,
    ...(sourceSha256 ? { sourceSha256 } : {}),
    isDirty: input.selection.isDirty || identity.kind === "untitled",
  });
  return {
    envelope,
    ...(saved && durable
      ? { text: markdownHandoffText(durable, input.selection.text) }
      : {}),
  };
}

export function envelopeFromPdf(value: unknown): BridgeEnvelope | undefined {
  const parsed = parseBridgeEnvelope(value);
  if (!parsed.ok || parsed.envelope.producer !== "pdf") {
    return undefined;
  }
  return parsed.envelope;
}

function stringTitle(value: unknown): string | undefined {
  if (typeof value !== "string" || value.trim() === "") {
    return undefined;
  }
  return value.trim();
}

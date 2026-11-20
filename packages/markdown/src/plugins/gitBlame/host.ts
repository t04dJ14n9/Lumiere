import type { Context, Plugin, Infer } from "@workshop/core";
import type { PanelShell } from "../../shared/host";
import type { GitAccess } from "../../shared/git";
import type { GitBlameLineResult, GitBlameOk } from "../../shared/git-blame";
import { MAX_DIFF_CHARS } from "../../shared/diff";
import { blameTextLimits, protocol } from "./protocol";

type BlameRequest = Infer<typeof protocol.requests.blameLine.params>;

/** Defense in depth for callers other than the schema-validated RPC channel. */
export async function readBlameLine(
  git: GitAccess,
  uri: string,
  request: BlameRequest,
): Promise<GitBlameLineResult> {
  const generation = () => git.repoGeneration(uri);
  if (request.contents.length > MAX_DIFF_CHARS) {
    return { status: "unavailable", repoGeneration: generation() };
  }
  try {
    const result = await git.blameLine(uri, request.line, {
      contents: request.contents,
      version: request.version,
    });
    return result.status === "ok"
      ? { ...result, blame: fitBlameText(result.blame) }
      : result;
  } catch {
    return { status: "unavailable", repoGeneration: generation() };
  }
}

/**
 * The blame with its text fields within the protocol's limits. A commit
 * subject over 500 characters (or a longer author name) would otherwise fail
 * the result's schema, and the line would show no blame at all.
 */
function fitBlameText(blame: GitBlameOk): GitBlameOk {
  const limits = blameTextLimits;
  return {
    ...blame,
    authorName: clip(blame.authorName, limits.authorName),
    authorEmail: clip(blame.authorEmail, limits.authorEmail),
    subject: clip(blame.subject, limits.subject),
    ...(blame.body === undefined
      ? {}
      : { body: clip(blame.body, limits.body) }),
  };
}

function clip(text: string, limit: number): string {
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

export const gitBlameHost: Plugin<{ panel: PanelShell }> = {
  name: "gitBlame",
  inject: { required: ["git", "rpc"] },
  apply(ctx, { panel }) {
    registerBlameRequests(ctx, panel);
    registerIdentityRequest(ctx, panel);
    registerRepositoryInvalidation(ctx, panel);
  },
};

function registerBlameRequests(ctx: Context, panel: PanelShell): void {
  ctx.effect(() =>
    ctx.rpc.handle(protocol, "blameLine", (request) =>
      readBlameLine(ctx.git, panel.document.uri, request),
    ),
  );
}

function registerIdentityRequest(ctx: Context, panel: PanelShell): void {
  ctx.effect(() =>
    ctx.rpc.handle(protocol, "identity", async () => {
      return ctx.git.identity(panel.document.uri).catch(() => undefined);
    }),
  );
}

function registerRepositoryInvalidation(ctx: Context, panel: PanelShell): void {
  const { git, rpc } = ctx;
  ctx.effect(() =>
    git.onDidChange(() => {
      // NativeGitAccess already advanced once before fan-out. Invalidation must
      // reach the webview now; only its subsequent refresh may be debounced.
      void Promise.resolve(
        rpc.notify(protocol, "changed", {
          repoGeneration: git.repoGeneration(panel.document.uri),
        }),
      ).catch(() => undefined);
    }),
  );
}

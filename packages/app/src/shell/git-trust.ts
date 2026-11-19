/**
 * The vault git waits for the reader to trust, from the window's backend
 * (`WindowBackend.gitTrust`): read at start and again on each `git-trust`
 * event, and answered from GitTrustPrompt. A backend with no git asks
 * nothing.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ServerEvent } from "./api";
import { backend } from "./backend";

export interface GitTrustQuestion {
  /** The vault to ask about first; undefined when nothing waits. */
  readonly asking: string | undefined;
  answer(allow: boolean): void;
  onServerEvent(event: ServerEvent): void;
}

export function useGitTrust(
  report: (work: Promise<unknown>) => void,
): GitTrustQuestion {
  const [waiting, setWaiting] = useState<readonly string[]>([]);
  const refresh = useCallback(() => {
    const trust = backend().gitTrust;
    if (trust) {
      report(trust.waiting().then(setWaiting));
    }
  }, [report]);
  useEffect(refresh, [refresh]);
  const asking = waiting[0];
  const answer = useCallback(
    (allow: boolean) => {
      const trust = backend().gitTrust;
      if (trust && asking !== undefined) {
        setWaiting((shown) => shown.filter((vault) => vault !== asking));
        report(trust.answer(asking, allow).finally(refresh));
      }
    },
    [asking, refresh, report],
  );
  const onServerEvent = useCallback(
    (event: ServerEvent) => {
      if (event.type === "git-trust") {
        refresh();
      }
    },
    [refresh],
  );
  return useMemo(
    () => ({ asking, answer, onServerEvent }),
    [asking, answer, onServerEvent],
  );
}

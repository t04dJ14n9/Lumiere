import { useEffect } from "react";
import { t } from "@workshop/l10n";

/** A worker that has not answered for the PDF within this time is given up. */
export const WORKER_TIMEOUT_MS = 15_000;

/**
 * Whether a document that did not open failed for the engine's own reason.
 * A worker that failed to boot rejects every document with
 * `operation-failed`; any other code (`invalid-input` for a damaged file, a
 * refused password) is about the file, and a main-thread engine would say
 * the same after starting PDFium a second time for nothing.
 */
export function isEngineFailure(code: string): boolean {
  return code === "operation-failed";
}

/**
 * A worker engine that fails, or never answers, gives way to one on the main
 * thread; a failing main-thread engine is reported. `answered` is true once
 * the engine has opened the PDF or said why it cannot (it is locked, or
 * damaged): the worker works, and the timeout no longer applies.
 */
export function useEngineFailure({
  error,
  worker,
  answered,
  onWorkerFailure,
  report,
}: {
  error: unknown;
  worker: boolean;
  answered: boolean;
  onWorkerFailure: () => void;
  report: (message: string) => void;
}): void {
  useEffect(() => {
    if (error) {
      reportEngineFailure(error, { worker, onWorkerFailure, report });
    }
  }, [error, onWorkerFailure, report, worker]);

  // Treat a worker that never answers like one that failed.
  useEffect(() => {
    if (!worker || answered) {
      return;
    }
    const timer = setTimeout(onWorkerFailure, WORKER_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [onWorkerFailure, answered, worker]);
}

export function reportEngineFailure(
  error: unknown,
  {
    worker,
    onWorkerFailure,
    report,
  }: {
    worker: boolean;
    onWorkerFailure: () => void;
    report: (message: string) => void;
  },
): void {
  if (worker) {
    console.warn(
      "The PDF engine could not start in a worker; using the main thread.",
      error,
    );
    onWorkerFailure();
  } else {
    report(t("The PDF engine failed: {0}", String(error)));
  }
}

/**
 * Ask the viewer for its selection (`ask`) and wait, at most `timeoutMs`, for
 * the next report (`onReport` fires on every one). Resolves whether one came:
 * a selection whose text cannot be read (a PDF that forbids copying) sends
 * none.
 */
export function awaitSelectionReport(
  onReport: (listener: () => void) => { dispose(): void },
  ask: () => void,
  timeoutMs: number,
): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const done = (reported: boolean): void => {
      clearTimeout(timer);
      subscription.dispose();
      resolve(reported);
    };
    const subscription = onReport(() => done(true));
    const timer = setTimeout(() => done(false), timeoutMs);
    ask();
  });
}

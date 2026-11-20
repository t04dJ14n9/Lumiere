/**
 * Asks whether git may run in a vault (server/git-trust.ts), the first time
 * blame or the change gutter want it there. Until the reader allows it, the
 * Git features are off in that vault.
 */
export interface GitTrustPromptProps {
  /** The vault git waits for; nothing shows without one. */
  readonly vault: string | undefined;
  readonly onAnswer: (allow: boolean) => void;
}

export function GitTrustPrompt({ vault, onAnswer }: GitTrustPromptProps) {
  if (vault === undefined) {
    return null;
  }
  return (
    <div className="git-trust-prompt" role="alertdialog" aria-live="polite">
      <span>
        Allow Git in {vault}? Git runs the repository&apos;s own settings, which
        can start programs. Allow it only for a folder you trust.
      </span>
      <button type="button" onClick={() => onAnswer(true)}>
        Allow
      </button>
      <button type="button" onClick={() => onAnswer(false)}>
        Not Now
      </button>
    </div>
  );
}

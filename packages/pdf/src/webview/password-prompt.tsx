import type { LockedDocumentInfo } from "@embedpdf/core";
import { useDocuments } from "@embedpdf/react/runtime";
import React, { useState } from "react";
import { t } from "@workshop/l10n";

/**
 * A password-protected PDF: ask for its password and open it with it. The
 * password goes to the engine only; it is never sent to the extension or
 * kept, so the next open of the file asks again.
 */
export function PasswordPrompt({
  document,
}: {
  document: LockedDocumentInfo;
}): React.JSX.Element {
  const documents = useDocuments();
  const [password, setPassword] = useState("");
  const [trying, setTrying] = useState(false);
  const [wrong, setWrong] = useState(document.passwordProvided);
  const submit = (event: React.FormEvent): void => {
    event.preventDefault();
    setTrying(true);
    documents.unlock(document.id, { password }).then(
      () => undefined,
      () => {
        // Still locked: ask again.
        setTrying(false);
        setWrong(true);
        setPassword("");
      },
    );
  };
  return (
    <form className="status password" onSubmit={submit}>
      <div className="password-box">
        <label htmlFor="pdf-password">
          {wrong
            ? t("That password is not right. Enter the PDF's password:")
            : t("This PDF is password-protected. Enter its password:")}
        </label>
        <input
          id="pdf-password"
          type="password"
          autoFocus
          autoComplete="off"
          value={password}
          disabled={trying}
          onChange={(event) => setPassword(event.target.value)}
        />
        <button type="submit" disabled={trying || password === ""}>
          {t("Open")}
        </button>
      </div>
    </form>
  );
}

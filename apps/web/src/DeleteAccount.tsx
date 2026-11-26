import { useState } from "react";
import type { User } from "firebase/auth";
import { api } from "./api";
import { reauthenticateGoogle, signInErrorMessage } from "./firebase";
import { translate, type MessageKey } from "./i18n";
import { Button, Dialog } from "./ui";

export function DeleteAccount({
  user,
  onRequested,
}: {
  user: User;
  onRequested: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<MessageKey>();

  async function confirm() {
    setBusy(true);
    setError(undefined);
    try {
      try {
        await reauthenticateGoogle(user);
      } catch (failure) {
        setError(signInErrorMessage(failure));
        return;
      }
      try {
        await api("/account/delete", "POST", { confirm: true }, { user });
      } catch {
        setError("deleteAccountError");
        return;
      }
      onRequested();
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button
        className="destructive-action"
        onClick={() => {
          setError(undefined);
          setOpen(true);
        }}
      >
        {translate("deleteAccount")}
      </Button>
      {open && (
        <Dialog
          title={translate("deleteAccount")}
          description={translate("deleteAccountDetails")}
          onClose={() => {
            if (!busy) setOpen(false);
          }}
        >
          <p>{translate("deleteAccountExternal")}</p>
          {error && <p role="alert">{translate(error)}</p>}
          <Button disabled={busy} onClick={confirm}>
            {translate(busy ? "deleteAccountWorking" : "deleteAccountConfirm")}
          </Button>
        </Dialog>
      )}
    </>
  );
}

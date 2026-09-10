import { useEffect, useId, useRef, type ReactNode } from 'react';
import { CircleAlert } from 'lucide-react';

export function ConfirmDialog({
  title,
  children,
  note,
  confirmLabel,
  pendingLabel,
  busy,
  error,
  onCancel,
  onConfirm,
}: {
  title: string;
  children: ReactNode;
  note: string;
  confirmLabel: string;
  pendingLabel: string;
  busy: boolean;
  error: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const id = useId();
  useEffect(() => {
    const dialog = dialogRef.current!;
    const trigger = document.activeElement;
    const overflow = document.body.style.overflow;
    dialog.showModal();
    cancelRef.current?.focus();
    document.body.style.overflow = 'hidden';
    return () => {
      dialog.close();
      document.body.style.overflow = overflow;
      if (trigger instanceof HTMLElement && trigger.isConnected) trigger.focus();
    };
  }, []);
  return (
    <dialog
      ref={dialogRef}
      className="confirm-dialog"
      aria-labelledby={`${id}-title`}
      aria-describedby={`${id}-description ${id}-note`}
      aria-busy={busy}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onCancel();
      }}
    >
      <div className="confirm-dialog-icon" aria-hidden="true">
        <CircleAlert size={24} strokeWidth={1.5} />
      </div>
      <h2 id={`${id}-title`}>{title}</h2>
      <div id={`${id}-description`} className="confirm-dialog-description">
        {children}
      </div>
      <p id={`${id}-note`} className="confirm-dialog-note">
        {note}
      </p>
      {error && (
        <p className="confirm-dialog-error" role="alert">
          {error}
        </p>
      )}
      <div className="confirm-dialog-actions">
        <button ref={cancelRef} className="secondary" disabled={busy} onClick={onCancel}>
          キャンセル
        </button>
        <button className="confirm-dialog-submit" disabled={busy} onClick={onConfirm}>
          {busy ? pendingLabel : confirmLabel}
        </button>
      </div>
    </dialog>
  );
}

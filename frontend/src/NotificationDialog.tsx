import { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';

export function NotificationDialog({ message, onClose }: { message: string; onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const messageId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    dialog.showModal();
    return () => {
      if (dialog.open) dialog.close();
    };
  }, []);

  return createPortal(
    <dialog
      ref={dialogRef}
      className="notification-dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={messageId}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <header>
        <h2 id={titleId}>Notification</h2>
        <button
          type="button"
          className="notification-close"
          aria-label="Close notification"
          onClick={onClose}
        >
          ×
        </button>
      </header>
      <p id={messageId}>{message}</p>
      <footer>
        <button type="button" className="notification-ok" autoFocus onClick={onClose}>
          OK
        </button>
      </footer>
    </dialog>,
    document.body,
  );
}

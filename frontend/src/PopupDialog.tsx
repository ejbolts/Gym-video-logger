import { useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export function PopupDialog({
  title,
  kicker,
  className = '',
  onClose,
  children,
}: {
  title: string;
  kicker?: string;
  className?: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (!dialog.open) dialog.showModal();
    return () => {
      if (dialog.open) dialog.close();
    };
  }, []);

  return createPortal(
    <dialog
      ref={dialogRef}
      className={`popup-dialog ${className}`.trim()}
      aria-modal="true"
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <header>
        <div>
          {kicker && <p className="section-kicker">{kicker}</p>}
          <h2 id={titleId}>{title}</h2>
        </div>
        <button
          type="button"
          className="popup-dialog-close"
          aria-label={`Close ${title}`}
          onClick={onClose}
        >
          ×
        </button>
      </header>
      {children}
    </dialog>,
    document.body,
  );
}

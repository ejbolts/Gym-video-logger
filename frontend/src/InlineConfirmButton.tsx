import { useState } from 'react';

export function InlineConfirmButton({
  label,
  confirmLabel = 'Confirm delete',
  workingLabel = 'Deleting…',
  className,
  disabled = false,
  onConfirm,
}: {
  label: string;
  confirmLabel?: string;
  workingLabel?: string;
  className?: string;
  disabled?: boolean;
  onConfirm: () => void | Promise<void>;
}) {
  const [confirming, setConfirming] = useState(false);
  const [working, setWorking] = useState(false);

  if (!confirming) {
    return (
      <button
        type="button"
        className={className}
        disabled={disabled}
        onClick={() => setConfirming(true)}
      >
        {label}
      </button>
    );
  }

  return (
    <span className="inline-confirmation" role="group" aria-label={`${label} confirmation`}>
      <button
        type="button"
        className={className}
        disabled={disabled || working}
        onClick={() => {
          setWorking(true);
          void Promise.resolve()
            .then(onConfirm)
            .catch(() => undefined)
            .finally(() => {
              setWorking(false);
              setConfirming(false);
            });
        }}
      >
        {working ? workingLabel : confirmLabel}
      </button>
      <button type="button" disabled={working} onClick={() => setConfirming(false)}>
        Cancel
      </button>
    </span>
  );
}

import type { SetType } from './types';

export function SetLevelLabel({ setType, warmup }: { setType?: SetType; warmup?: boolean }) {
  const resolvedType = warmup ? 'warmup' : (setType ?? 'normal');

  if (resolvedType === 'warmup') {
    return (
      <span className="set-level-label set-level-warmup" aria-label="Warm-up set">
        warmup
      </span>
    );
  }

  if (resolvedType === 'drop') {
    return (
      <span className="set-level-label set-level-drop" aria-label="Drop set">
        drop set
      </span>
    );
  }

  return (
    <span className="set-level-label set-level-working" aria-label="Working set">
      working
    </span>
  );
}

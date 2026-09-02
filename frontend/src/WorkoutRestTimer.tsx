import { formatSeconds } from './utils';

export function WorkoutHeaderMeta({
  durationLabel,
  restSeconds,
  onSkipRest,
}: {
  durationLabel: string;
  restSeconds: number | null;
  onSkipRest: () => void;
}) {
  return (
    <span className="workout-header-meta">
      <span className="workout-header-duration">{durationLabel}</span>
      {restSeconds !== null && restSeconds > 0 && (
        <>
          <span className="workout-header-separator" aria-hidden="true">
            •
          </span>
          <WorkoutRestTimer seconds={restSeconds} onSkip={onSkipRest} />
        </>
      )}
    </span>
  );
}

export function WorkoutRestTimer({ seconds, onSkip }: { seconds: number; onSkip: () => void }) {
  const formattedTime = formatSeconds(seconds);

  return (
    <span className="workout-rest-timer" role="timer" aria-label={`Rest timer ${formattedTime}`}>
      <strong>{formattedTime}</strong>
      <button type="button" aria-label="Skip rest timer" onClick={onSkip}>
        ×
      </button>
    </span>
  );
}

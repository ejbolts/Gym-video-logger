import { useState } from 'react';
import type { CardioMetricsInput, CardioSession } from './types';
import { PopupDialog } from './PopupDialog';

function optionalNumber(value: string): number | null {
  return value.trim() === '' ? null : Number(value);
}

export function CardioMetricsEditor({
  session,
  onClose,
  onSave,
}: {
  session: CardioSession;
  onClose: () => void;
  onSave: (metrics: CardioMetricsInput) => Promise<void>;
}) {
  const [calories, setCalories] = useState(session.calories_kcal?.toString() ?? '');
  const [heartRate, setHeartRate] = useState(session.average_heart_rate_bpm?.toString() ?? '');
  const [distance, setDistance] = useState(session.distance_km?.toString() ?? '');
  const [speed, setSpeed] = useState(session.average_speed_kph?.toString() ?? '');
  const [incline, setIncline] = useState(session.incline_percent?.toString() ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <PopupDialog title="Cardio metrics" kicker="PERFORMANCE" onClose={onClose}>
      <form
        className="cardio-metrics-dialog"
        onSubmit={async (event) => {
          event.preventDefault();
          setSaving(true);
          setError(null);
          try {
            await onSave({
              calories_kcal: optionalNumber(calories),
              average_heart_rate_bpm: optionalNumber(heartRate),
              distance_km: optionalNumber(distance),
              average_speed_kph: optionalNumber(speed),
              incline_percent: optionalNumber(incline),
            });
            onClose();
          } catch (reason) {
            setError(reason instanceof Error ? reason.message : 'Could not save cardio metrics.');
          } finally {
            setSaving(false);
          }
        }}
      >
        <p>
          {session.activity_type} · {session.session_date} · {session.duration_minutes} min
        </p>
        <div className="cardio-metric-fields">
          <label>
            Calories (kcal)
            <input
              type="number"
              inputMode="numeric"
              min="0"
              max="100000"
              step="1"
              value={calories}
              onChange={(event) => setCalories(event.target.value)}
            />
          </label>
          <label>
            Average HR (bpm)
            <input
              type="number"
              inputMode="numeric"
              min="20"
              max="250"
              step="1"
              value={heartRate}
              onChange={(event) => setHeartRate(event.target.value)}
            />
          </label>
          <label>
            Distance (km)
            <input
              type="number"
              inputMode="decimal"
              min="0"
              max="10000"
              step="0.01"
              value={distance}
              onChange={(event) => setDistance(event.target.value)}
            />
          </label>
          <label>
            Average speed (km/h)
            <input
              type="number"
              inputMode="decimal"
              min="0"
              max="100"
              step="0.1"
              value={speed}
              onChange={(event) => setSpeed(event.target.value)}
            />
          </label>
          <label>
            Incline (%)
            <input
              type="number"
              inputMode="decimal"
              min="0"
              max="100"
              step="0.1"
              value={incline}
              onChange={(event) => setIncline(event.target.value)}
            />
          </label>
        </div>
        <p className="cardio-metric-hint">All performance fields are optional.</p>
        {error && <p className="inline-error">{error}</p>}
        <footer className="popup-dialog-actions">
          <button type="button" disabled={saving} onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="popup-primary-action" disabled={saving}>
            {saving ? 'Saving…' : 'Save metrics'}
          </button>
        </footer>
      </form>
    </PopupDialog>
  );
}

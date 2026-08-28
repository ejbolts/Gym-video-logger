import { useEffect, useId, useRef, useState } from 'react';
import type { CSSProperties, FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { prepareExerciseInput, type ExerciseCreationDraft } from './exerciseCreation';
import type { Exercise, ExerciseCreateInput, ExerciseKind, WorkoutCategory } from './types';

export function CreateExerciseDialog({
  exercises,
  categoryLabels,
  initialName,
  initialCategory,
  viewportHeight,
  viewportTop,
  onCreate,
  onCreated,
  onClose,
}: {
  exercises: Exercise[];
  categoryLabels: Record<WorkoutCategory, string>;
  initialName: string;
  initialCategory: WorkoutCategory | '';
  viewportHeight: number;
  viewportTop: number;
  onCreate: (input: ExerciseCreateInput) => Promise<Exercise>;
  onCreated: (exercise: Exercise) => void;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const savingRef = useRef(false);
  const titleId = useId();
  const groupsId = useId();
  const [draft, setDraft] = useState<ExerciseCreationDraft>(() => ({
    name: initialName.slice(0, 160),
    category: initialCategory,
    kind: initialCategory === 'cardio' ? 'cardio' : 'strength',
    muscle_group: '',
    equipment: '',
  }));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const muscleGroups = [...new Set(exercises.map((exercise) => exercise.muscle_group))].sort();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    dialog.showModal();
    return () => {
      if (dialog.open) dialog.close();
    };
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (savingRef.current) return;
    setError(null);
    try {
      const input = prepareExerciseInput(draft, exercises);
      savingRef.current = true;
      setSaving(true);
      const exercise = await onCreate(input);
      onCreated(exercise);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not create the exercise.');
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  return createPortal(
    <dialog
      ref={dialogRef}
      className="notification-dialog create-exercise-dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      style={
        {
          '--create-exercise-viewport-height': `${viewportHeight}px`,
          '--create-exercise-viewport-top': `${viewportTop}px`,
        } as CSSProperties
      }
      onKeyDown={(event) => {
        // Escape should close this prompt, not the exercise picker beneath it.
        if (event.key === 'Escape') event.stopPropagation();
      }}
      onCancel={(event) => {
        event.preventDefault();
        if (!savingRef.current) onClose();
      }}
    >
      <header>
        <h2 id={titleId}>Add exercise</h2>
        <button
          type="button"
          className="notification-close"
          aria-label="Close add exercise"
          disabled={saving}
          onClick={onClose}
        >
          ×
        </button>
      </header>
      <p>Create an exercise in your library, then add it to your workout.</p>
      <form onSubmit={(event) => void submit(event)} aria-busy={saving}>
        <fieldset disabled={saving}>
          <legend className="sr-only">Exercise details</legend>
          <label className="create-exercise-name">
            Name
            <input
              autoFocus
              required
              maxLength={160}
              value={draft.name}
              onChange={(event) =>
                setDraft((current) => ({ ...current, name: event.target.value }))
              }
              placeholder="Exercise name"
            />
          </label>
          <label>
            Category
            <select
              required
              value={draft.category}
              onChange={(event) => {
                const category = event.target.value as WorkoutCategory | '';
                setDraft((current) => ({
                  ...current,
                  category,
                  kind: category === 'cardio' ? 'cardio' : 'strength',
                }));
              }}
            >
              <option value="">Choose category</option>
              {Object.entries(categoryLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Type
            <select
              value={draft.kind}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  kind: event.target.value as ExerciseKind,
                }))
              }
            >
              <option value="strength">Strength</option>
              <option value="cardio">Cardio</option>
            </select>
          </label>
          <label>
            Muscle group
            <input
              required
              maxLength={100}
              list={groupsId}
              value={draft.muscle_group}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  muscle_group: event.target.value,
                }))
              }
              placeholder="e.g. Lats"
            />
          </label>
          <label>
            Equipment (optional)
            <input
              maxLength={100}
              value={draft.equipment}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  equipment: event.target.value,
                }))
              }
              placeholder="e.g. Cable"
            />
          </label>
        </fieldset>
        <datalist id={groupsId}>
          {muscleGroups.map((group) => (
            <option value={group} key={group} />
          ))}
        </datalist>
        {error && (
          <p className="inline-error" role="alert">
            {error}
          </p>
        )}
        <footer>
          <button
            type="button"
            className="create-exercise-cancel"
            disabled={saving}
            onClick={onClose}
          >
            Cancel
          </button>
          <button type="submit" className="notification-ok" disabled={saving}>
            {saving ? 'Adding…' : 'Add exercise'}
          </button>
        </footer>
      </form>
    </dialog>,
    document.body,
  );
}

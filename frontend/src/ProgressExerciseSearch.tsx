import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { progressExerciseMatches } from './exerciseSearch';
import type { Exercise } from './types';

export function ProgressExerciseSearch({
  exercises,
  exerciseId,
  onChange,
}: {
  exercises: Exercise[];
  exerciseId: string;
  onChange: (exerciseId: string) => void;
}) {
  const selected = exercises.find((exercise) => exercise.id === exerciseId) ?? null;
  const inputId = useId();
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState(selected?.name ?? '');
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const matches = useMemo(() => progressExerciseMatches(exercises, query), [exercises, query]);

  useEffect(() => {
    setQuery(selected?.name ?? '');
  }, [selected?.id, selected?.name]);

  function choose(exercise: Exercise) {
    onChange(exercise.id);
    setQuery(exercise.name);
    setOpen(false);
    setActiveIndex(0);
  }

  return (
    <div
      className="progress-exercise-field"
      onBlur={(event) => {
        if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) {
          return;
        }
        setOpen(false);
        setQuery(selected?.name ?? '');
      }}
    >
      <label htmlFor={inputId}>Exercise</label>
      <div className="progress-exercise-combobox">
        <input
          ref={inputRef}
          id={inputId}
          type="search"
          role="combobox"
          autoComplete="off"
          aria-autocomplete="list"
          aria-controls={listId}
          aria-expanded={open}
          aria-activedescendant={
            open && matches[activeIndex] ? `${listId}-${activeIndex}` : undefined
          }
          value={query}
          placeholder="Search exercises…"
          onFocus={(event) => {
            setOpen(true);
            event.currentTarget.select();
          }}
          onChange={(event) => {
            setQuery(event.target.value);
            setActiveIndex(0);
            setOpen(true);
          }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') {
              event.preventDefault();
              setOpen(true);
              setActiveIndex((index) =>
                matches.length ? Math.min(index + 1, matches.length - 1) : 0,
              );
            } else if (event.key === 'ArrowUp') {
              event.preventDefault();
              setOpen(true);
              setActiveIndex((index) => Math.max(index - 1, 0));
            } else if (event.key === 'Enter' && open && matches[activeIndex]) {
              event.preventDefault();
              choose(matches[activeIndex]);
            } else if (event.key === 'Escape') {
              event.preventDefault();
              setOpen(false);
              setQuery(selected?.name ?? '');
            }
          }}
        />
        <button
          type="button"
          aria-label={open ? 'Close exercise search' : 'Browse exercises'}
          aria-expanded={open}
          onPointerDown={(event) => event.preventDefault()}
          onClick={() => {
            if (open) {
              setOpen(false);
              setQuery(selected?.name ?? '');
            } else {
              setQuery('');
              setActiveIndex(0);
              setOpen(true);
              inputRef.current?.focus();
            }
          }}
        >
          {open ? '×' : '⌄'}
        </button>
      </div>
      {open && (
        <div className="progress-exercise-results" id={listId} role="listbox">
          {matches.map((exercise, index) => (
            <button
              type="button"
              id={`${listId}-${index}`}
              role="option"
              aria-selected={exercise.id === exerciseId}
              className={index === activeIndex ? 'active' : ''}
              key={exercise.id}
              onPointerDown={(event) => event.preventDefault()}
              onPointerMove={() => setActiveIndex(index)}
              onClick={() => choose(exercise)}
            >
              <strong>{exercise.name}</strong>
              <small>
                {exercise.muscle_group}
                {exercise.equipment ? ` · ${exercise.equipment}` : ''}
              </small>
            </button>
          ))}
          {!matches.length && <p role="status">No exercises match “{query.trim()}”.</p>}
        </div>
      )}
    </div>
  );
}

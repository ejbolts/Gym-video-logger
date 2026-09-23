import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { progressExerciseMatches } from './exerciseSearch';
import type { Exercise } from './types';

export function ProgressExerciseSearch({
  exercises,
  exerciseId,
  onChange,
  openRequest = 0,
}: {
  exercises: Exercise[];
  exerciseId: string;
  onChange: (exerciseId: string) => void;
  openRequest?: number;
}) {
  const selected = exercises.find((exercise) => exercise.id === exerciseId) ?? null;
  const inputId = useId();
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const handledOpenRequestRef = useRef(openRequest);
  const blurFrameRef = useRef<number | null>(null);
  const [query, setQuery] = useState(selected?.name ?? '');
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const matches = useMemo(() => progressExerciseMatches(exercises, query), [exercises, query]);

  useEffect(() => {
    setQuery(selected?.name ?? '');
  }, [selected?.id, selected?.name]);

  useEffect(
    () => () => {
      if (blurFrameRef.current !== null) {
        window.cancelAnimationFrame(blurFrameRef.current);
      }
    },
    [],
  );

  useEffect(() => {
    if (openRequest === handledOpenRequestRef.current) return;
    handledOpenRequestRef.current = openRequest;
    setQuery('');
    setActiveIndex(0);
    setOpen(true);
    const frame = window.requestAnimationFrame(() => {
      inputRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      inputRef.current?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [openRequest]);

  function choose(exercise: Exercise) {
    if (blurFrameRef.current !== null) {
      window.cancelAnimationFrame(blurFrameRef.current);
      blurFrameRef.current = null;
    }
    onChange(exercise.id);
    setQuery(exercise.name);
    setOpen(false);
    setActiveIndex(0);
    // Let the browser finish the activating gesture before dismissing the
    // keyboard. In particular, iOS can otherwise swallow the option's click.
    window.requestAnimationFrame(() => inputRef.current?.blur());
  }

  return (
    <div
      className="progress-exercise-field"
      onBlur={(event) => {
        if (
          event.relatedTarget instanceof Node &&
          event.currentTarget.contains(event.relatedTarget)
        ) {
          return;
        }
        if (blurFrameRef.current !== null) {
          window.cancelAnimationFrame(blurFrameRef.current);
        }
        // iOS often reports no relatedTarget when the search input blurs as
        // an option is tapped. Wait until the activating click has run before
        // dismissing the results so the option can still be selected.
        blurFrameRef.current = window.requestAnimationFrame(() => {
          blurFrameRef.current = null;
          setOpen(false);
          setQuery(selected?.name ?? '');
        });
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
              onPointerMove={(event) => {
                if (event.pointerType === 'mouse') setActiveIndex(index);
              }}
              onMouseDown={(event) => event.preventDefault()}
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

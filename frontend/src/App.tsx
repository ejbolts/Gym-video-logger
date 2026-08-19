import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { api } from './api';
import type {
  BodyMeasurement,
  BodyWeightGoal,
  CardioOverview,
  CardioSessionInput,
  DashboardData,
  Exercise,
  ExerciseProgress,
  MachinePhoto,
  PersonalRecord,
  TrackedSet,
  TrackedWorkout,
  TrainingMode,
  TrainingPhase,
  WorkoutCategory,
  WorkoutInput,
  WorkoutRecommendation,
  WorkoutSetInput,
  WeeklyGoal,
} from './types';
import {
  filterMeasurementsByRange,
  nearestChartPointIndex,
  splitWeightLineByPhase,
  trainingPhaseAtDate,
} from './bodyTrend';
import type { BodyTrendRange } from './bodyTrend';
import { InlineConfirmButton } from './InlineConfirmButton';
import { recentExerciseHistory, type ExerciseHistoryEntry } from './exerciseHistory';
import { formatMinutesDuration, formatSeconds, localDate, mergeUniqueById, reorder } from './utils';
import { VideoUpload } from './VideoUpload';
import {
  clearActiveWorkoutDraft,
  readActiveWorkoutDraft,
  writeActiveWorkoutDraft,
} from './workoutDraft';
import { createWorkoutSet, isCompletedWorkingSet, latestExerciseSet } from './workoutSets';
import { inferWorkoutCategory, workoutNameForCategory } from './workoutCategory';
import {
  replaceMovementExercise,
  type WorkoutDraftMovement as DraftMovement,
  type WorkoutDraftSet as DraftSet,
} from './workoutMovements';
import { applySupersetSelection, clearSuperset } from './workoutSupersets';

type AppTab = 'dashboard' | 'log' | 'body' | 'history' | 'videos';
type ProgressMetric = 'estimated_1rm' | 'best_weight_kg' | 'volume_kg';
type DashboardMetric = 'workouts' | 'sets' | 'streak';

const categoryNames: Record<WorkoutCategory, string> = {
  upper: 'Upper body',
  lower: 'Lower body',
  push: 'Push',
  pull: 'Pull',
  full_body: 'Full body',
  cardio: 'Cardio',
  other: 'Other',
};

const categoryColors: Record<WorkoutCategory, string> = {
  upper: '#8b5cf6',
  lower: '#f59e0b',
  push: '#ef476f',
  pull: '#3b82f6',
  full_body: '#14b8a6',
  cardio: '#22c55e',
  other: '#94a3b8',
};

const restOptions = [60, 90, 120, 150, 180, 210, 240, 270, 300];
const HISTORY_PAGE_SIZE = 8;

function emptySet(
  kind: Exercise['kind'],
  previous?: WorkoutSetInput,
  isFirstSet = previous === undefined,
): DraftSet {
  return {
    key: crypto.randomUUID(),
    ...createWorkoutSet(kind, previous, isFirstSet),
  };
}

function numberOrNull(value: string): number | null {
  return value === '' ? null : Number(value);
}

function completedSetPerformance(item: DraftSet, cardio: boolean): string {
  if (cardio) {
    const values = [
      item.duration_seconds !== null ? formatDuration(item.duration_seconds) : null,
      item.distance_km !== null ? `${item.distance_km} km` : null,
      item.incline_percent != null ? `${item.incline_percent}% incline` : null,
      item.speed_kph != null ? `${item.speed_kph} km/h` : null,
    ].filter((value): value is string => value !== null);
    return values.join(' · ') || 'No result entered';
  }

  const values = [
    item.weight_kg !== null ? `${item.weight_kg} kg` : null,
    item.reps !== null ? `${item.reps} reps` : null,
  ].filter((value): value is string => value !== null);
  return values.join(' × ') || 'No result entered';
}

function strengthLevelPercent(item: DraftSet): number | null {
  if (item.warmup || item.set_type === 'warmup' || !item.reps || item.reps <= 0) return null;
  return Math.min(100, Math.max(1, Math.round(100 / (1 + item.reps / 30))));
}

function StrengthLevelStars({ item }: { item: DraftSet }) {
  const percent = strengthLevelPercent(item);
  const filled = percent === null ? 0 : percent >= 90 ? 5 : percent >= 80 ? 4 : percent >= 70 ? 3 : 2;
  return (
    <span className="strength-level-stars" aria-label={percent === null ? 'Warmup' : `${filled} out of 5 level`}>
      {[0, 1, 2, 3, 4].map((star) => (
        <i className={star < filled ? 'filled' : ''} key={star} aria-hidden="true">
          ★
        </i>
      ))}
    </span>
  );
}

function moveItem<T>(items: T[], from: number, to: number): T[] {
  return reorder(items, from, to);
}

function calculateDraftPrs(
  movements: DraftMovement[],
  records: PersonalRecord[],
  historicalWorkouts: TrackedWorkout[],
  excludedWorkoutId: string | null,
): Map<string, Map<string, string[]>> {
  type State = {
    weight: number;
    e1rm: number;
    duration: number;
    distance: number;
    reps: Map<number, number>;
    unit: 'kg' | 'lb';
  };
  const states = new Map<string, State>();
  for (const record of records.filter((item) => item.workout_id !== excludedWorkoutId)) {
    const state = states.get(record.exercise_id) ?? {
      weight: -1,
      e1rm: -1,
      duration: -1,
      distance: -1,
      reps: new Map(),
      unit: record.unit === 'lb' ? 'lb' : 'kg',
    };
    if (record.record_type === 'weight') state.weight = Math.max(state.weight, record.value);
    if (record.record_type === 'estimated_1rm') state.e1rm = Math.max(state.e1rm, record.value);
    if (record.record_type === 'duration') state.duration = Math.max(state.duration, record.value);
    if (record.record_type === 'distance') state.distance = Math.max(state.distance, record.value);
    if (record.record_type === 'reps_at_weight' && record.normalized_weight !== null)
      state.reps.set(
        record.normalized_weight,
        Math.max(state.reps.get(record.normalized_weight) ?? -1, record.value),
      );
    states.set(record.exercise_id, state);
  }
  for (const workout of historicalWorkouts.filter((item) => item.id !== excludedWorkoutId)) {
    for (const movement of workout.movements) {
      const state = states.get(movement.exercise.id) ?? {
        weight: -1,
        e1rm: -1,
        duration: -1,
        distance: -1,
        reps: new Map(),
        unit: 'kg' as const,
      };
      for (const item of movement.sets) {
        if (!item.completed || item.set_type === 'warmup' || item.warmup) continue;
        if (item.failed && (item.target_reps === null || (item.reps ?? 0) < item.target_reps))
          continue;
        if (item.weight_kg !== null && item.reps !== null) {
          const weight =
            Math.round(item.weight_kg * (state.unit === 'lb' ? 2.2046226218 : 1) * 10) / 10;
          state.reps.set(weight, Math.max(state.reps.get(weight) ?? 0, item.reps));
        }
      }
      states.set(movement.exercise.id, state);
    }
  }
  const result = new Map<string, Map<string, string[]>>();
  for (const movement of movements) {
    const state = states.get(movement.exercise.id) ?? {
      weight: -1,
      e1rm: -1,
      duration: -1,
      distance: -1,
      reps: new Map(),
      unit: 'kg' as const,
    };
    const badges = new Map<string, string[]>();
    for (const item of movement.sets) {
      const labels: string[] = [];
      const eligible =
        item.completed &&
        item.set_type !== 'warmup' &&
        !item.warmup &&
        (!item.failed || (item.target_reps != null && (item.reps ?? 0) >= item.target_reps));
      if (!eligible) continue;
      const weight =
        item.weight_kg === null
          ? null
          : Math.round(item.weight_kg * (state.unit === 'lb' ? 2.2046226218 : 1) * 10) / 10;
      if (weight !== null && weight > state.weight) {
        state.weight = weight;
        labels.push('Weight PR');
      }
      if (weight !== null && item.reps !== null) {
        const previousReps = state.reps.get(weight);
        if (previousReps !== undefined && item.reps > previousReps) {
          labels.push(`Rep PR @ ${weight} ${state.unit}`);
        }
        state.reps.set(weight, Math.max(previousReps ?? 0, item.reps));
        if (item.reps >= 1 && item.reps <= 30) {
          const e1rm = Math.round(weight * (1 + item.reps / 30) * 10) / 10;
          if (e1rm > state.e1rm) {
            state.e1rm = e1rm;
            labels.push('Estimated 1RM PR');
          }
        }
      }
      if ((item.duration_seconds ?? -1) > state.duration) {
        state.duration = item.duration_seconds ?? -1;
        labels.push('Duration PR');
      }
      if ((item.distance_km ?? -1) > state.distance) {
        state.distance = item.distance_km ?? -1;
        labels.push('Distance PR');
      }
      if (labels.length) badges.set(item.key, labels);
    }
    states.set(movement.exercise.id, state);
    result.set(movement.key, badges);
  }
  return result;
}

function formatDuration(totalSeconds: number): string {
  return formatSeconds(totalSeconds);
}

function prettyDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(`${value}T12:00:00`));
}

function recordTypeLabel(type: PersonalRecord['record_type']): string {
  return {
    weight: 'weight PR',
    reps_at_weight: 'rep PR',
    estimated_1rm: 'estimated 1RM PR',
    duration: 'duration PR',
    distance: 'distance PR',
  }[type];
}

function bodyweightForDate(measurements: BodyMeasurement[], workoutDate: string): number | null {
  return (
    measurements.find((measurement) => measurement.measurement_date <= workoutDate)?.weight_kg ??
    null
  );
}

export function App() {
  const [tab, setTab] = useState<AppTab>(() => {
    const requested = window.location.hash.slice(1) as AppTab;
    return ['dashboard', 'log', 'body', 'history', 'videos'].includes(requested)
      ? requested
      : 'dashboard';
  });
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [workouts, setWorkouts] = useState<TrackedWorkout[]>([]);
  const [measurements, setMeasurements] = useState<BodyMeasurement[]>([]);
  const [personalRecords, setPersonalRecords] = useState<PersonalRecord[]>([]);
  const [completionRecords, setCompletionRecords] = useState<PersonalRecord[]>([]);
  const [workoutStartDate, setWorkoutStartDate] = useState(localDate());
  const [editingWorkout, setEditingWorkout] = useState<TrackedWorkout | null>(null);
  const [activeWorkoutStartedAt, setActiveWorkoutStartedAt] = useState<number | null>(() => {
    const storedDraft = readActiveWorkoutDraft();
    if (storedDraft) return storedDraft.startedAt;
    return window.location.hash === '#log' ? Date.now() : null;
  });
  const [historyOpenId, setHistoryOpenId] = useState<string | null>(null);
  const [historyExerciseId, setHistoryExerciseId] = useState<string | null>(null);
  const [historyStartSection, setHistoryStartSection] = useState<
    'history' | 'progress' | 'cardio'
  >('history');
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);

  async function refreshData() {
    try {
      const [nextDashboard, nextExercises, nextWorkouts, nextMeasurements, nextRecords] =
        await Promise.all([
          api.dashboard(),
          api.listExercises(),
          api.listWorkouts(),
          api.listBodyMeasurements(),
          api.listPersonalRecords(),
        ]);
      setDashboard(nextDashboard);
      setExercises(nextExercises);
      setWorkouts(nextWorkouts);
      setMeasurements(nextMeasurements);
      setPersonalRecords(nextRecords);
      setMessage(null);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not load your training data.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refreshData();
  }, []);

  useEffect(() => {
    window.history.replaceState(null, '', `#${tab}`);
  }, [tab]);

  async function saveWorkout(payload: WorkoutInput) {
    const wasEditing = editingWorkout !== null;
    const saved = editingWorkout
      ? await api.updateWorkout(editingWorkout.id, payload)
      : await api.createWorkout(payload);
    const newRecords = await api.listPersonalRecords({ workoutId: saved.id });
    await refreshData();
    if (!wasEditing) {
      clearActiveWorkoutDraft();
      setActiveWorkoutStartedAt(null);
    }
    setTab(wasEditing ? 'history' : 'dashboard');
    setMessage(
      newRecords.length
        ? `Workout saved — ${newRecords.length} PR${newRecords.length === 1 ? '' : 's'}! ${newRecords.map((record) => recordTypeLabel(record.record_type)).join(', ')}`
        : editingWorkout
          ? 'Workout changes saved.'
          : 'Workout saved. Nice work.',
    );
    setEditingWorkout(null);
    setCompletionRecords(newRecords);
    return newRecords;
  }

  async function deleteWorkout(workout: TrackedWorkout) {
    try {
      await api.deleteWorkout(workout.id);
      await refreshData();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not delete that workout.');
    }
  }

  async function importWorkoutCsv(file: File) {
    try {
      const result = await api.importWorkouts(file);
      await refreshData();
      setMessage(
        `Imported ${result.sets_imported} sets across ${result.workouts_created} workouts${
          result.exercises_created ? ` and added ${result.exercises_created} exercises` : ''
        }.`,
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not import that CSV file.');
    }
  }

  async function exportWorkoutCsv() {
    try {
      const blob = await api.exportWorkouts();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `gym-workouts-${localDate()}.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setMessage('Workout CSV exported.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not export workout data.');
    }
  }

  async function deleteSampleData() {
    try {
      await api.deleteSampleData();
      await refreshData();
      setMessage('Sample workouts removed. They will not be seeded again.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not remove sample data.');
    }
  }

  function startWorkout(workoutDate = localDate(), replaceActiveWorkout = false) {
    if (replaceActiveWorkout) clearActiveWorkoutDraft();
    const storedDraft = replaceActiveWorkout ? null : readActiveWorkoutDraft();
    const startedAt = storedDraft?.startedAt ?? Date.now();
    setEditingWorkout(null);
    setActiveWorkoutStartedAt(startedAt);
    setWorkoutStartDate(storedDraft?.workoutDate ?? workoutDate);
    setTab('log');
    if (navigator.storage?.persist) void navigator.storage.persist().catch(() => false);
  }

  function editWorkout(workout: TrackedWorkout) {
    setEditingWorkout(workout);
    setWorkoutStartDate(workout.workout_date);
    setTab('log');
  }

  async function saveMeasurement(payload: {
    measurement_date: string;
    weight_kg: number;
    body_fat_pct: number | null;
    notes: string | null;
  }) {
    await api.saveBodyMeasurement(payload);
    await refreshData();
    setMessage('Body measurement saved.');
  }

  async function deleteMeasurement(id: string) {
    try {
      await api.deleteBodyMeasurement(id);
      await refreshData();
      setMessage('Body measurement deleted.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not delete that measurement.');
    }
  }

  async function updateExerciseFavorite(exerciseId: string, isFavorite: boolean) {
    const updated = await api.updateExerciseFavorite(exerciseId, isFavorite);
    setExercises((current) =>
      current.map((exercise) => (exercise.id === updated.id ? updated : exercise)),
    );
  }

  async function updateTrainingMode(mode: TrainingMode) {
    try {
      await api.updateTrainingMode(mode, localDate());
      await refreshData();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not update the training mode.');
    }
  }

  return (
    <div className="tracker-app">
      {message && (
        <div className="status-banner" role="status" aria-live="polite">
          <span>{message}</span>
          <button type="button" onClick={() => setMessage(null)} aria-label="Close notification">
            ×
          </button>
        </div>
      )}
      {completionRecords.length > 0 && (
        <section className="completion-summary panel" aria-label="Workout personal records">
          <button
            type="button"
            className="icon-button"
            onClick={() => setCompletionRecords([])}
            aria-label="Close personal record summary"
          >
            ×
          </button>
          <span className="pr-trophy">🏆</span>
          <p className="section-kicker">WORKOUT COMPLETE</p>
          <h2>
            {completionRecords.length} new PR{completionRecords.length === 1 ? '' : 's'}
          </h2>
          {completionRecords.map((record) => (
            <div key={record.id}>
              <strong>{record.exercise_name}</strong>
              <span>
                {recordTypeLabel(record.record_type)} · {record.value} {record.unit}
                {record.record_type === 'reps_at_weight' && record.normalized_weight !== null
                  ? ` @ ${record.normalized_weight} ${personalRecords.find((item) => item.exercise_id === record.exercise_id && (item.record_type === 'weight' || item.record_type === 'estimated_1rm'))?.unit ?? 'kg'}`
                  : ''}
              </span>
            </div>
          ))}
          <button className="pr-summary-done" onClick={() => setCompletionRecords([])}>
            Done
          </button>
        </section>
      )}

      {!loading && tab !== 'dashboard' && tab !== 'log' && (
        <header className="reference-app-header">
          <button type="button" onClick={() => setTab('dashboard')} aria-label="Back to home">
            ‹
          </button>
          <strong>{tab === 'body' ? 'Bodyweight' : tab === 'history' ? 'Workouts' : 'Videos'}</strong>
          <span aria-hidden="true" />
        </header>
      )}

      <main className={`tracker-content ${tab === 'videos' ? 'video-content' : ''}`}>
        {loading && <LoadingState />}
        {!loading && tab === 'dashboard' && dashboard && (
          <DashboardScreen
            data={dashboard}
            totalWorkouts={workouts.length}
            totalExercises={exercises.length}
            currentBodyweight={measurements[0]?.weight_kg ?? null}
            onStart={startWorkout}
            activeWorkout={activeWorkoutStartedAt !== null}
            onReplaceActiveWorkout={(workoutDate) => startWorkout(workoutDate, true)}
            onBody={() => setTab('body')}
            onOpenWorkout={(id) => {
              setHistoryOpenId(id);
              setHistoryExerciseId(null);
              setHistoryStartSection('history');
              setTab('history');
            }}
            onEditWorkout={(id) => {
              const workout = workouts.find((item) => item.id === id);
              if (workout) editWorkout(workout);
            }}
            onHistory={() => {
              setHistoryOpenId(null);
              setHistoryExerciseId(null);
              setHistoryStartSection('history');
              setTab('history');
            }}
            onExercises={() => {
              setHistoryOpenId(null);
              setHistoryExerciseId(null);
              setHistoryStartSection('progress');
              setTab('history');
            }}
            onMeasurements={() => setTab('body')}
            onImport={() => {
              setHistoryOpenId(null);
              setHistoryExerciseId(null);
              setHistoryStartSection('history');
              setTab('history');
            }}
            onVideos={() => setTab('videos')}
          />
        )}
        {!loading && tab === 'log' && (
          <WorkoutLogger
            key={
              editingWorkout
                ? `edit-${editingWorkout.id}`
                : `active-${activeWorkoutStartedAt ?? workoutStartDate}`
            }
            exercises={exercises}
            recommendation={dashboard?.recommendation ?? null}
            initialDate={workoutStartDate}
            initialWorkout={editingWorkout}
            currentBodyweight={measurements[0]?.weight_kg ?? null}
            personalRecords={personalRecords}
            historicalWorkouts={workouts}
            onExerciseHistory={(exerciseId) => {
              setHistoryOpenId(null);
              setHistoryExerciseId(exerciseId);
              setHistoryStartSection('progress');
              setTab('history');
            }}
            onExerciseFavorite={updateExerciseFavorite}
            onSave={saveWorkout}
            activeStartedAt={activeWorkoutStartedAt}
            onClose={() => {
              if (!editingWorkout) {
                clearActiveWorkoutDraft();
                setActiveWorkoutStartedAt(null);
              }
              setTab(editingWorkout ? 'history' : 'dashboard');
              setEditingWorkout(null);
            }}
          />
        )}
        {!loading && tab === 'body' && (
          <BodyCompositionScreen
            measurements={measurements}
            trainingMode={dashboard?.training_mode ?? 'maintenance'}
            onSave={saveMeasurement}
            onDelete={deleteMeasurement}
            onTrainingMode={updateTrainingMode}
            onDataChange={refreshData}
          />
        )}
        {!loading && tab === 'history' && (
          <HistoryScreen
            key={`${historyOpenId ?? 'history'}-${historyStartSection}-${historyExerciseId ?? 'all'}`}
            workouts={workouts}
            measurements={measurements}
            exercises={exercises}
            currentBodyweight={measurements[0]?.weight_kg ?? null}
            onEdit={editWorkout}
            onDelete={deleteWorkout}
            onImport={importWorkoutCsv}
            onExport={exportWorkoutCsv}
            onDeleteSamples={deleteSampleData}
            personalRecords={personalRecords}
            onDataChange={refreshData}
            initialOpenId={historyOpenId}
            initialSection={historyStartSection}
            initialExerciseId={historyExerciseId}
            onStartWorkout={() => startWorkout()}
          />
        )}
        {tab === 'videos' && <VideoUpload />}
      </main>

      <nav className="bottom-nav" aria-label="Main navigation">
        <NavButton
          active={tab === 'dashboard'}
          label="Home"
          icon="⌂"
          onClick={() => setTab('dashboard')}
        />
        <NavButton active={tab === 'body'} label="Body" icon="◒" onClick={() => setTab('body')} />
        <button
          className={`nav-log ${tab === 'log' ? 'active' : ''} ${activeWorkoutStartedAt !== null ? 'workout-active' : ''}`}
          aria-label={activeWorkoutStartedAt !== null ? 'Resume active workout' : 'Start workout'}
          onClick={() => startWorkout()}
        >
          <span>{activeWorkoutStartedAt !== null ? <i className="nav-live-dot" /> : '＋'}</span>
          {activeWorkoutStartedAt !== null ? 'Live' : 'Log'}
        </button>
        <NavButton
          active={tab === 'history'}
          label="History"
          icon="◷"
          onClick={() => {
            setHistoryOpenId(null);
            setHistoryExerciseId(null);
            setHistoryStartSection('history');
            setTab('history');
          }}
        />
        <NavButton
          active={tab === 'videos'}
          label="Videos"
          icon="▷"
          onClick={() => setTab('videos')}
        />
      </nav>
    </div>
  );
}

function NavButton({
  active,
  label,
  icon,
  onClick,
}: {
  active: boolean;
  label: string;
  icon: string;
  onClick: () => void;
}) {
  return (
    <button className={active ? 'active' : ''} onClick={onClick}>
      <span>{icon}</span>
      {label}
    </button>
  );
}

function LoadingState() {
  return (
    <section className="loading-state">
      <span />
      <p>Loading your training log…</p>
    </section>
  );
}

function PaginationControls({
  currentPage,
  totalPages,
  onPageChange,
  label,
}: {
  currentPage: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  label: string;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const paginationRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!pickerOpen) return;

    const closePicker = (event: PointerEvent) => {
      if (!paginationRef.current?.contains(event.target as Node)) setPickerOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setPickerOpen(false);
    };

    document.addEventListener('pointerdown', closePicker);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closePicker);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [pickerOpen]);

  if (totalPages <= 1) return null;

  const selectPage = (page: number) => {
    onPageChange(Math.min(totalPages, Math.max(1, page)));
    setPickerOpen(false);
  };

  return (
    <nav className="pagination-controls" aria-label={`${label} pagination`} ref={paginationRef}>
      <button
        type="button"
        className="pagination-arrow"
        disabled={currentPage === 1}
        onClick={() => selectPage(currentPage - 1)}
        aria-label={`Previous ${label} page`}
      >
        <span aria-hidden="true">←</span>
      </button>
      <div className="pagination-picker">
        <button
          type="button"
          className="pagination-more"
          onClick={() => setPickerOpen((open) => !open)}
          aria-label={`Choose a ${label} page`}
          aria-haspopup="true"
          aria-expanded={pickerOpen}
        >
          …
        </button>
        {pickerOpen && (
          <div className="pagination-page-menu" role="group" aria-label={`${label} pages`}>
            {Array.from({ length: totalPages }, (_, index) => index + 1).map((page) => (
              <button
                type="button"
                key={page}
                className={page === currentPage ? 'active' : ''}
                onClick={() => selectPage(page)}
                aria-current={page === currentPage ? 'page' : undefined}
                aria-label={`Go to page ${page}`}
              >
                {page}
              </button>
            ))}
          </div>
        )}
      </div>
      <button
        type="button"
        className="pagination-arrow"
        disabled={currentPage === totalPages}
        onClick={() => selectPage(currentPage + 1)}
        aria-label={`Next ${label} page`}
      >
        <span aria-hidden="true">→</span>
      </button>
      <small className="pagination-status" aria-live="polite">
        Page {currentPage} of {totalPages}
      </small>
    </nav>
  );
}

function DashboardScreen({
  data,
  totalWorkouts,
  totalExercises,
  currentBodyweight,
  onStart,
  activeWorkout,
  onReplaceActiveWorkout,
  onBody,
  onOpenWorkout,
  onEditWorkout,
  onHistory,
  onExercises,
  onMeasurements,
  onImport,
  onVideos,
}: {
  data: DashboardData;
  totalWorkouts: number;
  totalExercises: number;
  currentBodyweight: number | null;
  onStart: (workoutDate?: string) => void;
  activeWorkout: boolean;
  onReplaceActiveWorkout: (workoutDate: string) => void;
  onBody: () => void;
  onOpenWorkout: (workoutId: string) => void;
  onEditWorkout: (workoutId: string) => void;
  onHistory: () => void;
  onExercises: () => void;
  onMeasurements: () => void;
  onImport: () => void;
  onVideos: () => void;
}) {
  const [activeMetric, setActiveMetric] = useState<DashboardMetric | null>(null);
  const [selectedDay, setSelectedDay] = useState<DashboardData['heatmap'][number] | null>(null);
  const [pendingWorkoutDate, setPendingWorkoutDate] = useState<string | null>(null);
  const trainingScore = Math.min(
    99,
    Math.max(1, Math.round(56 + Math.log10(Math.max(totalWorkouts, 1)) * 7)),
  );
  const trainingStars = Math.min(5, Math.max(1, Math.round(trainingScore / 20)));

  return (
    <section className="dashboard-screen content-page">
      <section className="profile-hero" aria-label="Training profile">
        <div className="profile-cover">
          <div className="profile-stats">
            <div>
              <span>Workouts</span>
              <strong>{totalWorkouts}</strong>
            </div>
            <div>
              <span>Exercises</span>
              <strong>{totalExercises}</strong>
            </div>
            <div>
              <span>Day streak</span>
              <strong>{data.current_streak}</strong>
            </div>
          </div>
        </div>
      </section>

      <section className="training-level-strip" aria-label={`Training level ${trainingScore}%`}>
        <span>Powerlifting Level</span>
        <span className="training-stars" aria-hidden="true">
          {Array.from({ length: 5 }, (_, index) => (
            <i className={index < trainingStars ? 'filled' : ''} key={index}>
              ★
            </i>
          ))}
        </span>
        <strong>{trainingScore}%</strong>
      </section>

      <div className="dashboard-shortcuts" aria-label="Quick actions">
        <button type="button" onClick={onHistory}>
          <span aria-hidden="true">↔</span>
          <strong>Workouts</strong>
        </button>
        <button type="button" onClick={onExercises}>
          <span aria-hidden="true">☷</span>
          <strong>Exercises</strong>
        </button>
        <button type="button" onClick={onBody}>
          <span aria-hidden="true">◒</span>
          <strong>Bodyweight</strong>
        </button>
        <button type="button" onClick={onMeasurements}>
          <span aria-hidden="true">⌁</span>
          <strong>Measurements</strong>
        </button>
        <button type="button" onClick={onImport}>
          <span aria-hidden="true">⇥</span>
          <strong>Import</strong>
        </button>
      </div>

      <div className="dashboard-secondary-actions">
        <button type="button" onClick={() => onStart()}>
          ＋ Start Workout
        </button>
        <button type="button" onClick={onVideos}>
          ▷ Videos
        </button>
      </div>

      <div className="dashboard-section-heading">
        <p className="section-kicker">THIS WEEK</p>
        <h2>Training overview</h2>
      </div>
      <div className="metric-grid">
        <MetricCard
          value={data.workouts_this_week}
          label="Workouts"
          suffix="this week"
          onClick={() => setActiveMetric('workouts')}
        />
        <MetricCard
          value={data.sets_this_week}
          label="Working sets"
          suffix="this week"
          onClick={() => setActiveMetric('sets')}
        />
        <MetricCard
          value={currentBodyweight !== null ? `${currentBodyweight} kg` : '–'}
          label="Body weight"
          suffix="latest check-in"
          onClick={onBody}
        />
        <MetricCard
          value={data.current_streak}
          label="Day streak"
          suffix={data.current_streak ? 'keep it going' : 'ready to begin'}
          onClick={() => setActiveMetric('streak')}
        />
      </div>
      {activeMetric && (
        <WeeklyInsight data={data} metric={activeMetric} onClose={() => setActiveMetric(null)} />
      )}

      <WeeklyGoalCard goal={data.weekly_goal} />

      <section className={`panel dashboard-zone2 ${data.zone2.complete ? 'complete' : ''}`}>
        <div>
          <p className="section-kicker">ZONE 2</p>
          <h2>
            {data.zone2.completed_minutes} / {data.zone2.goal_minutes} minutes
          </h2>
          <small>
            {data.zone2.complete
              ? 'Goal complete'
              : `${data.zone2.remaining_minutes} min remaining this week`}
          </small>
        </div>
        <div
          className="zone2-ring"
          style={{ '--progress': `${data.zone2.percentage * 3.6}deg` } as CSSProperties}
        >
          <strong>{Math.round(data.zone2.percentage)}%</strong>
        </div>
      </section>

      <section className="panel muscle-volume-panel">
        <div className="panel-heading">
          <div>
            <p className="section-kicker">MUSCLE VOLUME</p>
            <h2>Weekly credited sets</h2>
          </div>
          <small>Primary 1.0 · secondary 0.5</small>
        </div>
        <div className="muscle-volume-grid">
          {data.muscle_volume.map((item) => (
            <div key={item.muscle_name}>
              <span>{item.muscle_name}</span>
              <strong>
                {Number.isInteger(item.set_total) ? item.set_total : item.set_total.toFixed(1)} sets
              </strong>
            </div>
          ))}
          {!data.muscle_volume.length && (
            <p className="muted-empty">Complete a working set to see muscle volume.</p>
          )}
        </div>
          monthCount={2}
      </section>

      <section className="panel heatmap-panel">
        <div className="panel-heading">
          <div>
            <p className="section-kicker">CONSISTENCY</p>
            <h2>Training calendar</h2>
          </div>
        </div>
        <WorkoutHeatmap
          entries={data.heatmap}
          onDayClick={(workoutDate, entry) => {
            if (entry) setSelectedDay(entry);
            else setPendingWorkoutDate(workoutDate);
          }}
        />
        <div className="heatmap-legend">
          {(Object.keys(categoryNames) as WorkoutCategory[])
            .filter((category) => category !== 'other' && category !== 'full_body')
            .map((category) => (
              <span key={category}>
                <i style={{ background: categoryColors[category] }} /> {categoryNames[category]}
              </span>
            ))}
        </div>
        {selectedDay && (
          <CalendarDayDetail
            day={selectedDay}
            onClose={() => setSelectedDay(null)}
            onStartWorkout={(workoutDate) => {
              setSelectedDay(null);
              setPendingWorkoutDate(workoutDate);
            }}
            onEditWorkout={onEditWorkout}
          />
        )}
      </section>

      <section className="panel recent-panel">
        <div className="panel-heading">
          <div>
            <p className="section-kicker">RECENT</p>
            <h2>Latest sessions</h2>
          </div>
        </div>
        {data.recent_workouts.length === 0 ? (
          <EmptyState
            title="No workouts yet"
            body="Log your first session and your dashboard will come alive."
            action="Log workout"
            onAction={onStart}
          />
        ) : (
          data.recent_workouts
            .slice(0, 5)
            .map((workout) => (
              <WorkoutSummary
                key={workout.id}
                workout={workout}
                onOpen={() => onOpenWorkout(workout.id)}
              />
            ))
        )}
      </section>
      {pendingWorkoutDate && (
        <CalendarCreateWorkoutDialog
          workoutDate={pendingWorkoutDate}
          activeWorkout={activeWorkout}
          onCancel={() => setPendingWorkoutDate(null)}
          onConfirm={() => {
            const workoutDate = pendingWorkoutDate;
            setPendingWorkoutDate(null);
            if (activeWorkout) onReplaceActiveWorkout(workoutDate);
            else onStart(workoutDate);
          }}
        />
      )}
    </section>
  );
}

function CalendarCreateWorkoutDialog({
  workoutDate,
  activeWorkout,
  onCancel,
  onConfirm,
}: {
  workoutDate: string;
  activeWorkout: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const cancelButtonRef = useRef<HTMLButtonElement>(null);
  const onCancelRef = useRef(onCancel);

  useEffect(() => {
    onCancelRef.current = onCancel;
  }, [onCancel]);

  useEffect(() => {
    const root = document.getElementById('root');
    const rootWasInert = root?.hasAttribute('inert') ?? false;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    root?.setAttribute('inert', '');
    cancelButtonRef.current?.focus();

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancelRef.current();
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      if (!rootWasInert) root?.removeAttribute('inert');
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, []);

  return createPortal(
    <div
      className="modal-backdrop calendar-create-backdrop"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <section
        className="calendar-create-dialog panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="calendar-create-title"
        aria-describedby="calendar-create-description"
      >
        <div
          className={`calendar-create-icon ${activeWorkout ? 'active-conflict' : ''}`}
          aria-hidden="true"
        >
          {activeWorkout ? '!' : '+'}
        </div>
        <p className="section-kicker">{activeWorkout ? 'WORKOUT IN PROGRESS' : 'NEW WORKOUT'}</p>
        <h2 id="calendar-create-title">
          {activeWorkout ? 'Cancel your current workout?' : 'Create a new workout?'}
        </h2>
        <p id="calendar-create-description">
          {activeWorkout
            ? `Creating a workout for ${prettyDate(workoutDate)} will discard your current unsaved workout.`
            : `Start a workout for ${prettyDate(workoutDate)}?`}
        </p>
        <div className="calendar-create-actions">
          <button ref={cancelButtonRef} type="button" onClick={onCancel}>
            {activeWorkout ? 'Keep current workout' : 'Cancel'}
          </button>
          <button
            className={activeWorkout ? 'cancel-current-workout-button' : 'create-workout-button'}
            type="button"
            onClick={onConfirm}
          >
            {activeWorkout ? 'Cancel & create new' : 'Create workout'}
          </button>
        </div>
      </section>
    </div>,
    document.body,
  );
}

function MetricCard({
  value,
  label,
  suffix,
  onClick,
}: {
  value: number | string;
  label: string;
  suffix: string;
  onClick?: () => void;
}) {
  const content = (
    <>
      <strong>{value}</strong>
      <span>{label}</span>
      <small>{suffix}</small>
      {onClick && <b aria-hidden="true">View details&nbsp; →</b>}
    </>
  );
  return onClick ? (
    <button type="button" className="metric-card" onClick={onClick} aria-label={`View ${label}`}>
      {content}
    </button>
  ) : (
    <article className="metric-card">{content}</article>
  );
}

const trainingModeLabels: Record<TrainingMode, string> = {
  cut: 'Cut',
  maintenance: 'Maintenance',
  bulk: 'Bulk',
};

const maintenanceWeightRangeRatio = 0.01;

function trainingModeForWeightTarget(currentWeight: number, targetWeight: number): TrainingMode {
  if (targetWeight < currentWeight * (1 - maintenanceWeightRangeRatio)) return 'cut';
  if (targetWeight > currentWeight * (1 + maintenanceWeightRangeRatio)) return 'bulk';
  return 'maintenance';
}

function WeeklyGoalCard({ goal }: { goal: WeeklyGoal }) {
  const [open, setOpen] = useState(false);
  const targetTotal = goal.muscle_groups.reduce((total, item) => total + item.target_sets, 0);
  const belowTarget = goal.muscle_groups.filter((item) => item.status === 'below').length;
  const displayedPercent = Math.min(goal.overall_percent, 100);

  return (
    <>
      <section className={`panel weekly-goal-card goal-mode-${goal.mode}`}>
        <div className="weekly-goal-topline">
          <div>
            <p className="section-kicker">WEEKLY GOAL</p>
            <h2>{trainingModeLabels[goal.mode]} phase</h2>
          </div>
        </div>
        <div className="weekly-goal-number">
          <strong>{Math.round(goal.overall_percent)}%</strong>
          <span>
            {formatGoalSets(goal.effective_sets)} effective sets
            {targetTotal > 0 && ` · ${targetTotal} combined target`}
          </span>
        </div>
        <div
          className="goal-progress-track"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(displayedPercent)}
          aria-label="Weekly muscle volume progress"
        >
          <i style={{ width: `${displayedPercent}%` }} />
          <b style={{ left: `${displayedPercent}%` }} />
        </div>
        <div className="weekly-goal-summary">
          <span>
            {belowTarget
              ? `${belowTarget} muscle ${belowTarget === 1 ? 'group needs' : 'groups need'} attention`
              : 'Every active muscle group is on target'}
          </span>
          <span>{goal.days_remaining} days left</span>
        </div>
        <button className="goal-details-button" type="button" onClick={() => setOpen(true)}>
          View muscle breakdown <span>→</span>
        </button>
      </section>
      {open && <WeeklyGoalDetail goal={goal} onClose={() => setOpen(false)} />}
    </>
  );
}

function WeeklyGoalDetail({ goal, onClose }: { goal: WeeklyGoal; onClose: () => void }) {
  const [infoOpen, setInfoOpen] = useState(false);

  return (
    <section className="weekly-goal-detail inline-detail panel" aria-label="Weekly training goal">
      <header>
        <div>
          <p className="section-kicker">{trainingModeLabels[goal.mode].toUpperCase()} PHASE</p>
          <div className="weekly-goal-title">
            <h2>Your weekly target</h2>
            <button
              type="button"
              className="goal-info-button"
              aria-label={
                infoOpen ? 'Hide weekly target information' : 'Show weekly target information'
              }
              aria-expanded={infoOpen}
              aria-controls="weekly-goal-information"
              onClick={() => setInfoOpen((current) => !current)}
            >
              <span aria-hidden="true">i</span>
            </button>
          </div>
        </div>
        <button type="button" className="icon-button" onClick={onClose} aria-label="Close">
          ×
        </button>
      </header>
      {infoOpen && (
        <div className="goal-explainer" id="weekly-goal-information">
        <strong>
          {goal.target_sets_per_muscle} sets for larger muscles ·{' '}
          {Math.floor(goal.target_sets_per_muscle / 2)} for smaller muscles
        </strong>
        <p>
          Completed strength sets at RPE 7–10 count. Warmups, cardio, and lower-effort sets do not
          fill the bar; secondary muscles receive half credit.
        </p>
        </div>
      )}
      <div className="muscle-goal-list">
        {goal.muscle_groups.map((item) => {
          const percent = Math.min(
            (item.effective_sets / Math.max(item.target_sets, 1)) * 100,
            100,
          );
          return (
            <article key={item.muscle_group}>
              <div>
                <strong>{item.muscle_group}</strong>
                <span className={`goal-status ${item.status}`}>
                  {item.status === 'below'
                    ? 'Building'
                    : item.status === 'on_target'
                      ? 'On target'
                      : 'Above range'}
                </span>
              </div>
              <div className="muscle-progress-track">
                <i style={{ width: `${percent}%` }} />
              </div>
              <p>
                <b>{formatGoalSets(item.effective_sets)}</b> / {item.target_sets} effective sets
                <span>
                  {formatGoalSets(item.raw_sets)} logged
                  {item.average_rpe !== null && ` · avg RPE ${item.average_rpe}`}
                </span>
              </p>
            </article>
          );
        })}
        {!goal.muscle_groups.length && (
          <p className="goal-empty">Log a strength workout to establish your active muscles.</p>
        )}
      </div>
      <footer className="goal-data-quality">
        <div>
          <strong>{Math.round(goal.rpe_logging_percent)}%</strong>
          <span>RPE coverage</span>
        </div>
        <p>
          {goal.unrated_sets} unrated and {goal.low_rpe_sets} lower-effort sets this week. Targets
          are evidence-informed estimates and can’t account for recovery, sleep, or injury.
        </p>
      </footer>
    </section>
  );
}

function formatGoalSets(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function WeeklyInsight({
  data,
  metric,
  onClose,
}: {
  data: DashboardData;
  metric: DashboardMetric;
  onClose: () => void;
}) {
  const muscleGroups = useMemo(() => {
    const groups = new Map<
      string,
      Map<string, { total: number; days: Array<{ date: string; sets: number }> }>
    >();
    data.weekly_days.forEach((day) => {
      day.exercises.forEach((exercise) => {
        if (exercise.category === 'cardio') return;
        const exercises = groups.get(exercise.muscle_group) ?? new Map();
        const current = exercises.get(exercise.exercise_name) ?? { total: 0, days: [] };
        current.total += exercise.set_count;
        current.days.push({ date: day.workout_date, sets: exercise.set_count });
        exercises.set(exercise.exercise_name, current);
        groups.set(exercise.muscle_group, exercises);
      });
    });
    return [...groups.entries()]
      .map(([name, exercises]) => ({
        name,
        total: [...exercises.values()].reduce((sum, item) => sum + item.total, 0),
        exercises: [...exercises.entries()].map(([exerciseName, detail]) => ({
          name: exerciseName,
          ...detail,
        })),
      }))
      .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
  }, [data.weekly_days]);

  const title = {
    workouts: 'This week’s workouts',
    sets: 'Weekly sets by muscle',
    streak: 'Training streak',
  }[metric];

  return (
    <section className="weekly-insight inline-detail panel" aria-label={title}>
      <header>
        <div>
          <p className="section-kicker">WEEKLY DETAIL</p>
          <h2>{title}</h2>
        </div>
        <button type="button" className="icon-button" onClick={onClose} aria-label="Close">
          ×
        </button>
      </header>

      <div className="weekly-insight-body">
        {data.weekly_days.length === 0 ? (
          <div className="weekly-empty">Log a workout to start building your weekly view.</div>
        ) : metric === 'sets' ? (
          <MuscleGroupBreakdown groups={muscleGroups} />
        ) : metric === 'workouts' ? (
          data.weekly_days.map((day) => <WeeklyWorkoutDay key={day.workout_date} day={day} />)
        ) : (
          <StreakBreakdown data={data} />
        )}
      </div>
    </section>
  );
}

function MuscleGroupBreakdown({
  groups,
}: {
  groups: Array<{
    name: string;
    total: number;
    exercises: Array<{
      name: string;
      total: number;
      days: Array<{ date: string; sets: number }>;
    }>;
  }>;
}) {
  if (groups.length === 0) {
    return <div className="weekly-empty">This week only contains cardio so far.</div>;
  }
  return groups.map((group) => (
    <article className="muscle-group-card" key={group.name}>
      <header>
        <h3>{group.name}</h3>
        <strong>{group.total} sets</strong>
      </header>
      {group.exercises.map((exercise) => (
        <div className="muscle-exercise" key={exercise.name}>
          <div>
            <strong>{exercise.name}</strong>
            <small>{exercise.total} sets total</small>
          </div>
          <div className="day-set-chips">
            {exercise.days.map((day) => (
              <span key={day.date}>
                {weekday(day.date)} · {day.sets} {day.sets === 1 ? 'set' : 'sets'}
              </span>
            ))}
          </div>
        </div>
      ))}
    </article>
  ));
}

function WeeklyWorkoutDay({ day }: { day: DashboardData['weekly_days'][number] }) {
  return (
    <article className="weekly-day-card">
      <div className="weekly-day-heading">
        <div>
          <strong>{weekday(day.workout_date)}</strong>
          <small>{prettyDate(day.workout_date)}</small>
        </div>
        <b>{day.total_sets} sets</b>
      </div>
      <div className="weekly-category-row">
        {day.categories.map((category) => (
          <span key={category}>
            <i style={{ background: categoryColors[category] }} /> {categoryNames[category]}
          </span>
        ))}
      </div>
      {day.workout_names.map((name) => (
        <p key={name}>{name}</p>
      ))}
    </article>
  );
}

function StreakBreakdown({ data }: { data: DashboardData }) {
  const trainedDates = new Set(data.heatmap.map((entry) => entry.workout_date));
  const days = Array.from({ length: 7 }, (_, index) => {
    const value = new Date();
    value.setHours(12, 0, 0, 0);
    value.setDate(value.getDate() - (6 - index));
    return value;
  });
  return (
    <div className="streak-breakdown">
      <strong>{data.current_streak}</strong>
      <span>
        {data.current_streak === 1 ? 'day in your current streak' : 'days in your current streak'}
      </span>
      <div className="streak-week">
        {days.map((day) => {
          const key = day.toISOString().slice(0, 10);
          const trained = trainedDates.has(key);
          return (
            <div key={key}>
              <i className={trained ? 'trained' : ''}>{trained ? '✓' : '·'}</i>
              <small>{day.toLocaleDateString(undefined, { weekday: 'narrow' })}</small>
            </div>
          );
        })}
      </div>
  monthCount,
      <p>A training day counts whether you lift, do cardio, or combine both.</p>
    </div>
  );
  monthCount: number | 'all';
}

function weekday(value: string): string {
  return new Date(`${value}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short' });
}

function WorkoutHeatmap({
  entries,
  onDayClick,
}: {
  entries: DashboardData['heatmap'];
  onDayClick: (workoutDate: string, entry: DashboardData['heatmap'][number] | undefined) => void;
}) {
  const calendarScrollRef = useRef<HTMLDivElement>(null);
  const map = new Map(entries.map((entry) => [entry.workout_date, entry]));
  const months = useMemo(() => {
    const today = new Date();
    today.setHours(12, 0, 0, 0);
    const earliest = entries[0] ? new Date(`${entries[0].workout_date}T12:00:00`) : today;
    const allMonthCount =
      (today.getFullYear() - earliest.getFullYear()) * 12 +
      today.getMonth() -
      earliest.getMonth() +
      1;
    const resolvedMonthCount = monthCount === 'all' ? Math.max(allMonthCount, 1) : monthCount;
    return Array.from({ length: resolvedMonthCount }, (_, offset) => {
      const first = new Date(today.getFullYear(), today.getMonth() - offset, 1, 12);
      const dayCount = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
      const leading = (first.getDay() + 6) % 7;
      const cells: Array<Date | null> = [
        ...Array.from({ length: leading }, () => null),
        ...Array.from(
          { length: dayCount },
          (_, index) => new Date(first.getFullYear(), first.getMonth(), index + 1, 12),
        ),
      ];
      while (cells.length < 42) cells.push(null);
      return {
        key: `${first.getFullYear()}-${first.getMonth()}`,
        title: first.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }),
        cells,
      };
    }).reverse();
  }, [entries, monthCount]);
  const todayKey = localCalendarDate(new Date());

  useEffect(() => {
    const calendar = calendarScrollRef.current;
    if (!calendar) return;
    const frame = window.requestAnimationFrame(() => {
      calendar.scrollLeft = calendar.scrollWidth - calendar.clientWidth;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [months]);

  return (
    <div className="calendar-scroll" ref={calendarScrollRef}>
      {months.map((month) => (
        <article className="calendar-month" key={month.key}>
          <h3>{month.title}</h3>
          <div className="calendar-weekdays" aria-hidden="true">
            {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((day, index) => (
              <span key={`${day}-${index}`}>{day}</span>
            ))}
          </div>
          <div className="calendar-days">
            {month.cells.map((day, index) => {
              if (!day) return <span className="calendar-day empty" key={`empty-${index}`} />;
              const key = localCalendarDate(day);
              const entry = map.get(key);
              const colours = entry?.categories.map((category) => categoryColors[category]) ?? [];
              const background =
                colours.length > 1
                  ? `linear-gradient(135deg, ${colours[0]} 0 49%, ${colours[1]} 51% 100%)`
                  : colours[0];
              return (
                <button
                  type="button"
                  className={`calendar-day ${entry ? 'trained' : ''} ${key === todayKey ? 'today' : ''} ${key > todayKey ? 'future' : ''}`}
                  key={key}
                  style={background ? { background } : undefined}
                  onClick={() => onDayClick(key, entry)}
                  aria-current={key === todayKey ? 'date' : undefined}
                  aria-label={
                    entry
                      ? `View ${entry.workout_count} ${entry.workout_count === 1 ? 'workout' : 'workouts'} for ${prettyDate(key)}`
                      : `Create workout for ${prettyDate(key)}`
                  }
                  title={
                    entry
                      ? `${prettyDate(key)}: ${entry.workout_count} ${entry.workout_count === 1 ? 'workout' : 'workouts'}, ${entry.set_count} sets`
                      : prettyDate(key)
                  }
                >
                  {day.getDate()}
                </button>
              );
            })}
          </div>
        </article>
      ))}
    </div>
  );
}

function CalendarDayDetail({
  day,
  onClose,
  onStartWorkout,
  onEditWorkout,
}: {
  day: DashboardData['heatmap'][number];
  onClose: () => void;
  onStartWorkout: (workoutDate: string) => void;
  onEditWorkout: (workoutId: string) => void;
}) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const root = document.getElementById('root');
    const rootWasInert = root?.hasAttribute('inert') ?? false;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    root?.setAttribute('inert', '');
    closeButtonRef.current?.focus();

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCloseRef.current();
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      if (!rootWasInert) root?.removeAttribute('inert');
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, []);

  return createPortal(
    <div
      className="modal-backdrop calendar-day-backdrop"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="calendar-day-detail"
        role="dialog"
        aria-modal="true"
        aria-labelledby="calendar-day-detail-title"
      >
        <header>
          <div>
            <p className="section-kicker">TRAINING DAY</p>
            <h2 id="calendar-day-detail-title">{prettyDate(day.workout_date)}</h2>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            className="icon-button"
            onClick={onClose}
            aria-label="Close workout details"
          >
            ×
          </button>
        </header>
        <div className="calendar-day-workouts">
          {day.workouts.map((workout) => (
            <article key={workout.id}>
              <button
                type="button"
                className="calendar-workout-open"
                onClick={() => onEditWorkout(workout.id)}
                aria-label={`View and edit ${workout.name}`}
              >
                <i style={{ background: categoryColors[workout.category] }} />
                <span>
                  <strong>{workout.name}</strong>
                  <small>
                    {categoryNames[workout.category]} ·{' '}
                    {formatMinutesDuration(workout.duration_minutes)}
                  </small>
                </span>
                <svg className="disclosure-chevron" viewBox="0 0 20 20" aria-hidden="true">
                  <path d="m7 4 6 6-6 6" />
                </svg>
              </button>
              {workout.exercises.map((exercise) => (
                <p key={exercise.exercise_name}>
                  <span>
                    {exercise.exercise_name}
                    {exercise.bodyweight_kg !== null && ` @ ${exercise.bodyweight_kg} kg`}
                  </span>
                  <b>{exercise.set_count} sets</b>
                </p>
              ))}
              <button
                type="button"
                className="calendar-edit-workout"
                onClick={() => onEditWorkout(workout.id)}
              >
                View &amp; edit workout
              </button>
            </article>
          ))}
        </div>
        <button
          type="button"
          className="calendar-add-workout"
          onClick={() => onStartWorkout(day.workout_date)}
        >
          Add another workout
        </button>
      </section>
    </div>,
    document.body,
  );
}

function localCalendarDate(value: Date): string {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
}

function WorkoutSummary({ workout, onOpen }: { workout: TrackedWorkout; onOpen: () => void }) {
  const completedSets = workout.movements
    .flatMap((movement) => movement.sets)
    .filter((item) => item.completed);
  return (
    <button
      type="button"
      className="workout-summary"
      onClick={onOpen}
      aria-label={`Open ${workout.name} from ${prettyDate(workout.workout_date)}`}
    >
      <i style={{ background: categoryColors[workout.category] }} />
      <div>
        <strong>
          {workout.name}
          {workout.is_sample && <em className="sample-badge">Sample</em>}
        </strong>
        <small>
          {prettyDate(workout.workout_date)} · {workout.movements.length} exercises ·{' '}
          {completedSets.length} sets
        </small>
      </div>
      <svg className="workout-summary-chevron" viewBox="0 0 20 20" aria-hidden="true">
        <path d="m7 4 6 6-6 6" />
      </svg>
    </button>
  );
}

function WorkoutLogger({
  exercises,
  recommendation,
  initialDate,
  initialWorkout,
  currentBodyweight,
  personalRecords,
  historicalWorkouts,
  onExerciseHistory,
  onExerciseFavorite,
  onSave,
  activeStartedAt,
  onClose,
}: {
  exercises: Exercise[];
  recommendation: WorkoutRecommendation | null;
  initialDate: string;
  initialWorkout: TrackedWorkout | null;
  currentBodyweight: number | null;
  personalRecords: PersonalRecord[];
  historicalWorkouts: TrackedWorkout[];
  onExerciseHistory: (exerciseId: string) => void;
  onExerciseFavorite: (exerciseId: string, isFavorite: boolean) => Promise<void>;
  onSave: (payload: WorkoutInput) => Promise<PersonalRecord[]>;
  activeStartedAt: number | null;
  onClose: () => void;
}) {
  const restoredDraft = useState(() => (initialWorkout ? null : readActiveWorkoutDraft()))[0];
  const [name, setName] = useState(initialWorkout?.name ?? restoredDraft?.name ?? '');
  const [workoutDate, setWorkoutDate] = useState(
    initialWorkout?.workout_date ?? restoredDraft?.workoutDate ?? initialDate,
  );
  const [category, setCategory] = useState<WorkoutCategory>(
    initialWorkout?.category ?? restoredDraft?.category ?? recommendation?.category ?? 'push',
  );
  const [notes, setNotes] = useState(initialWorkout?.notes ?? restoredDraft?.notes ?? '');
  const [editedDurationMinutes, setEditedDurationMinutes] = useState(
    initialWorkout?.duration_minutes ?? 0,
  );
  const [movements, setMovements] = useState<DraftMovement[]>(() =>
    initialWorkout
      ? initialWorkout.movements.map((movement) => ({
          key: crypto.randomUUID(),
          exercise: movement.exercise,
          notes: movement.notes ?? '',
          machinePhotoIds: movement.machine_photos.map((photo) => photo.id),
          machinePhotosInitialized: true,
          supersetKey: movement.superset_group_id,
          sets: movement.sets.map((item) => ({
            key: crypto.randomUUID(),
            reps: item.reps,
            weight_kg: item.weight_kg,
            rpe: item.rpe,
            rest_seconds: item.rest_seconds,
            duration_seconds: item.duration_seconds,
            distance_km: item.distance_km,
            incline_percent: item.incline_percent,
            speed_kph: item.speed_kph,
            bodyweight_kg: item.bodyweight_kg,
            percentile: item.percentile,
            warmup: item.warmup,
            set_type: item.set_type,
            failed: item.failed,
            target_reps: item.target_reps,
            notes: item.notes,
            completed: item.completed,
          })),
        }))
      : (restoredDraft?.movements.flatMap((movement) => {
          const exercise = exercises.find((item) => item.id === movement.exerciseId);
          return exercise
            ? [
                {
                  key: movement.key,
                  exercise,
                  notes: movement.notes,
                  machinePhotoIds: movement.machinePhotoIds,
                  machinePhotosInitialized: true,
                  supersetKey: movement.supersetKey,
                  sets: movement.sets,
                },
              ]
            : [];
        }) ?? []),
  );
  const [pickerOpen, setPickerOpen] = useState(false);
  const [switchingMovementKey, setSwitchingMovementKey] = useState<string | null>(null);
  const [supersetPickerKey, setSupersetPickerKey] = useState<string | null>(null);
  const [closeConfirmationOpen, setCloseConfirmationOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [categoryNotice, setCategoryNotice] = useState<string | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const supersetButtonRef = useRef<HTMLButtonElement>(null);
  const startedAt = useState(() => restoredDraft?.startedAt ?? activeStartedAt ?? Date.now())[0];
  const [elapsed, setElapsed] = useState(
    initialWorkout
      ? (initialWorkout.duration_minutes ?? 0) * 60
      : Math.max(0, Math.floor((Date.now() - startedAt) / 1000)),
  );
  const [restLeft, setRestLeft] = useState(0);
  const movementExerciseSignature = movements
    .map((movement) => movement.exercise.id)
    .sort()
    .join('|');
  const inferredWorkoutCategory = inferWorkoutCategory(
    movements.map((movement) => movement.exercise),
  );
  const previousMovementExerciseSignature = useRef(movementExerciseSignature);

  useEffect(() => {
    if (initialWorkout) return;
    const timer = window.setInterval(
      () => setElapsed(Math.floor((Date.now() - startedAt) / 1000)),
      1000,
    );
    return () => window.clearInterval(timer);
  }, [initialWorkout, startedAt]);

  useEffect(() => {
    if (initialWorkout) return;
    const persistDraft = () => {
      writeActiveWorkoutDraft({
        version: 1,
        startedAt,
        updatedAt: Date.now(),
        name,
        workoutDate,
        category,
        notes,
        movements: movements.map((movement) => ({
          key: movement.key,
          exerciseId: movement.exercise.id,
          notes: movement.notes,
          machinePhotoIds: movement.machinePhotoIds,
          supersetKey: movement.supersetKey,
          sets: movement.sets,
        })),
      });
    };
    const persistWhenHidden = () => {
      if (document.visibilityState === 'hidden') persistDraft();
    };
    persistDraft();
    window.addEventListener('pagehide', persistDraft);
    document.addEventListener('visibilitychange', persistWhenHidden);
    return () => {
      window.removeEventListener('pagehide', persistDraft);
      document.removeEventListener('visibilitychange', persistWhenHidden);
    };
  }, [category, initialWorkout, movements, name, notes, startedAt, workoutDate]);

  useEffect(() => {
    if (restLeft <= 0) return;
    const timer = window.setInterval(
      () => setRestLeft((current) => Math.max(0, current - 1)),
      1000,
    );
    return () => window.clearInterval(timer);
  }, [restLeft]);

  useEffect(() => {
    if (previousMovementExerciseSignature.current === movementExerciseSignature) return;
    previousMovementExerciseSignature.current = movementExerciseSignature;
    if (!inferredWorkoutCategory) return;

    const nextName = workoutNameForCategory(inferredWorkoutCategory);
    const categoryChanged = category !== inferredWorkoutCategory;
    const nameChanged = name !== nextName;
    if (categoryChanged) setCategory(inferredWorkoutCategory);
    if (nameChanged) setName(nextName);
    if (categoryChanged || nameChanged) {
      setCategoryNotice(
        `Workout type changed to ${categoryNames[inferredWorkoutCategory]} and the name was updated to “${nextName}” based on the selected exercises.`,
      );
    }
  }, [category, inferredWorkoutCategory, movementExerciseSignature, name]);

  const [undoDeletion, setUndoDeletion] = useState<{
    movementKey: string;
    set: DraftSet;
    index: number;
  } | null>(null);
  const prBadges = useMemo(
    () =>
      calculateDraftPrs(movements, personalRecords, historicalWorkouts, initialWorkout?.id ?? null),
    [movements, personalRecords, historicalWorkouts, initialWorkout?.id],
  );
  const recentExerciseIds = useMemo(() => {
    const seen = new Set<string>();
    const recent: string[] = [];
    historicalWorkouts.forEach((workout) => {
      workout.movements.forEach((movement) => {
        if (!seen.has(movement.exercise.id)) {
          seen.add(movement.exercise.id);
          recent.push(movement.exercise.id);
        }
      });
    });
    return recent.slice(0, 10);
  }, [historicalWorkouts]);

  function addExercises(selected: Exercise[], createSuperset = false) {
    setMovements((current) => {
      const merged = mergeUniqueById(
        current.map((item) => item.exercise),
        selected,
      );
      const additions = merged.slice(current.length).map((exercise) => ({
        key: crypto.randomUUID(),
        exercise,
        notes: '',
        machinePhotoIds: [],
        machinePhotosInitialized: false,
        supersetKey: null,
        sets: [
          emptySet(
            exercise.kind,
            latestExerciseSet(historicalWorkouts, exercise.id, workoutDate, initialWorkout?.id),
            true,
          ),
        ],
      }));
      const nextMovements = [...current, ...additions];
      return createSuperset && additions.length >= 2
        ? applySupersetSelection(
            nextMovements,
            additions[0].key,
            additions.slice(1).map((item) => item.key),
            crypto.randomUUID(),
          )
        : nextMovements;
    });
    setPickerOpen(false);
  }

  function closeExercisePicker() {
    setPickerOpen(false);
    setSwitchingMovementKey(null);
  }

  function switchExercise(selected: Exercise[]) {
    const replacement = selected[0];
    if (!switchingMovementKey || !replacement) return;
    setMovements((current) =>
      replaceMovementExercise(current, switchingMovementKey, replacement),
    );
    closeExercisePicker();
  }

  function moveMovement(index: number, direction: -1 | 1) {
    setMovements((current) => moveItem(current, index, index + direction));
  }

  function moveSet(movementKey: string, index: number, direction: -1 | 1) {
    setMovements((current) =>
      current.map((movement) =>
        movement.key === movementKey
          ? { ...movement, sets: moveItem(movement.sets, index, index + direction) }
          : movement,
      ),
    );
  }

  function deleteSet(movement: DraftMovement, index: number) {
    if (movement.sets.length === 1) {
      setError('An exercise needs at least one set. Remove the exercise instead.');
      return;
    }
    const deleted = movement.sets[index];
    setMovements((current) =>
      current.map((item) =>
        item.key === movement.key
          ? { ...item, sets: item.sets.filter((_, setIndex) => setIndex !== index) }
          : item,
      ),
    );
    setUndoDeletion({ movementKey: movement.key, set: deleted, index });
  }

  function undoSetDeletion() {
    if (!undoDeletion) return;
    setMovements((current) =>
      current.map((movement) => {
        if (movement.key !== undoDeletion.movementKey) return movement;
        const sets = [...movement.sets];
        sets.splice(undoDeletion.index, 0, undoDeletion.set);
        return { ...movement, sets };
      }),
    );
    setUndoDeletion(null);
  }

  function openSupersetPicker(movementKey: string, button: HTMLButtonElement) {
    supersetButtonRef.current = button;
    setError(null);
    setSupersetPickerKey(movementKey);
  }

  function closeSupersetPicker() {
    setSupersetPickerKey(null);
    window.requestAnimationFrame(() => supersetButtonRef.current?.focus());
  }

  function saveSuperset(movementKey: string, partnerKeys: string[]) {
    setMovements((items) =>
      applySupersetSelection(items, movementKey, partnerKeys, crypto.randomUUID()),
    );
    closeSupersetPicker();
  }

  function removeSuperset(movementKey: string) {
    setMovements((items) => clearSuperset(items, movementKey));
    closeSupersetPicker();
  }

  function updateSet(movementKey: string, setKey: string, update: Partial<DraftSet>) {
    setMovements((current) =>
      current.map((movement) =>
        movement.key === movementKey
          ? {
              ...movement,
              sets: movement.sets.map((item) =>
                item.key === setKey ? { ...item, ...update } : item,
              ),
            }
          : movement,
      ),
    );
  }

  function toggleSet(movement: DraftMovement, item: DraftSet) {
    const nextCompleted = !item.completed;
    updateSet(movement.key, item.key, { completed: nextCompleted });
    if (nextCompleted && item.rest_seconds) setRestLeft(item.rest_seconds);
  }

  function addSet(movement: DraftMovement, count = 1, update: Partial<DraftSet> = {}) {
    setMovements((current) =>
      current.map((item) =>
        item.key === movement.key
          ? {
              ...item,
              sets: Array.from({ length: Math.min(20, Math.max(1, count)) }).reduce<DraftSet[]>(
                (sets) => {
                  const created = {
                    ...emptySet(item.exercise.kind, sets.at(-1)),
                    ...update,
                    key: crypto.randomUUID(),
                  };
                  return [...sets, created];
                },
                item.sets,
              ),
            }
          : item,
      ),
    );
  }

  function removeMovement(key: string) {
    setMovements((current) => current.filter((item) => item.key !== key));
  }

  async function finishWorkout() {
    const completed = movements
      .flatMap((movement) => movement.sets)
      .filter((item) => item.completed);
    if (!movements.length || !completed.length) {
      setError('Add an exercise and complete at least one set before saving.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onSave({
        name: name.trim() || `${categoryNames[category]} workout`,
        workout_date: workoutDate,
        category,
        notes: notes.trim() || null,
        duration_minutes: initialWorkout
          ? editedDurationMinutes
          : Math.max(1, Math.round(elapsed / 60)),
        movements: movements.map((movement) => ({
          exercise_id: movement.exercise.id,
          notes: movement.notes.trim() || null,
          machine_photo_ids: movement.machinePhotoIds,
          sets: movement.sets.map((item) => ({
            reps: item.reps,
            weight_kg: item.weight_kg,
            rpe: item.rpe,
            rest_seconds: item.rest_seconds,
            duration_seconds: item.duration_seconds,
            distance_km: item.distance_km,
            incline_percent: item.incline_percent ?? null,
            speed_kph: item.speed_kph ?? null,
            bodyweight_kg: item.bodyweight_kg,
            percentile: item.percentile,
            warmup: item.warmup,
            set_type: item.set_type,
            failed: item.failed,
            target_reps: item.target_reps,
            notes: item.notes,
            completed: item.completed,
          })),
          superset_key: movement.supersetKey,
        })),
      });
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Could not save the workout.');
      setSaving(false);
    }
  }

  const editedDurationHours = Math.floor(editedDurationMinutes / 60);
  const editedDurationRemainder = editedDurationMinutes % 60;
  const completedSets = movements.flatMap((movement) =>
    movement.sets.filter((item) => item.completed),
  );
  const completedReps = completedSets.reduce((total, item) => total + (item.reps ?? 0), 0);
  const completedVolume = completedSets.reduce(
    (total, item) => total + (item.weight_kg ?? 0) * (item.reps ?? 0),
    0,
  );
  const displayedDurationSeconds = initialWorkout ? editedDurationMinutes * 60 : elapsed;

  return (
    <section className="logger-screen content-page">
      <div className="live-workout-bar">
        <button ref={closeButtonRef} type="button" onClick={() => setCloseConfirmationOpen(true)}>
          Close
        </button>
        <div>
          {!initialWorkout && <span className="live-dot" />}
          {initialWorkout ? 'EDIT WORKOUT' : ` LIVE · ${formatDuration(elapsed)}`}
        </div>
        <button className="finish-button" disabled={saving} onClick={() => void finishWorkout()}>
          {saving ? 'Saving…' : initialWorkout ? 'Save' : 'Finish'}
        </button>
      </div>
      {restLeft > 0 && (
        <RestTimer
          seconds={restLeft}
          onAdd={() => setRestLeft((current) => current + 30)}
          onSkip={() => setRestLeft(0)}
        />
      )}

      {recommendation && !initialWorkout && (
        <section className="workout-recommendation panel">
          <div className="recommendation-heading">
            <div>
              <p className="section-kicker">RECOMMENDED NEXT</p>
              <h2>{recommendation.session_name.replace(' workout', '')}</h2>
            </div>
            <span style={{ background: categoryColors[recommendation.category] }} />
          </div>
          <p>{recommendation.reason}</p>
          <div className="frequency-chips" aria-label="Seven-day muscle frequency">
            {recommendation.muscle_frequency.map((item) => (
              <span
                className={
                  item.sessions_last_7_days < item.target_sessions ? 'needs-attention' : 'on-target'
                }
                key={item.muscle_group}
              >
                {item.muscle_group}{' '}
                <b>
                  {item.sessions_last_7_days}/{item.target_sessions}
                </b>
              </span>
            ))}
          </div>
          <button
            type="button"
            onClick={() => {
              setCategory(recommendation.category);
              setName(recommendation.session_name);
            }}
          >
            Use {recommendation.session_name}
          </button>
        </section>
      )}

      <section className="workout-details panel">
        <input
          className="workout-name-input"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Name this workout"
        />
        <div className="details-row">
          <label>
            Date
            <input
              type="date"
              value={workoutDate}
              onChange={(event) => setWorkoutDate(event.target.value)}
            />
          </label>
          <label>
            Workout type
            <select
              value={category}
              onChange={(event) => setCategory(event.target.value as WorkoutCategory)}
            >
              {Object.entries(categoryNames).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          {initialWorkout && (
            <fieldset className="workout-duration-editor">
              <legend>Duration</legend>
              <label>
                Hours
                <input
                  type="number"
                  min="0"
                  max="24"
                  inputMode="numeric"
                  value={editedDurationHours}
                  onChange={(event) => {
                    const hours = Number.isNaN(event.target.valueAsNumber)
                      ? 0
                      : event.target.valueAsNumber;
                    setEditedDurationMinutes(
                      Math.min(1440, Math.max(0, Math.floor(hours)) * 60 + editedDurationRemainder),
                    );
                  }}
                  aria-label="Workout duration hours"
                />
              </label>
              <label>
                Minutes
                <input
                  type="number"
                  min="0"
                  max="59"
                  inputMode="numeric"
                  value={editedDurationRemainder}
                  onChange={(event) => {
                    const minutes = Number.isNaN(event.target.valueAsNumber)
                      ? 0
                      : event.target.valueAsNumber;
                    setEditedDurationMinutes(
                      Math.min(
                        1440,
                        editedDurationHours * 60 + Math.min(59, Math.max(0, Math.floor(minutes))),
                      ),
                    );
                  }}
                  aria-label="Workout duration minutes"
                />
              </label>
            </fieldset>
          )}
        </div>
        <div className="workout-summary-metrics" aria-label="Workout totals">
          <span>
            <small>Time</small>
            <strong>{formatDuration(displayedDurationSeconds)}</strong>
          </span>
          {currentBodyweight !== null && (
            <span>
              <small>BW</small>
              <strong>{currentBodyweight} kg</strong>
            </span>
          )}
          <span>
            <small>Sets</small>
            <strong>{completedSets.length}</strong>
          </span>
          <span>
            <small>Reps</small>
            <strong>{completedReps}</strong>
          </span>
          <span>
            <small>Volume</small>
            <strong>{completedVolume.toLocaleString()} kg</strong>
          </span>
        </div>
      </section>

      {categoryNotice && (
        <div className="workout-category-notice" role="status">
          <span aria-hidden="true">✓</span>
          <div>
            <strong>Workout updated</strong>
            <p>{categoryNotice}</p>
          </div>
          <button
            type="button"
            onClick={() => setCategoryNotice(null)}
            aria-label="Dismiss workout update"
          >
            ×
          </button>
        </div>
      )}

      {error && <p className="inline-error">{error}</p>}

      <div className="movement-stack">
        {movements.map((movement, movementIndex) => (
          <MovementCard
            key={movement.key}
            movement={movement}
            number={movementIndex + 1}
            prBadges={prBadges.get(movement.key) ?? new Map()}
            supersetLabel={
              movement.supersetKey
                ? `Superset ${movements
                    .filter((item) => item.supersetKey === movement.supersetKey)
                    .map((item) => item.exercise.name)
                    .join(' + ')}`
                : null
            }
            currentBodyweight={currentBodyweight}
            history={recentExerciseHistory(
              historicalWorkouts,
              movement.exercise.id,
              initialWorkout?.id,
            )}
            onExerciseHistory={() => onExerciseHistory(movement.exercise.id)}
            onUpdateSet={(setKey, update) => updateSet(movement.key, setKey, update)}
            onToggleSet={(item) => toggleSet(movement, item)}
            onAddSet={(count, update) => addSet(movement, count, update)}
            onSwitch={() => {
              setSwitchingMovementKey(movement.key);
              setPickerOpen(true);
            }}
            onRemove={() => removeMovement(movement.key)}
            onMoveUp={() => moveMovement(movementIndex, -1)}
            onMoveDown={() => moveMovement(movementIndex, 1)}
            canMoveUp={movementIndex > 0}
            canMoveDown={movementIndex < movements.length - 1}
            onMoveSet={(index, direction) => moveSet(movement.key, index, direction)}
            onDeleteSet={(index) => deleteSet(movement, index)}
            onSuperset={(button) => openSupersetPicker(movement.key, button)}
            onMachinePhotos={(machinePhotoIds) =>
              setMovements((current) =>
                current.map((item) =>
                  item.key === movement.key
                    ? { ...item, machinePhotoIds, machinePhotosInitialized: true }
                    : item,
                ),
              )
            }
            onMovementNotes={(value) =>
              setMovements((current) =>
                current.map((item) =>
                  item.key === movement.key ? { ...item, notes: value } : item,
                ),
              )
            }
          />
        ))}
      </div>

      {undoDeletion && (
        <div className="inline-undo panel" role="status">
          <span>Set deleted</span>
          <button type="button" onClick={undoSetDeletion}>
            Undo
          </button>
          <button
            type="button"
            onClick={() => setUndoDeletion(null)}
            aria-label="Dismiss set deletion notification"
          >
            Dismiss
          </button>
        </div>
      )}
      <button
        className="add-exercise-button"
        type="button"
        onClick={() => {
          setSwitchingMovementKey(null);
          setPickerOpen(true);
        }}
      >
        ＋ Add exercise
      </button>
      <label className="workout-notes panel">
        Workout notes
        <textarea
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          placeholder="How did the session feel? Anything to remember next time?"
          rows={3}
        />
      </label>
      <button
        className="primary-action finish-workout-bottom"
        disabled={saving}
        onClick={() => void finishWorkout()}
      >
        {saving ? 'Saving…' : initialWorkout ? 'Save workout' : 'Finish workout'}
      </button>

      {closeConfirmationOpen && (
        <WorkoutCloseDialog
          editing={Boolean(initialWorkout)}
          onCancel={() => {
            setCloseConfirmationOpen(false);
            window.requestAnimationFrame(() => closeButtonRef.current?.focus());
          }}
          onConfirm={onClose}
        />
      )}

      {pickerOpen && (
        <ExercisePicker
          key={switchingMovementKey ? `switch-${switchingMovementKey}` : 'add-exercises'}
          exercises={exercises}
          excludedIds={movements.map((item) => item.exercise.id)}
          recentExerciseIds={recentExerciseIds}
          onFavoriteChange={onExerciseFavorite}
          singleSelect={switchingMovementKey !== null}
          onChoose={switchingMovementKey ? switchExercise : addExercises}
          onCreateSuperset={(selected) => addExercises(selected, true)}
          onClose={closeExercisePicker}
        />
      )}

      {supersetPickerKey && (
        <SupersetPicker
          key={supersetPickerKey}
          movementKey={supersetPickerKey}
          movements={movements}
          onClose={closeSupersetPicker}
          onSave={(partnerKeys) => saveSuperset(supersetPickerKey, partnerKeys)}
          onRemove={() => removeSuperset(supersetPickerKey)}
        />
      )}
    </section>
  );
}

function SupersetPicker({
  movementKey,
  movements,
  onClose,
  onSave,
  onRemove,
}: {
  movementKey: string;
  movements: DraftMovement[];
  onClose: () => void;
  onSave: (partnerKeys: string[]) => void;
  onRemove: () => void;
}) {
  const movement = movements.find((item) => item.key === movementKey);
  const candidates = movements.filter((item) => item.key !== movementKey);
  const [selectedKeys, setSelectedKeys] = useState<string[]>(() =>
    movement?.supersetKey
      ? candidates
          .filter((item) => item.supersetKey === movement.supersetKey)
          .map((item) => item.key)
      : [],
  );
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const root = document.getElementById('root');
    const rootWasInert = root?.hasAttribute('inert') ?? false;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    root?.setAttribute('inert', '');
    closeButtonRef.current?.focus();

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCloseRef.current();
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      if (!rootWasInert) root?.removeAttribute('inert');
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, []);

  if (!movement) return null;

  const selected = new Set(selectedKeys);
  const toggleSelection = (key: string) => {
    setSelectedKeys((current) =>
      current.includes(key) ? current.filter((item) => item !== key) : [...current, key],
    );
  };

  return createPortal(
    <div
      className="modal-backdrop superset-picker-backdrop"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="superset-picker panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="superset-picker-title"
        aria-describedby="superset-picker-description"
      >
        <header>
          <h2 id="superset-picker-title">Add Group</h2>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            aria-label="Close superset picker"
          >
            ×
          </button>
        </header>
        <p id="superset-picker-description">
          Alternate exercises in a superset/circuit.
        </p>

        <div className="superset-options" aria-label="Exercises in this workout">
          {candidates.length === 0 ? (
            <div className="superset-empty">
              <strong>No other exercises yet</strong>
              <span>Add another exercise to this workout, then come back to group it.</span>
            </div>
          ) : (
            candidates.map((candidate) => {
              const belongsToAnotherGroup = Boolean(
                candidate.supersetKey && candidate.supersetKey !== movement.supersetKey,
              );
              const isSelected = selected.has(candidate.key);
              return (
                <label
                  className={`superset-option ${isSelected ? 'selected' : ''} ${
                    belongsToAnotherGroup ? 'unavailable' : ''
                  }`}
                  key={candidate.key}
                >
                  <input
                    type="checkbox"
                    checked={isSelected}
                    disabled={belongsToAnotherGroup}
                    onChange={() => toggleSelection(candidate.key)}
                  />
                  <span className="superset-option-copy">
                    <strong>{candidate.exercise.name}</strong>
                  </span>
                  {belongsToAnotherGroup && (
                    <small className="superset-option-status">Already grouped</small>
                  )}
                </label>
              );
            })
          )}
        </div>

        <footer>
          {movement.supersetKey && (
            <button className="remove-superset-button" type="button" onClick={onRemove}>
              Remove group
            </button>
          )}
          <div className="superset-picker-actions">
            <button
              className="save-superset-button"
              type="button"
              disabled={selectedKeys.length === 0}
              onClick={() => onSave(selectedKeys)}
            >
              {movement.supersetKey ? 'Update Group' : 'Add Group'}
            </button>
            <button type="button" onClick={onClose}>
              Close
            </button>
          </div>
        </footer>
      </section>
    </div>,
    document.body,
  );
}

function WorkoutCloseDialog({
  editing,
  onCancel,
  onConfirm,
}: {
  editing: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const safeButtonRef = useRef<HTMLButtonElement>(null);
  const onCancelRef = useRef(onCancel);

  useEffect(() => {
    onCancelRef.current = onCancel;
  }, [onCancel]);

  useEffect(() => {
    const root = document.getElementById('root');
    const rootWasInert = root?.hasAttribute('inert') ?? false;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    root?.setAttribute('inert', '');
    safeButtonRef.current?.focus();

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancelRef.current();
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      if (!rootWasInert) root?.removeAttribute('inert');
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, []);

  return createPortal(
    <div
      className="modal-backdrop workout-close-backdrop"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <section
        className="workout-close-dialog panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="workout-close-title"
        aria-describedby="workout-close-description"
      >
        <div className="workout-close-warning" aria-hidden="true">
          !
        </div>
        <p className="section-kicker">PLEASE CONFIRM</p>
        <h2 id="workout-close-title">
          {editing ? 'Discard your changes?' : 'Discard this workout?'}
        </h2>
        <p id="workout-close-description">
          {editing
            ? 'Your recent edits will be lost. The previously saved workout will stay in your history.'
            : 'Your unsaved sets and notes will be removed. This cannot be undone.'}
        </p>
        <div className="workout-close-actions">
          <button ref={safeButtonRef} type="button" onClick={onCancel}>
            {editing ? 'Keep editing' : 'Keep workout'}
          </button>
          <button className="discard-workout-button" type="button" onClick={onConfirm}>
            {editing ? 'Discard changes' : 'Discard workout'}
          </button>
        </div>
      </section>
    </div>,
    document.body,
  );
}

function ExerciseIcon({ exercise, number }: { exercise: Exercise; number?: number }) {
  const label = `${exercise.name} ${exercise.muscle_group}`.toLowerCase();
  const kind =
    exercise.kind === 'cardio'
      ? 'cardio'
      : label.includes('squat') || label.includes('leg')
        ? 'lower'
        : label.includes('press') || label.includes('fly')
          ? 'press'
          : label.includes('row') || label.includes('pull')
            ? 'pull'
            : 'strength';
  return (
    <span className={`exercise-icon exercise-icon-${kind}`} aria-hidden="true">
      <svg viewBox="0 0 32 32" focusable="false">
        {kind === 'cardio' ? (
          <>
            <path d="M7 24c4-7 6-10 9-10s4 4 9 4" />
            <circle cx="16" cy="7" r="3" />
          </>
        ) : kind === 'lower' ? (
          <>
            <path d="M8 8h16M10 6v4M22 6v4M12 11l4 6 6 3M16 17l-4 9M17 18l5 8" />
          </>
        ) : kind === 'press' ? (
          <>
            <path d="M5 9v14M27 9v14M5 16h22M10 13v6M22 13v6" />
            <circle cx="16" cy="23" r="3" />
          </>
        ) : kind === 'pull' ? (
          <>
            <path d="M5 7h22M8 5v4M24 5v4M16 8v8M16 16l-6 8M16 16l6 8" />
            <circle cx="16" cy="13" r="3" />
          </>
        ) : (
          <>
            <path d="M5 16h22M8 12v8M24 12v8M12 14v4M20 14v4" />
          </>
        )}
      </svg>
      {number !== undefined && <b>{number}</b>}
    </span>
  );
}

function MovementCard({
  movement,
  number,
  currentBodyweight,
  history,
  onExerciseHistory,
  onUpdateSet,
  onToggleSet,
  onAddSet,
  onSwitch,
  onRemove,
  onMachinePhotos,
  onMovementNotes,
  prBadges,
  supersetLabel,
  onMoveUp,
  onMoveDown,
  canMoveUp,
  canMoveDown,
  onMoveSet,
  onDeleteSet,
  onSuperset,
}: {
  movement: DraftMovement;
  number: number;
  currentBodyweight: number | null;
  history: ExerciseHistoryEntry[];
  onExerciseHistory: () => void;
  onUpdateSet: (setKey: string, update: Partial<DraftSet>) => void;
  onToggleSet: (item: DraftSet) => void;
  onAddSet: (count: number, update: Partial<DraftSet>) => void;
  onSwitch: () => void;
  onRemove: () => void;
  onMachinePhotos: (photoIds: string[]) => void;
  onMovementNotes: (value: string) => void;
  prBadges: Map<string, string[]>;
  supersetLabel: string | null;
  onMoveUp: () => void;
  onMoveDown: () => void;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onMoveSet: (index: number, direction: -1 | 1) => void;
  onDeleteSet: (index: number) => void;
  onSuperset: (button: HTMLButtonElement) => void;
}) {
  const cardio = movement.exercise.kind === 'cardio';
  const treadmill =
    cardio && (movement.exercise.equipment?.toLowerCase().includes('treadmill') ?? false);
  const completedWorkingSetCount = movement.sets.filter(isCompletedWorkingSet).length;
  const [expanded] = useState(true);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [addSetOpen, setAddSetOpen] = useState(false);
  const [openSetActionsKey, setOpenSetActionsKey] = useState<string | null>(null);
  const movementMenuRef = useRef<HTMLDetailsElement>(null);
  const movementNoteRef = useRef<HTMLInputElement>(null);

  function closeMovementMenu() {
    if (movementMenuRef.current) movementMenuRef.current.open = false;
  }

  function toggleSetActionsFromSummary(trigger: HTMLElement, setKey: string) {
    const setDetails = trigger.closest('.set-details');
    if (setDetails instanceof HTMLDetailsElement) setDetails.open = true;
    setOpenSetActionsKey((current) => (current === setKey ? null : setKey));
  }

  return (
    <article
      className={`movement-card panel ${expanded ? '' : 'is-collapsed'} ${supersetLabel ? 'superset-card' : ''}`}
    >
      {supersetLabel && <div className="superset-ribbon">{supersetLabel}</div>}
      <header>
        <ExerciseIcon exercise={movement.exercise} number={number} />
        <div>
          <h2>
            <button
              type="button"
              className="movement-history-link"
              onClick={onExerciseHistory}
              aria-label={`View full history for ${movement.exercise.name}`}
            >
              {movement.exercise.name}
            </button>
          </h2>
          <p>
            {movement.exercise.muscle_group} · {movement.exercise.equipment}
            {currentBodyweight !== null && ` · @ ${currentBodyweight} kg`}
          </p>
          {!expanded && (
            <span className="movement-completed-summary">
              {completedWorkingSetCount} completed working{' '}
              {completedWorkingSetCount === 1 ? 'set' : 'sets'}
            </span>
          )}
        </div>
        <details className="movement-overflow" ref={movementMenuRef}>
          <summary aria-label={`Actions for ${movement.exercise.name}`}>⋮</summary>
          <div className="movement-overflow-menu">
            <button
              type="button"
              onClick={() => {
                setHistoryOpen((current) => !current);
                closeMovementMenu();
              }}
            >
              <span aria-hidden="true">▰</span>
              {historyOpen ? 'Hide Recent History' : 'Recent History'}
            </button>
            <button
              type="button"
              onClick={() => {
                closeMovementMenu();
                window.requestAnimationFrame(() => movementNoteRef.current?.focus());
              }}
            >
              <span aria-hidden="true">✎</span>
              Edit Notes
            </button>
            <button
              type="button"
              className={supersetLabel ? 'active' : ''}
              onClick={(event) => {
                closeMovementMenu();
                onSuperset(event.currentTarget);
              }}
              aria-haspopup="dialog"
            >
              <span aria-hidden="true">▰</span>
              {supersetLabel ? 'Edit Group' : 'Group Superset'}
            </button>
            <button
              type="button"
              onClick={() => {
                onSwitch();
                closeMovementMenu();
              }}
            >
              <span aria-hidden="true">⇄</span>
              Switch Exercise
            </button>
            <button
              type="button"
              disabled={!canMoveUp}
              onClick={() => {
                onMoveUp();
                closeMovementMenu();
              }}
            >
              <span aria-hidden="true">↑</span>
              Move Earlier
            </button>
            <button
              type="button"
              disabled={!canMoveDown}
              onClick={() => {
                onMoveDown();
                closeMovementMenu();
              }}
            >
              <span aria-hidden="true">↓</span>
              Move Later
            </button>
            <button
              type="button"
              className="movement-menu-danger"
              onClick={() => {
                onRemove();
                closeMovementMenu();
              }}
            >
              <span aria-hidden="true">■</span>
              Delete
            </button>
          </div>
        </details>
      </header>

      {historyOpen && (
        <section
          className="movement-history"
          aria-label={`${movement.exercise.name} recent history`}
        >
          <header>
            <div>
              <p className="section-kicker">RECENT HISTORY</p>
              <h3>Last performed</h3>
            </div>
          </header>
          {history.length ? (
            history.slice(0, 1).map((entry) => (
              <article className="movement-history-entry" key={entry.workoutId}>
                <header>
                  <strong>{prettyDate(entry.workoutDate)}</strong>
                  <small>{entry.workoutName}</small>
                </header>
                {entry.sets.length > 0 && (
                  <HistorySetFlow sets={entry.sets} personalRecords={[]} />
                )}
                {entry.sets
                  .filter((item) => item.notes)
                  .map((item) => (
                    <small className="movement-history-set-note" key={item.id}>
                      Set {item.order_index + 1}: {item.notes}
                    </small>
                  ))}
                {entry.movementNotes && <MovementNotes notes={entry.movementNotes} />}
              </article>
            ))
          ) : (
            <p className="movement-history-empty">No previous entries for this exercise yet.</p>
          )}
        </section>
      )}

      {!cardio && (
        <MachinePhotoChooser
          exercise={movement.exercise}
          selectedIds={movement.machinePhotoIds}
          autoPinLastUsed={!movement.machinePhotosInitialized}
          onChange={onMachinePhotos}
        />
      )}

      <div className={`set-grid set-grid-${cardio ? 'cardio' : 'strength'}`}>
        <div className="set-grid-head">
          {cardio ? (
            <>
              <span>Set</span>
              <span>MIN</span>
              <span>KM</span>
              <span>RPE</span>
              <span>Done</span>
            </>
          ) : (
            <>
              <span>Weight</span>
              <span>Reps</span>
              <span>&gt; %</span>
              <span>Level</span>
              <span aria-hidden="true" />
            </>
          )}
        </div>
        {movement.sets.map((item, index) => (
          <Fragment key={item.key}>
            <details
              className={`set-details ${item.completed ? 'completed' : ''}`}
              open={!item.completed}
            >
              <summary className="completed-set-summary">
                {cardio ? (
                  <>
                    <span>{index + 1}</span>
                    <strong>{completedSetPerformance(item, true)}</strong>
                    <span>{item.rpe ?? '–'}</span>
                    <b className="completed-set-check">✓</b>
                    <span
                      className="completed-set-menu"
                      role="button"
                      tabIndex={0}
                      aria-label={`Options for set ${index + 1}`}
                      onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        toggleSetActionsFromSummary(event.currentTarget, item.key);
                      }}
                      onKeyDown={(event) => {
                        if (event.key !== 'Enter' && event.key !== ' ') return;
                        event.preventDefault();
                        event.stopPropagation();
                        toggleSetActionsFromSummary(event.currentTarget, item.key);
                      }}
                    >
                      ⋮
                    </span>
                  </>
                ) : (
                  <>
                    <strong className="completed-set-weight">
                      {item.weight_kg === null ? '–' : `${item.weight_kg} kg`}
                      {prBadges.has(item.key) && (
                        <b className="pr-badge" title={prBadges.get(item.key)?.join(', ')}>
                          PR
                        </b>
                      )}
                    </strong>
                    <strong>{item.reps ?? '–'}</strong>
                    <span>
                      {strengthLevelPercent(item) === null
                        ? '–'
                        : `${strengthLevelPercent(item)}%`}
                    </span>
                    <StrengthLevelStars item={item} />
                    <span
                      className="completed-set-menu"
                      role="button"
                      tabIndex={0}
                      aria-label={`Options for set ${index + 1}`}
                      onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        toggleSetActionsFromSummary(event.currentTarget, item.key);
                      }}
                      onKeyDown={(event) => {
                        if (event.key !== 'Enter' && event.key !== ' ') return;
                        event.preventDefault();
                        event.stopPropagation();
                        toggleSetActionsFromSummary(event.currentTarget, item.key);
                      }}
                    >
                      ⋮
                    </span>
                  </>
                )}
              </summary>
              <div
                className={`set-row ${item.completed ? 'completed' : ''} ${item.failed ? 'failed-set' : ''} set-type-${item.set_type ?? 'normal'}`}
              >
                <span className="set-index">
                  {index + 1}
                  {prBadges.has(item.key) && (
                    <b className="pr-badge" title={prBadges.get(item.key)?.join(', ')}>
                      PR
                    </b>
                  )}
                </span>
                {cardio ? (
                  <>
                    <input
                      inputMode="numeric"
                      type="number"
                      min="0"
                      value={
                        item.duration_seconds === null ? '' : Math.round(item.duration_seconds / 60)
                      }
                      onChange={(event) =>
                        onUpdateSet(item.key, {
                          duration_seconds:
                            numberOrNull(event.target.value) === null
                              ? null
                              : Number(event.target.value) * 60,
                        })
                      }
                      aria-label="Duration minutes"
                    />
                    <input
                      inputMode="decimal"
                      type="number"
                      min="0"
                      step="0.1"
                      value={item.distance_km ?? ''}
                      onChange={(event) =>
                        onUpdateSet(item.key, { distance_km: numberOrNull(event.target.value) })
                      }
                      aria-label="Distance kilometres"
                    />
                  </>
                ) : (
                  <>
                    <input
                      inputMode="decimal"
                      type="number"
                      min="0"
                      step="0.5"
                      value={item.weight_kg ?? ''}
                      onChange={(event) =>
                        onUpdateSet(item.key, { weight_kg: numberOrNull(event.target.value) })
                      }
                      aria-label="Weight kilograms"
                    />
                    <input
                      inputMode="numeric"
                      type="number"
                      min="0"
                      value={item.reps ?? ''}
                      onChange={(event) =>
                        onUpdateSet(item.key, { reps: numberOrNull(event.target.value) })
                      }
                      aria-label="Repetitions"
                    />
                  </>
                )}
                <select
                  value={item.rpe ?? ''}
                  onChange={(event) =>
                    onUpdateSet(item.key, { rpe: numberOrNull(event.target.value) })
                  }
                  aria-label="RPE"
                >
                  <option value="">–</option>
                  {[5, 6, 7, 7.5, 8, 8.5, 9, 9.5, 10].map((rpe) => (
                    <option key={rpe} value={rpe}>
                      {rpe}
                    </option>
                  ))}
                </select>
                <button
                  className="complete-set"
                  onClick={() => onToggleSet(item)}
                  aria-label={item.completed ? 'Mark set incomplete' : 'Complete set'}
                >
                  {item.completed ? '✓' : ''}
                </button>
                <div className="set-extras">
                  {treadmill && (
                    <fieldset className="treadmill-set-fields">
                      <legend>Treadmill</legend>
                      <label>
                        Incline %
                        <input
                          inputMode="decimal"
                          type="number"
                          min="0"
                          max="100"
                          step="0.5"
                          value={item.incline_percent ?? ''}
                          onChange={(event) =>
                            onUpdateSet(item.key, {
                              incline_percent: numberOrNull(event.target.value),
                            })
                          }
                          aria-label="Treadmill incline percentage"
                        />
                      </label>
                      <label>
                        Speed km/h
                        <input
                          inputMode="decimal"
                          type="number"
                          min="0"
                          max="100"
                          step="0.1"
                          value={item.speed_kph ?? ''}
                          onChange={(event) =>
                            onUpdateSet(item.key, { speed_kph: numberOrNull(event.target.value) })
                          }
                          aria-label="Treadmill speed kilometres per hour"
                        />
                      </label>
                    </fieldset>
                  )}
                  <label>
                    Type
                    <select
                      value={item.set_type ?? (item.warmup ? 'warmup' : 'normal')}
                      onChange={(event) =>
                        onUpdateSet(item.key, {
                          set_type: event.target.value as DraftSet['set_type'],
                          warmup: event.target.value === 'warmup',
                        })
                      }
                    >
                      <option value="normal">Working</option>
                      <option value="warmup">Warm-up</option>
                      <option value="drop">Drop set</option>
                    </select>
                  </label>
                  <label>
                    Rest
                    <select
                      value={item.rest_seconds ?? 120}
                      onChange={(event) =>
                        onUpdateSet(item.key, { rest_seconds: Number(event.target.value) })
                      }
                    >
                      {restOptions.map((seconds) => (
                        <option key={seconds} value={seconds}>
                          {formatDuration(seconds)}
                        </option>
                      ))}
                    </select>
                  </label>
                  {!cardio && (
                    <label className="failed-toggle">
                      <input
                        type="checkbox"
                        checked={item.failed ?? false}
                        onChange={(event) =>
                          onUpdateSet(item.key, { failed: event.target.checked })
                        }
                      />
                      Failed
                    </label>
                  )}
                  {item.failed && !cardio && (
                    <label>
                      Target reps
                      <input
                        type="number"
                        min="0"
                        inputMode="numeric"
                        value={item.target_reps ?? ''}
                        onChange={(event) =>
                          onUpdateSet(item.key, { target_reps: numberOrNull(event.target.value) })
                        }
                      />
                    </label>
                  )}
                  <input
                    value={item.notes ?? ''}
                    onChange={(event) =>
                      onUpdateSet(item.key, { notes: event.target.value || null })
                    }
                    placeholder="Set note (optional)"
                  />
                  <div
                    className={`set-actions-menu ${item.completed ? 'completed-set-actions' : ''}`}
                  >
                    <button
                      type="button"
                      className="set-actions-trigger"
                      aria-label={`Options for set ${index + 1}`}
                      aria-expanded={openSetActionsKey === item.key}
                      onClick={() =>
                        setOpenSetActionsKey((current) =>
                          current === item.key ? null : item.key,
                        )
                      }
                    >
                      ⋮
                    </button>
                    {openSetActionsKey === item.key && (
                      <div className="set-actions-menu-popover">
                        <button
                          type="button"
                          disabled={index === 0}
                          onClick={() => {
                            onMoveSet(index, -1);
                            setOpenSetActionsKey(null);
                          }}
                        >
                          <span aria-hidden="true">↑</span>
                          Move earlier
                        </button>
                        <button
                          type="button"
                          disabled={index === movement.sets.length - 1}
                          onClick={() => {
                            onMoveSet(index, 1);
                            setOpenSetActionsKey(null);
                          }}
                        >
                          <span aria-hidden="true">↓</span>
                          Move later
                        </button>
                        <button
                          type="button"
                          className="danger"
                          onClick={() => {
                            onDeleteSet(index);
                            setOpenSetActionsKey(null);
                          }}
                        >
                          <span aria-hidden="true">■</span>
                          Delete set
                        </button>
                      </div>
                    )}
                  </div>
                </div>
                {prBadges.has(item.key) && (
                  <div className="pr-callout" role="status">
                    🏆 {prBadges.get(item.key)?.join(' · ')}
                  </div>
                )}
              </div>
            </details>
            {item.completed && item.notes && (
              <div className="completed-set-note">{item.notes}</div>
            )}
            {index < movement.sets.length - 1 && (
              <div className="rest-between" aria-label={`Rest after set ${index + 1}`}>
                <i />
                <span>
                  <b>{formatDuration(item.rest_seconds ?? 120)}</b> rest
                </span>
                <i />
              </div>
            )}
          </Fragment>
        ))}
      </div>
      <button className="add-set-button" onClick={() => setAddSetOpen(true)}>
        ＋ Add set
      </button>
      <input
        ref={movementNoteRef}
        className="movement-note"
        value={movement.notes}
        onChange={(event) => onMovementNotes(event.target.value)}
        placeholder="Exercise note for next time…"
      />
      {addSetOpen && (
        <AddSetDialog
          movement={movement}
          onClose={() => setAddSetOpen(false)}
          onAdd={(count, update) => {
            onAddSet(count, update);
            setAddSetOpen(false);
          }}
        />
      )}
    </article>
  );
}

function AddSetDialog({
  movement,
  onClose,
  onAdd,
}: {
  movement: DraftMovement;
  onClose: () => void;
  onAdd: (count: number, update: Partial<DraftSet>) => void;
}) {
  const previous = movement.sets.at(-1);
  const cardio = movement.exercise.kind === 'cardio';
  const [weight, setWeight] = useState(previous?.weight_kg?.toString() ?? '');
  const [reps, setReps] = useState(previous?.reps?.toString() ?? '');
  const [duration, setDuration] = useState(
    previous?.duration_seconds ? Math.round(previous.duration_seconds / 60).toString() : '',
  );
  const [distance, setDistance] = useState(previous?.distance_km?.toString() ?? '');
  const [count, setCount] = useState('1');
  const [warmup, setWarmup] = useState(false);
  const [dropSet, setDropSet] = useState(false);
  const [rpe, setRpe] = useState(previous?.rpe?.toString() ?? '');
  const [notes, setNotes] = useState('');
  const [showRpe, setShowRpe] = useState(false);
  const [showNotes, setShowNotes] = useState(false);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const root = document.getElementById('root');
    const rootWasInert = root?.hasAttribute('inert') ?? false;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    root?.setAttribute('inert', '');

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCloseRef.current();
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      if (!rootWasInert) root?.removeAttribute('inert');
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, []);

  const submit = () => {
    const setCount = Math.min(20, Math.max(1, Number(count) || 1));
    onAdd(setCount, {
      weight_kg: cardio ? null : numberOrNull(weight),
      reps: cardio ? null : numberOrNull(reps),
      duration_seconds: cardio && numberOrNull(duration) !== null ? Number(duration) * 60 : null,
      distance_km: cardio ? numberOrNull(distance) : null,
      rpe: numberOrNull(rpe),
      notes: notes || null,
      warmup,
      set_type: warmup ? 'warmup' : dropSet ? 'drop' : 'normal',
      completed: false,
    });
  };

  return createPortal(
    <div
      className="modal-backdrop add-set-backdrop"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="add-set-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-set-title"
      >
        <header>
          <h2 id="add-set-title">Add Set</h2>
          <button ref={closeButtonRef} type="button" onClick={onClose} aria-label="Close add set">
            ×
          </button>
        </header>
        <div className="add-set-content">
          <div className="add-set-previous">
            <strong>Previous</strong>
            <div>
              <span>Last</span>
              <span>Set {Math.max(1, movement.sets.length)}</span>
              <span>{previous ? completedSetPerformance(previous, cardio) : 'No previous set'}</span>
            </div>
          </div>
          <div className="add-set-fields">
            {cardio ? (
              <>
                <label>
                  Minutes
                  <input
                    type="number"
                    min="0"
                    inputMode="numeric"
                    value={duration}
                    onChange={(event) => setDuration(event.target.value)}
                  />
                </label>
                <label>
                  Distance
                  <span className="unit-input">
                    <input
                      type="number"
                      min="0"
                      step="0.1"
                      inputMode="decimal"
                      value={distance}
                      onChange={(event) => setDistance(event.target.value)}
                    />
                    <b>km</b>
                  </span>
                </label>
              </>
            ) : (
              <>
                <label>
                  Weight
                  <span className="unit-input">
                    <input
                      type="number"
                      min="0"
                      step="0.5"
                      inputMode="decimal"
                      value={weight}
                      onChange={(event) => setWeight(event.target.value)}
                    />
                    <b>kg</b>
                  </span>
                </label>
                <label>
                  Reps
                  <input
                    type="number"
                    min="0"
                    inputMode="numeric"
                    value={reps}
                    onChange={(event) => setReps(event.target.value)}
                  />
                </label>
              </>
            )}
            <label>
              Sets
              <input
                type="number"
                min="1"
                max="20"
                inputMode="numeric"
                value={count}
                onChange={(event) => setCount(event.target.value)}
              />
            </label>
            {showRpe && (
              <label>
                RPE
                <select value={rpe} onChange={(event) => setRpe(event.target.value)}>
                  <option value="">Optional</option>
                  {[5, 6, 7, 7.5, 8, 8.5, 9, 9.5, 10].map((value) => (
                    <option value={value} key={value}>
                      {value}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {showNotes && (
              <label className="add-set-notes-field">
                Notes
                <input
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                  placeholder="Optional set note"
                />
              </label>
            )}
          </div>
          <div className="add-set-toggles">
            {!cardio && (
              <>
              <label>
                <input
                  type="checkbox"
                  checked={warmup}
                  onChange={(event) => {
                    setWarmup(event.target.checked);
                    if (event.target.checked) setDropSet(false);
                  }}
                />
                Warmup
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={dropSet}
                  onChange={(event) => {
                    setDropSet(event.target.checked);
                    if (event.target.checked) setWarmup(false);
                  }}
                />
                Dropset
              </label>
              </>
            )}
            <button type="button" className={showRpe ? 'active' : ''} onClick={() => setShowRpe((value) => !value)}>
              ＋ RPE
            </button>
            <button type="button" className={showNotes ? 'active' : ''} onClick={() => setShowNotes((value) => !value)}>
              ＋ Notes
            </button>
          </div>
        </div>
        <footer>
          <button type="button" className="add-set-confirm" onClick={submit}>
            Add Set
          </button>
          <button type="button" onClick={onClose}>
            Close
          </button>
        </footer>
      </section>
    </div>,
    document.body,
  );
}

function MachinePhotoChooser({
  exercise,
  selectedIds,
  autoPinLastUsed,
  onChange,
}: {
  exercise: Exercise;
  selectedIds: string[];
  autoPinLastUsed: boolean;
  onChange: (photoIds: string[]) => void;
}) {
  const [photos, setPhotos] = useState<MachinePhoto[]>([]);
  const [pending, setPending] = useState<{ file: File; previewUrl: string } | null>(null);
  const [caption, setCaption] = useState('');
  const [expanded, setExpanded] = useState<MachinePhoto | null>(null);
  const [photoPanelOpen, setPhotoPanelOpen] = useState(false);
  const [choosingReplacement, setChoosingReplacement] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const photoRailRef = useRef<HTMLDivElement>(null);
  const autoPinLastUsedRef = useRef(autoPinLastUsed);
  const onChangeRef = useRef(onChange);
  const selectedIdsRef = useRef(selectedIds);

  useEffect(() => {
    onChangeRef.current = onChange;
    selectedIdsRef.current = selectedIds;
  }, [onChange, selectedIds]);

  useEffect(() => {
    let active = true;
    void Promise.all([
      api.listMachinePhotos(exercise.id),
      autoPinLastUsedRef.current
        ? api.lastUsedMachinePhotos(exercise.id)
        : Promise.resolve([] as MachinePhoto[]),
    ])
      .then(([items, lastUsed]) => {
        if (!active) return;
        setPhotos(items);
        if (autoPinLastUsedRef.current && selectedIdsRef.current.length === 0) {
          onChangeRef.current(lastUsed.map((photo) => photo.id));
        }
      })
      .catch((loadError) => {
        if (active)
          setError(
            loadError instanceof Error ? loadError.message : 'Could not load machine photos.',
          );
      });
    return () => {
      active = false;
    };
  }, [exercise.id]);

  useEffect(
    () => () => {
      if (pending) URL.revokeObjectURL(pending.previewUrl);
    },
    [pending],
  );

  function stagePhoto(file: File | undefined) {
    if (!file) return;
    setError(null);
    setCaption('');
    setPending({ file, previewUrl: URL.createObjectURL(file) });
  }

  async function uploadPhoto() {
    if (!pending || !caption.trim()) {
      setError('Enter the machine name before saving the photo.');
      return;
    }
    setUploading(true);
    setError(null);
    try {
      const photo = await api.uploadMachinePhoto(exercise.id, pending.file, caption.trim());
      setPhotos((current) => [photo, ...current]);
      onChange(choosingReplacement ? [photo.id] : [...new Set([...selectedIds, photo.id])]);
      setChoosingReplacement(false);
      setPending(null);
      setCaption('');
      setPhotoPanelOpen(false);
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : 'Could not save that photo.');
    } finally {
      setUploading(false);
    }
  }

  function togglePhoto(photoId: string) {
    if (choosingReplacement) {
      onChange([photoId]);
      setChoosingReplacement(false);
      return;
    }
    onChange(
      selectedIds.includes(photoId)
        ? selectedIds.filter((current) => current !== photoId)
        : [...selectedIds, photoId],
    );
  }

  async function updatePhoto(photo: MachinePhoto, nextCaption: string) {
    const updated = await api.updateMachinePhoto(photo.id, nextCaption);
    setPhotos((current) => current.map((item) => (item.id === updated.id ? updated : item)));
    setExpanded(updated);
  }

  async function deletePhoto(photo: MachinePhoto) {
    await api.deleteMachinePhoto(photo.id);
    setPhotos((current) => current.filter((item) => item.id !== photo.id));
    onChange(selectedIds.filter((id) => id !== photo.id));
    setExpanded(null);
  }

  function chooseAnotherPhoto() {
    setExpanded(null);
    setChoosingReplacement(true);
    setPhotoPanelOpen(true);
    window.requestAnimationFrame(() => {
      photoRailRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
  }

  const pinnedPhotos = photos.filter((photo) => selectedIds.includes(photo.id));
  const primaryPinnedPhoto = pinnedPhotos[0] ?? null;
  const photoSummary = primaryPinnedPhoto
    ? `${primaryPinnedPhoto.caption}${pinnedPhotos.length > 1 ? ` +${pinnedPhotos.length - 1} more` : ''}`
    : photos.length > 0
      ? `${photos.length} saved · none pinned`
      : 'No equipment photo pinned';

  return (
    <details
      className="machine-photo-picker"
      aria-label={`Machine photos for ${exercise.name}`}
      open={photoPanelOpen}
      onToggle={(event) => setPhotoPanelOpen(event.currentTarget.open)}
    >
      <summary className="machine-photo-summary">
        {primaryPinnedPhoto ? (
          <img src={primaryPinnedPhoto.thumbnail_url} alt="" loading="lazy" />
        ) : (
          <span className="machine-photo-placeholder" aria-hidden="true">
            ⌁
          </span>
        )}
        <span className="machine-photo-summary-copy">
          <strong>Machine used</strong>
          <small>{photoSummary}</small>
        </span>
        {selectedIds.length > 0 && <b>{selectedIds.length} pinned</b>}
        <span className="machine-photo-chevron" aria-hidden="true">
          ⌄
        </span>
      </summary>
      <div className="machine-photo-content">
        <p>Take, choose, or pin equipment photos for every set in this exercise.</p>
        <div className="machine-photo-actions">
          <label>
            <span aria-hidden="true">⌁</span>
            Take photo
            <input
              className="sr-only"
              type="file"
              accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
              capture="environment"
              onChange={(event) => {
                stagePhoto(event.target.files?.[0]);
                event.target.value = '';
              }}
            />
          </label>
          <label>
            <span aria-hidden="true">＋</span>
            Choose photo
            <input
              className="sr-only"
              type="file"
              accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
              onChange={(event) => {
                stagePhoto(event.target.files?.[0]);
                event.target.value = '';
              }}
            />
          </label>
        </div>
        {photos.length > 0 && (
          <>
            {choosingReplacement && (
              <p className="machine-photo-choice-prompt" role="status">
                {photos.length > 1
                  ? 'Choose the machine you are using for this workout.'
                  : 'No other saved photos yet. Use Take photo or Choose photo above to add another machine.'}
              </p>
            )}
            <div className="machine-photo-rail" ref={photoRailRef}>
              {photos.map((photo) => {
                const selected = selectedIds.includes(photo.id);
                return (
                  <article className={selected ? 'selected' : ''} key={photo.id}>
                    <button
                      type="button"
                      className="machine-thumbnail"
                      onClick={() => setExpanded(photo)}
                      aria-label={`Expand ${photo.caption}`}
                    >
                      <img src={photo.thumbnail_url} alt={photo.caption} loading="lazy" />
                    </button>
                    <strong title={photo.caption}>{photo.caption}</strong>
                    <button
                      type="button"
                      className="machine-pin"
                      onClick={() => togglePhoto(photo.id)}
                    >
                      {choosingReplacement
                        ? selected
                          ? 'Currently pinned'
                          : 'Use this machine'
                        : selected
                          ? '✓ Pinned'
                          : 'Pin to sets'}
                    </button>
                  </article>
                );
              })}
            </div>
          </>
        )}
        {error && <p className="machine-photo-error">{error}</p>}

        {pending && (
          <section className="photo-inline-editor panel">
            <button type="button" className="photo-inline-close" onClick={() => setPending(null)}>
              Cancel
            </button>
            <img src={pending.previewUrl} alt="New machine preview" />
            <div>
              <p className="section-kicker">NEW MACHINE PHOTO</p>
              <h2>Name this machine</h2>
              <p>For example: Hammer Strength lying leg curl.</p>
              <input
                autoFocus
                value={caption}
                maxLength={160}
                onChange={(event) => setCaption(event.target.value)}
                placeholder="Machine name"
              />
              <div className="photo-inline-actions">
                <button type="button" onClick={() => setPending(null)} disabled={uploading}>
                  Cancel
                </button>
                <button type="button" onClick={() => void uploadPhoto()} disabled={uploading}>
                  {uploading ? 'Saving…' : 'Save and pin'}
                </button>
              </div>
            </div>
          </section>
        )}
        {expanded && (
          <MachinePhotoDetail
            photo={expanded}
            onClose={() => setExpanded(null)}
            onUpdate={updatePhoto}
            onDelete={deletePhoto}
            onChooseAnother={chooseAnotherPhoto}
          />
        )}
      </div>
    </details>
  );
}

function MachinePhotoDetail({
  photo,
  onClose,
  onUpdate,
  onDelete,
  onChooseAnother,
}: {
  photo: MachinePhoto;
  onClose: () => void;
  onUpdate?: (photo: MachinePhoto, caption: string) => Promise<void>;
  onDelete?: (photo: MachinePhoto) => Promise<void>;
  onChooseAnother?: () => void;
}) {
  const [caption, setCaption] = useState(photo.caption);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function saveCaption() {
    if (!onUpdate || !caption.trim() || caption.trim() === photo.caption) return;
    setSaving(true);
    setError(null);
    try {
      await onUpdate(photo, caption.trim());
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Could not update the caption.');
    } finally {
      setSaving(false);
    }
  }

  async function removePhoto() {
    if (!onDelete) return;
    setSaving(true);
    setError(null);
    try {
      await onDelete(photo);
    } catch (deleteError) {
      setError(
        deleteError instanceof Error
          ? deleteError.message
          : 'Could not delete a photo that is used by a workout.',
      );
      setSaving(false);
    }
  }

  return (
    <section className="photo-detail panel" aria-label={photo.caption}>
      <div>
        <button className="photo-detail-close" type="button" onClick={onClose}>
          Close
        </button>
        <img src={photo.full_url} alt={photo.caption} />
        <div className="photo-detail-caption">
          {onUpdate ? (
            <input
              value={caption}
              maxLength={160}
              onChange={(event) => setCaption(event.target.value)}
            />
          ) : (
            <strong>{photo.caption}</strong>
          )}
          {onUpdate && (
            <button type="button" onClick={() => void saveCaption()} disabled={saving}>
              Save name
            </button>
          )}
          {onChooseAnother && (
            <button type="button" className="photo-choose-other" onClick={onChooseAnother}>
              Switch photo
            </button>
          )}
          {onDelete && (
            <InlineConfirmButton
              className="photo-delete"
              label="Delete"
              confirmLabel="Delete photo"
              onConfirm={removePhoto}
              disabled={saving}
            />
          )}
          {error && <p>{error}</p>}
        </div>
      </div>
    </section>
  );
}

type ExercisePickerFilter = WorkoutCategory | 'all' | 'favorites' | 'recent';

function ExercisePicker({
  exercises,
  excludedIds,
  recentExerciseIds,
  onFavoriteChange,
  singleSelect = false,
  onChoose,
  onCreateSuperset,
  onClose,
}: {
  exercises: Exercise[];
  excludedIds: string[];
  recentExerciseIds: string[];
  onFavoriteChange: (exerciseId: string, isFavorite: boolean) => Promise<void>;
  singleSelect?: boolean;
  onChoose: (exercises: Exercise[]) => void;
  onCreateSuperset?: (exercises: Exercise[]) => void;
  onClose: () => void;
}) {
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<ExercisePickerFilter>('all');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [favoriteSavingIds, setFavoriteSavingIds] = useState<string[]>([]);
  const [pickerError, setPickerError] = useState<string | null>(null);
  const [viewport, setViewport] = useState(() => {
    const visualViewport = window.visualViewport;
    return {
      height: visualViewport?.height ?? window.innerHeight,
      top: visualViewport?.offsetTop ?? 0,
      keyboardVisible: false,
    };
  });
  const listRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const onCloseRef = useRef(onClose);
  const initialViewportHeightRef = useRef(window.visualViewport?.height ?? window.innerHeight);
  const query = search.trim().toLowerCase();
  const available = exercises.filter((exercise) => !excludedIds.includes(exercise.id));
  const recent = recentExerciseIds
    .map((id) => available.find((exercise) => exercise.id === id))
    .filter((exercise): exercise is Exercise => Boolean(exercise));
  const sections: Array<{ title: string; exercises: Exercise[] }> = [];

  if (query) {
    sections.push({
      title: 'Search results',
      exercises: available.filter((exercise) =>
        `${exercise.name} ${exercise.muscle_group} ${exercise.equipment ?? ''}`
          .toLowerCase()
          .includes(query),
      ),
    });
  } else if (filter === 'favorites') {
    sections.push({ title: 'Favorites', exercises: available.filter((item) => item.is_favorite) });
  } else if (filter === 'recent') {
    sections.push({ title: 'Recently used', exercises: recent });
  } else {
    const scoped = available.filter((exercise) => filter === 'all' || exercise.category === filter);
    const favorites = scoped.filter((exercise) => exercise.is_favorite);
    const favoriteIds = new Set(favorites.map((exercise) => exercise.id));
    const recentlyUsed = recent.filter(
      (exercise) => scoped.some((item) => item.id === exercise.id) && !favoriteIds.has(exercise.id),
    );
    const featuredIds = new Set([
      ...favorites.map((exercise) => exercise.id),
      ...recentlyUsed.map((exercise) => exercise.id),
    ]);
    if (favorites.length) sections.push({ title: 'Favorites', exercises: favorites });
    if (recentlyUsed.length) sections.push({ title: 'Recently used', exercises: recentlyUsed });
    sections.push({
      title: filter === 'all' ? 'All exercises' : `${categoryNames[filter]} exercises`,
      exercises: scoped.filter((exercise) => !featuredIds.has(exercise.id)),
    });
  }
  const visibleExerciseCount = sections.reduce(
    (count, section) => count + section.exercises.length,
    0,
  );

  async function toggleFavorite(exercise: Exercise) {
    if (favoriteSavingIds.includes(exercise.id)) return;
    setFavoriteSavingIds((current) => [...current, exercise.id]);
    setPickerError(null);
    try {
      await onFavoriteChange(exercise.id, !exercise.is_favorite);
    } catch (error) {
      setPickerError(error instanceof Error ? error.message : 'Could not update this favorite.');
    } finally {
      setFavoriteSavingIds((current) => current.filter((id) => id !== exercise.id));
    }
  }

  function renderExercise(exercise: Exercise) {
    const selected = selectedIds.includes(exercise.id);
    const nameScore = [...exercise.name].reduce((total, character) => total + character.charCodeAt(0), 0);
    const rating = exercise.is_favorite ? 5 : 3 + (nameScore % 3);
    return (
      <div className={`exercise-option ${selected ? 'selected' : ''}`} key={exercise.id}>
        <button
          type="button"
          className="exercise-option-select"
          aria-pressed={selected}
          onClick={() => {
            setSelectedIds((current) =>
              current.includes(exercise.id)
                ? current.filter((id) => id !== exercise.id)
                : singleSelect
                  ? [exercise.id]
                  : [...current, exercise.id],
            );
            searchRef.current?.blur();
          }}
        >
          <ExerciseIcon exercise={exercise} />
          <span className="exercise-option-copy">
            <strong>{exercise.name}</strong>
            <small className="exercise-option-tags">
              <em>{exercise.muscle_group}</em>
              {exercise.equipment && <em>{exercise.equipment}</em>}
            </small>
          </span>
          <b className="exercise-option-selected">{selected ? '✓' : ''}</b>
        </button>
        <button
          type="button"
          className={`exercise-favorite-button ${exercise.is_favorite ? 'active' : ''}`}
          aria-label={`${exercise.is_favorite ? 'Remove' : 'Add'} ${exercise.name} ${exercise.is_favorite ? 'from' : 'to'} favorites`}
          aria-pressed={exercise.is_favorite}
          disabled={favoriteSavingIds.includes(exercise.id)}
          onClick={() => void toggleFavorite(exercise)}
        >
          <span className="exercise-rating" aria-hidden="true">
            {[0, 1, 2, 3, 4].map((star) => (
              <i className={star < rating ? 'filled' : ''} key={star}>
                ★
              </i>
            ))}
          </span>
        </button>
      </div>
    );
  }

  useEffect(() => {
    listRef.current?.scrollTo({ top: 0 });
  }, [search, filter]);

  useEffect(() => {
    const visualViewport = window.visualViewport;
    const updateViewport = () => {
      const height = visualViewport?.height ?? window.innerHeight;
      const top = visualViewport?.offsetTop ?? 0;
      setViewport({
        height,
        top,
        keyboardVisible: initialViewportHeightRef.current - height > 100,
      });
    };

    updateViewport();
    visualViewport?.addEventListener('resize', updateViewport);
    visualViewport?.addEventListener('scroll', updateViewport);
    window.addEventListener('resize', updateViewport);
    return () => {
      visualViewport?.removeEventListener('resize', updateViewport);
      visualViewport?.removeEventListener('scroll', updateViewport);
      window.removeEventListener('resize', updateViewport);
    };
  }, []);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const root = document.getElementById('root');
    const rootWasInert = root?.hasAttribute('inert') ?? false;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    root?.setAttribute('inert', '');

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCloseRef.current();
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      if (!rootWasInert) root?.removeAttribute('inert');
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, []);

  const pickerHeight = viewport.keyboardVisible
    ? Math.max(280, viewport.height - 12)
    : Math.min(720, viewport.height * 0.84);
  const viewportStyle = {
    '--exercise-picker-viewport-top': `${viewport.top}px`,
    '--exercise-picker-viewport-height': `${viewport.height}px`,
    '--exercise-picker-height': `${pickerHeight}px`,
  } as CSSProperties;

  return createPortal(
    <div
      className="modal-backdrop exercise-picker-backdrop"
      style={viewportStyle}
      onPointerDown={(event) => {
        if (event.target !== event.currentTarget) return;
        event.preventDefault();
        onClose();
      }}
    >
      <section
        className={`exercise-picker panel ${viewport.keyboardVisible ? 'keyboard-visible' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="exercise-picker-title"
      >
        <header>
          <div className="exercise-picker-heading">
            <h2 id="exercise-picker-title">
              {singleSelect ? 'Switch Exercise' : 'Select Exercise'}
            </h2>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>
        <label className="exercise-search-wrap">
          <span aria-hidden="true">⌕</span>
          <input
            ref={searchRef}
            className="exercise-search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search…"
          />
        </label>
        <div className="exercise-filter-selects">
          <select
            aria-label="Body part"
            value={filter === 'favorites' || filter === 'recent' ? 'all' : filter}
            onChange={(event) => setFilter(event.target.value as WorkoutCategory | 'all')}
          >
            <option value="all">Any Body Part</option>
          {(
            ['push', 'pull', 'lower', 'upper', 'full_body', 'cardio', 'other'] as WorkoutCategory[]
          ).map((category) => (
            <option key={category} value={category}>
              {categoryNames[category]}
            </option>
          ))}
          </select>
          <select
            aria-label="Exercise category"
            value={filter === 'favorites' || filter === 'recent' ? filter : 'all'}
            onChange={(event) => setFilter(event.target.value as 'all' | 'favorites' | 'recent')}
          >
            <option value="all">Any Category</option>
            <option value="favorites">Favorites</option>
            <option value="recent">Recently Used</option>
          </select>
        </div>
        <div className="exercise-list" ref={listRef}>
          {sections.map(
            (section) =>
              section.exercises.length > 0 && (
                <section className="exercise-list-section" key={section.title}>
                  <h3>{section.title}</h3>
                  {section.exercises.map(renderExercise)}
                </section>
              ),
          )}
          {!visibleExerciseCount && (
            <p className="muted-empty">
              {filter === 'favorites' && !query
                ? 'Tap the star beside an exercise to add a favorite.'
                : filter === 'recent' && !query
                  ? 'Exercises from completed workouts will appear here.'
                  : 'No exercises match that search.'}
            </p>
          )}
          {pickerError && <p className="inline-error">{pickerError}</p>}
        </div>
        <div className={`exercise-picker-actions ${singleSelect ? 'single-action' : ''}`}>
          {!singleSelect && (
            <button
              className="create-superset-button"
              type="button"
              disabled={selectedIds.length < 2}
              onClick={() =>
                onCreateSuperset?.(
                  exercises.filter((exercise) => selectedIds.includes(exercise.id)),
                )
              }
            >
              Create super set
            </button>
          )}
          <button
            className="add-selected-button"
            type="button"
            disabled={!selectedIds.length}
            onClick={() =>
              onChoose(exercises.filter((exercise) => selectedIds.includes(exercise.id)))
            }
          >
            {singleSelect
              ? 'Switch exercise'
              : `Add selected exercises (${selectedIds.length})`}
          </button>
        </div>
      </section>
    </div>,
    document.body,
  );
}

function RestTimer({
  seconds,
  onAdd,
  onSkip,
}: {
  seconds: number;
  onAdd: () => void;
  onSkip: () => void;
}) {
  return (
    <aside className="rest-timer-inline panel">
      <div>
        <span>REST TIMER</span>
        <strong>{formatDuration(seconds)}</strong>
      </div>
      <button onClick={onAdd}>+30s</button>
      <button onClick={onSkip}>Skip</button>
    </aside>
  );
}

function ProgressScreen({
  exercises,
  currentBodyweight,
  embedded = false,
  initialExerciseId = null,
}: {
  exercises: Exercise[];
  currentBodyweight: number | null;
  embedded?: boolean;
  initialExerciseId?: string | null;
}) {
  const strengthExercises = exercises.filter((exercise) => exercise.kind === 'strength');
  const [exerciseId, setExerciseId] = useState(() =>
    initialExerciseId && strengthExercises.some((exercise) => exercise.id === initialExerciseId)
      ? initialExerciseId
      : (strengthExercises[0]?.id ?? ''),
  );
  const [metric, setMetric] = useState<ProgressMetric>('estimated_1rm');
  const [progress, setProgress] = useState<ExerciseProgress | null>(null);
  const [loading, setLoading] = useState(false);
  const [progressPage, setProgressPage] = useState(1);
  const progressPageCount = Math.max(
    1,
    Math.ceil((progress?.points.length ?? 0) / HISTORY_PAGE_SIZE),
  );
  const pagedProgressPoints = (progress?.points ?? [])
    .slice()
    .reverse()
    .slice((progressPage - 1) * HISTORY_PAGE_SIZE, progressPage * HISTORY_PAGE_SIZE);

  useEffect(() => {
    if (!exerciseId) return;
    setProgressPage(1);
    setLoading(true);
    void api
      .exerciseProgress(exerciseId)
      .then(setProgress)
      .finally(() => setLoading(false));
  }, [exerciseId]);

  useEffect(() => {
    setProgressPage((page) => Math.min(page, progressPageCount));
  }, [progressPageCount]);

  return (
    <section className={`progress-screen ${embedded ? '' : 'content-page'}`}>
      <div className="screen-intro">
        <p className="section-kicker">PERFORMANCE</p>
        <h1>Movement progress</h1>
      </div>
      <section className="panel progress-controls">
        <label>
          Exercise
          <select value={exerciseId} onChange={(event) => setExerciseId(event.target.value)}>
            {strengthExercises.map((exercise) => (
              <option key={exercise.id} value={exercise.id}>
                {exercise.name}
              </option>
            ))}
          </select>
        </label>
        <div className="metric-tabs">
          <button
            className={metric === 'estimated_1rm' ? 'active' : ''}
            onClick={() => setMetric('estimated_1rm')}
          >
            Est. 1RM
          </button>
          <button
            className={metric === 'best_weight_kg' ? 'active' : ''}
            onClick={() => setMetric('best_weight_kg')}
          >
            Top weight
          </button>
          <button
            className={metric === 'volume_kg' ? 'active' : ''}
            onClick={() => setMetric('volume_kg')}
          >
            Volume
          </button>
        </div>
      </section>
      {metric === 'estimated_1rm' && <p className="metric-note">Epley formula</p>}
      {loading && <LoadingState />}
      {!loading && progress && (
        <>
          <div className="progress-pbs">
            <MetricCard
              value={`${progress.personal_best_weight_kg} kg`}
              label="Heaviest set"
              suffix="personal best"
            />
            <MetricCard
              value={`${progress.personal_best_estimated_1rm} kg`}
              label="Estimated 1RM"
              suffix="personal best"
            />
          </div>
          <section className="panel chart-panel">
            <div className="panel-heading">
              <div>
                <p className="section-kicker">TREND</p>
                <h2>
                  {progress.exercise.name}
                  {currentBodyweight !== null && ` @ ${currentBodyweight} kg`}
                </h2>
              </div>
              <small>{progress.points.length} sessions</small>
            </div>
            {progress.points.length ? (
              <ProgressChart progress={progress} metric={metric} />
            ) : (
              <EmptyState
                title="No data yet"
                body="Complete this exercise in a workout to start its progress graph."
              />
            )}
          </section>
          {pagedProgressPoints.map((point) => (
            <article className="progress-row" key={point.workout_id}>
              <div>
                <strong>{prettyDate(point.workout_date)}</strong>
                <small>
                  {point.best_reps} reps · RPE {point.best_rpe ?? '–'}
                </small>
              </div>
              <strong>
                {metric === 'volume_kg'
                  ? Math.round(point[metric]).toLocaleString()
                  : point[metric]}{' '}
                kg
              </strong>
            </article>
          ))}
          <PaginationControls
            currentPage={progressPage}
            totalPages={progressPageCount}
            onPageChange={setProgressPage}
            label="exercise history"
          />
        </>
      )}
    </section>
  );
}

function ProgressChart({
  progress,
  metric,
}: {
  progress: ExerciseProgress;
  metric: ProgressMetric;
}) {
  const [activePointIndex, setActivePointIndex] = useState<number | null>(null);
  const values = progress.points.map((point) => point[metric]);
  const maximum = Math.max(...values, 1);
  const minimum = Math.min(...values, 0);
  const width = 340;
  const height = 190;
  const left = 42;
  const right = 10;
  const top = 12;
  const bottom = 34;
  const points = values.map((value, index) => {
    const x = left + (index / Math.max(values.length - 1, 1)) * (width - left - right);
    const y =
      height -
      bottom -
      ((value - minimum) / Math.max(maximum - minimum, 1)) * (height - top - bottom);
    return { x, y, value };
  });
  const yTicks = [minimum, (minimum + maximum) / 2, maximum];
  const xIndexes = [...new Set([0, Math.floor((values.length - 1) / 2), values.length - 1])];
  const activeChartPoint = activePointIndex === null ? null : (points[activePointIndex] ?? null);
  const activeProgressPoint =
    activePointIndex === null ? null : (progress.points[activePointIndex] ?? null);
  const metricLabel =
    metric === 'estimated_1rm' ? 'Est. 1RM' : metric === 'best_weight_kg' ? 'Top weight' : 'Volume';
  const formattedActiveValue = activeChartPoint
    ? metric === 'volume_kg'
      ? Math.round(activeChartPoint.value).toLocaleString()
      : Number(activeChartPoint.value.toFixed(1)).toLocaleString()
    : '';
  const tooltipWidth = 132;
  const tooltipHeight = 44;
  const tooltipX = activeChartPoint
    ? Math.min(width - right - tooltipWidth, Math.max(left, activeChartPoint.x - tooltipWidth / 2))
    : 0;
  const tooltipY = activeChartPoint ? Math.max(3, activeChartPoint.y - tooltipHeight - 8) : 0;

  function selectPointAtClientX(clientX: number, svg: SVGSVGElement) {
    const bounds = svg.getBoundingClientRect();
    if (bounds.width === 0) return;
    const chartX = ((clientX - bounds.left) / bounds.width) * width;
    setActivePointIndex(nearestChartPointIndex(chartX, left, width - right, points.length));
  }

  return (
    <div className="chart-wrap">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={`${progress.exercise.name} ${metricLabel} progress chart. Drag horizontally to inspect each session.`}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          selectPointAtClientX(event.clientX, event.currentTarget);
        }}
        onPointerMove={(event) => {
          if (
            event.pointerType === 'mouse' ||
            event.currentTarget.hasPointerCapture(event.pointerId)
          ) {
            selectPointAtClientX(event.clientX, event.currentTarget);
          }
        }}
        onPointerUp={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId);
          }
        }}
        onPointerCancel={() => setActivePointIndex(null)}
        onPointerLeave={(event) => {
          if (event.pointerType === 'mouse') setActivePointIndex(null);
        }}
      >
        <defs>
          <linearGradient id="chart-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#e14a3b" stopOpacity="0.28" />
            <stop offset="1" stopColor="#e14a3b" stopOpacity="0" />
          </linearGradient>
        </defs>
        {yTicks.map((tick) => {
          const y =
            height -
            bottom -
            ((tick - minimum) / Math.max(maximum - minimum, 1)) * (height - top - bottom);
          return (
            <g className="chart-axis" key={tick}>
              <line x1={left} x2={width - right} y1={y} y2={y} />
              <text x={left - 5} y={y + 3} textAnchor="end">
                {metric === 'volume_kg' ? Math.round(tick).toLocaleString() : tick.toFixed(1)}
              </text>
            </g>
          );
        })}
        <line className="chart-axis-line" x1={left} x2={left} y1={top} y2={height - bottom} />
        <line
          className="chart-axis-line"
          x1={left}
          x2={width - right}
          y1={height - bottom}
          y2={height - bottom}
        />
        <path
          className="chart-area"
          d={`M ${points[0].x} ${height - bottom} ${points.map((point) => `L ${point.x} ${point.y}`).join(' ')} L ${points.at(-1)!.x} ${height - bottom} Z`}
        />
        <polyline points={points.map((point) => `${point.x},${point.y}`).join(' ')} />
        {points.map((point, index) => (
          <circle key={index} cx={point.x} cy={point.y} r="4" />
        ))}
        {xIndexes.map((index) => (
          <text
            className="chart-x-label"
            key={index}
            x={points[index].x}
            y={height - 11}
            textAnchor={index === 0 ? 'start' : index === values.length - 1 ? 'end' : 'middle'}
          >
            {new Date(`${progress.points[index].workout_date}T12:00:00`).toLocaleDateString(
              undefined,
              { month: 'short', day: 'numeric' },
            )}
          </text>
        ))}
        <text className="chart-y-title" x="4" y="10">
          {metric === 'volume_kg' ? 'Volume (kg)' : 'Weight (kg)'}
        </text>
        {activeChartPoint && activeProgressPoint && (
          <g className="exercise-chart-selection" aria-hidden="true">
            <line
              className="selection-guide"
              x1={activeChartPoint.x}
              x2={activeChartPoint.x}
              y1={top}
              y2={height - bottom}
            />
            <circle
              className="selected-exercise-point"
              cx={activeChartPoint.x}
              cy={activeChartPoint.y}
              r="6"
            />
            <g className="exercise-chart-tooltip">
              <rect x={tooltipX} y={tooltipY} width={tooltipWidth} height={tooltipHeight} rx="6" />
              <text x={tooltipX + 8} y={tooltipY + 12}>
                <tspan className="tooltip-date">
                  {new Date(`${activeProgressPoint.workout_date}T12:00:00`).toLocaleDateString(
                    undefined,
                    { month: 'short', day: 'numeric', year: 'numeric' },
                  )}
                </tspan>
                <tspan className="tooltip-value" x={tooltipX + 8} dy="11">
                  {metricLabel} {formattedActiveValue} kg
                </tspan>
                <tspan className="tooltip-detail" x={tooltipX + 8} dy="10">
                  {activeProgressPoint.best_reps} reps
                  {activeProgressPoint.best_rpe === null
                    ? ''
                    : ` · RPE ${activeProgressPoint.best_rpe}`}
                </tspan>
              </text>
            </g>
          </g>
        )}
      </svg>
      <p className="sr-only" aria-live="polite">
        {activeProgressPoint
          ? `${prettyDate(activeProgressPoint.workout_date)}: ${metricLabel} ${formattedActiveValue} kilograms, ${activeProgressPoint.best_reps} reps${activeProgressPoint.best_rpe === null ? '' : `, RPE ${activeProgressPoint.best_rpe}`}`
          : ''}
      </p>
    </div>
  );
}

function BodyCompositionScreen({
  measurements,
  trainingMode,
  onSave,
  onDelete,
  onTrainingMode,
  onDataChange,
}: {
  measurements: BodyMeasurement[];
  trainingMode: TrainingMode;
  onSave: (payload: {
    measurement_date: string;
    weight_kg: number;
    body_fat_pct: number | null;
    notes: string | null;
  }) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onTrainingMode: (mode: TrainingMode) => Promise<void>;
  onDataChange: () => Promise<void>;
}) {
  const [measurementDate, setMeasurementDate] = useState(localDate());
  const [entryOpen, setEntryOpen] = useState(false);
  const [goalOpen, setGoalOpen] = useState(false);
  const [weight, setWeight] = useState('');
  const [bodyFat, setBodyFat] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [goals, setGoals] = useState<BodyWeightGoal[]>([]);
  const [phases, setPhases] = useState<TrainingPhase[]>([]);
  const [goalTarget, setGoalTarget] = useState('');
  const [goalDate, setGoalDate] = useState('');
  const [savingGoal, setSavingGoal] = useState(false);
  const [changingMode, setChangingMode] = useState(false);
  const [editingMeasurement, setEditingMeasurement] = useState<BodyMeasurement | null>(null);
  const [editWeight, setEditWeight] = useState('');
  const [editBodyFat, setEditBodyFat] = useState('');
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const bodyCsvInput = useRef<HTMLInputElement>(null);
  const [importingBodyCsv, setImportingBodyCsv] = useState(false);
  const [exportingBodyCsv, setExportingBodyCsv] = useState(false);
  const [bodyCsvMessage, setBodyCsvMessage] = useState<string | null>(null);
  const [bodyCsvError, setBodyCsvError] = useState<string | null>(null);
  const [checkInPage, setCheckInPage] = useState(1);
  const checkInPageCount = Math.max(1, Math.ceil(measurements.length / HISTORY_PAGE_SIZE));
  const pagedMeasurements = measurements.slice(
    (checkInPage - 1) * HISTORY_PAGE_SIZE,
    checkInPage * HISTORY_PAGE_SIZE,
  );
  const latest = measurements[0];
  const activeGoal = goals.find((goal) => goal.active) ?? null;
  const targetWeight = Number(goalTarget);
  const hasValidTarget =
    goalTarget.trim() !== '' && Number.isFinite(targetWeight) && targetWeight > 0;

  useEffect(() => {
    setCheckInPage((page) => Math.min(page, checkInPageCount));
  }, [checkInPageCount]);
  const inferredGoalMode =
    latest && hasValidTarget ? trainingModeForWeightTarget(latest.weight_kg, targetWeight) : null;
  const maintenanceMinimum = latest
    ? Number((latest.weight_kg * (1 - maintenanceWeightRangeRatio)).toFixed(1))
    : null;
  const maintenanceMaximum = latest
    ? Number((latest.weight_kg * (1 + maintenanceWeightRangeRatio)).toFixed(1))
    : null;

  useEffect(() => {
    void Promise.all([api.listBodyWeightGoals(), api.listTrainingPhases()])
      .then(([nextGoals, nextPhases]) => {
        setGoals(nextGoals);
        setPhases(nextPhases);
      })
      .catch((reason) =>
        setError(reason instanceof Error ? reason.message : 'Could not load body-weight goals.'),
      );
  }, []);

  async function changeTrainingMode(mode: TrainingMode) {
    if (mode === trainingMode || changingMode) return;
    setChangingMode(true);
    setError(null);
    try {
      await onTrainingMode(mode);
      setPhases(await api.listTrainingPhases());
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not load training phases.');
    } finally {
      setChangingMode(false);
    }
  }

  async function saveGoal() {
    if (!latest || !hasValidTarget || !goalDate || !inferredGoalMode) {
      setError('Log a current weight, target weight, and target date first.');
      return;
    }
    setSavingGoal(true);
    setError(null);
    try {
      const goal = await api.createBodyWeightGoal({
        start_date: localDate(),
        target_date: goalDate,
        start_weight_kg: latest.weight_kg,
        target_weight_kg: targetWeight,
        mode: inferredGoalMode,
        active: true,
      });
      setGoals((current) => [goal, ...current.map((item) => ({ ...item, active: false }))]);
      setPhases(await api.listTrainingPhases());
      await onDataChange();
      setGoalTarget('');
      setGoalDate('');
      setGoalOpen(false);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Could not save this target.');
    } finally {
      setSavingGoal(false);
    }
  }

  async function submitMeasurement() {
    const weightValue = Number(weight);
    if (!weightValue || weightValue <= 0) {
      setError('Enter your body weight in kilograms.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onSave({
        measurement_date: measurementDate,
        weight_kg: weightValue,
        body_fat_pct: bodyFat ? Number(bodyFat) : null,
        notes: notes.trim() || null,
      });
      setWeight('');
      setBodyFat('');
      setNotes('');
      setEntryOpen(false);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Could not save this measurement.');
    } finally {
      setSaving(false);
    }
  }

  function beginMeasurementEdit(measurement: BodyMeasurement) {
    setEditingMeasurement(measurement);
    setEditWeight(String(measurement.weight_kg));
    setEditBodyFat(measurement.body_fat_pct === null ? '' : String(measurement.body_fat_pct));
    setEditError(null);
  }

  async function submitMeasurementEdit() {
    if (!editingMeasurement) return;
    const weightValue = Number(editWeight);
    const bodyFatValue = editBodyFat.trim() ? Number(editBodyFat) : null;
    if (!Number.isFinite(weightValue) || weightValue <= 0 || weightValue > 500) {
      setEditError('Enter a body weight between 1 and 500 kg.');
      return;
    }
    if (
      bodyFatValue !== null &&
      (!Number.isFinite(bodyFatValue) || bodyFatValue < 1 || bodyFatValue > 70)
    ) {
      setEditError('Enter a body-fat percentage between 1 and 70, or leave it blank.');
      return;
    }
    setEditSaving(true);
    setEditError(null);
    try {
      await onSave({
        measurement_date: editingMeasurement.measurement_date,
        weight_kg: weightValue,
        body_fat_pct: bodyFatValue,
        notes: editingMeasurement.notes,
      });
      setEditingMeasurement(null);
    } catch (saveError) {
      setEditError(
        saveError instanceof Error ? saveError.message : 'Could not update this check-in.',
      );
    } finally {
      setEditSaving(false);
    }
  }

  async function exportBodyCsv() {
    if (exportingBodyCsv) return;
    setExportingBodyCsv(true);
    setBodyCsvError(null);
    setBodyCsvMessage(null);
    try {
      const blob = await api.exportBodyMeasurements();
      const href = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = href;
      link.download = `body-weight-${localDate()}.csv`;
      document.body.append(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(href);
      setBodyCsvMessage(
        measurements.length
          ? `Exported ${measurements.length} body-weight ${measurements.length === 1 ? 'entry' : 'entries'}.`
          : 'Exported an empty body-weight CSV template.',
      );
    } catch (reason) {
      setBodyCsvError(reason instanceof Error ? reason.message : 'Could not export body weight.');
    } finally {
      setExportingBodyCsv(false);
    }
  }

  async function importBodyCsv(file: File) {
    if (importingBodyCsv) return;
    setImportingBodyCsv(true);
    setBodyCsvError(null);
    setBodyCsvMessage(null);
    try {
      const result = await api.importBodyMeasurements(file);
      await onDataChange();
      setBodyCsvMessage(
        `Imported ${result.rows_imported} ${result.rows_imported === 1 ? 'row' : 'rows'}: ${result.measurements_created} created and ${result.measurements_updated} updated.`,
      );
    } catch (reason) {
      setBodyCsvError(reason instanceof Error ? reason.message : 'Could not import body weight.');
    } finally {
      setImportingBodyCsv(false);
    }
  }

  return (
    <section className="body-screen content-page">
      <div className="body-reference-stats" aria-label="Bodyweight summary">
        <div>
          <span>Bodyweight</span>
          <strong>{latest ? `${latest.weight_kg} kg` : '–'}</strong>
        </div>
        <div>
          <span>
            {activeGoal
              ? `${new Intl.DateTimeFormat(undefined, { month: 'long' }).format(new Date(`${activeGoal.target_date}T12:00:00`))} Goal`
              : 'Weight Goal'}
          </span>
          <strong>{activeGoal ? `${activeGoal.target_weight_kg} kg` : '–'}</strong>
        </div>
        <div>
          <span>Body Fat</span>
          <strong>
            {latest && latest.body_fat_pct !== null ? `${latest.body_fat_pct}%` : '–'}
          </strong>
        </div>
      </div>

      <div className="body-reference-actions">
        <button
          className={entryOpen ? 'active' : ''}
          type="button"
          onClick={() => {
            setEntryOpen((open) => !open);
            setGoalOpen(false);
          }}
        >
          ▣ Add Bodyweight
        </button>
        <button
          className={goalOpen ? 'active' : ''}
          type="button"
          onClick={() => {
            setGoalOpen((open) => !open);
            setEntryOpen(false);
          }}
        >
         ⌁ Add Goal
        </button>
      </div>

      <section className={`panel body-phase-panel ${goalOpen ? '' : 'reference-collapsed'}`}>
        <div className="panel-heading">
          <div>
            <p className="section-kicker">TRAINING PHASE</p>
            <h2>{trainingModeLabels[trainingMode]} phase</h2>
          </div>
        </div>
        <div className="goal-mode-tabs goal-mode-tabs-large" aria-label="Training phase">
          {(Object.keys(trainingModeLabels) as TrainingMode[]).map((mode) => (
            <button
              type="button"
              className={trainingMode === mode ? 'active' : ''}
              disabled={changingMode}
              onClick={() => void changeTrainingMode(mode)}
              key={mode}
            >
              {trainingModeLabels[mode]}
              <small>{mode === 'cut' ? 10 : mode === 'maintenance' ? 12 : 14} sets / muscle</small>
            </button>
          ))}
        </div>
        <p>Used for weekly targets and workout recommendations.</p>
      </section>

      <section className={`panel body-goal-panel ${goalOpen ? '' : 'reference-collapsed'}`}>
        <div className="panel-heading">
          <div>
            <p className="section-kicker">GOAL</p>
            <h2>Body-weight target</h2>
          </div>
        </div>
        {activeGoal && latest && (
          <div className="body-goal-progress">
            <div>
              <strong>{latest.weight_kg} kg</strong>
              <span>
                → {activeGoal.target_weight_kg} kg by {prettyDate(activeGoal.target_date)}
              </span>
            </div>
            <div className="zone2-track">
              <i
                style={{
                  width: `${Math.min(100, Math.max(0, (Math.abs(latest.weight_kg - activeGoal.start_weight_kg) / Math.max(Math.abs(activeGoal.target_weight_kg - activeGoal.start_weight_kg), 0.1)) * 100))}%`,
                }}
              />
            </div>
          </div>
        )}
        {latest && (
          <div
            className={`goal-mode-preview ${inferredGoalMode ?? 'maintenance'}`}
            aria-live="polite"
          >
            <span>Automatic phase</span>
            <strong>
              {inferredGoalMode
                ? `${trainingModeLabels[inferredGoalMode]} target`
                : 'Enter a target'}
            </strong>
            <small>
              Maintenance range: {maintenanceMinimum}–{maintenanceMaximum} kg
            </small>
          </div>
        )}
        <div className="goal-entry-fields">
          <label>
            Target kg
            <input
              type="number"
              step="0.1"
              value={goalTarget}
              onChange={(event) => setGoalTarget(event.target.value)}
            />
          </label>
          <label>
            Target date
            <input
              type="date"
              value={goalDate}
              onChange={(event) => setGoalDate(event.target.value)}
            />
          </label>
          <button disabled={savingGoal} onClick={() => void saveGoal()}>
            {savingGoal ? 'Saving…' : 'Set goal'}
          </button>
        </div>
      </section>

      <section className={`panel body-entry-panel ${entryOpen ? '' : 'reference-collapsed'}`}>
        <div className="panel-heading">
          <div>
            <p className="section-kicker">CHECK-IN</p>
            <h2>Log measurement</h2>
          </div>
        </div>
        <div className="body-entry-fields">
          <label>
            Date
            <input
              type="date"
              value={measurementDate}
              onChange={(event) => setMeasurementDate(event.target.value)}
            />
          </label>
          <label>
            Weight (kg)
            <input
              inputMode="decimal"
              type="number"
              min="1"
              max="500"
              step="0.1"
              value={weight}
              onChange={(event) => setWeight(event.target.value)}
              placeholder="88.0"
            />
          </label>
          <label>
            Body fat %
            <input
              inputMode="decimal"
              type="number"
              min="1"
              max="70"
              step="0.1"
              value={bodyFat}
              onChange={(event) => setBodyFat(event.target.value)}
              placeholder="Optional"
            />
          </label>
        </div>
        <textarea
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          placeholder="Conditions, phase, or anything worth remembering…"
          rows={2}
        />
        {error && <p className="inline-error">{error}</p>}
        <button disabled={saving} onClick={() => void submitMeasurement()}>
          {saving ? 'Saving…' : 'Save check-in'}
        </button>
      </section>

      {measurements.length > 1 && (
        <section className="panel body-trend-panel">
          <div className="panel-heading">
            <div>
              <p className="section-kicker">TREND</p>
              <h2>Body composition</h2>
            </div>
          </div>
          <BodyTrendChart
            measurements={measurements}
            goal={activeGoal}
            phases={[...goals, ...phases]}
            currentMode={trainingMode}
          />
        </section>
      )}

      <div className="body-log-tabs" role="tablist" aria-label="Bodyweight records">
        <button className="active" type="button" role="tab" aria-selected="true">
          ▣ Bodyweights
        </button>
        <button
          type="button"
          role="tab"
          aria-selected="false"
          onClick={() => {
            setGoalOpen(true);
            setEntryOpen(false);
            window.scrollTo({ top: 0, behavior: 'smooth' });
          }}
        >
          ⌁ Goals
        </button>
      </div>

      <section className="panel body-history-panel">
        <div className="panel-heading">
          <div>
            <p className="section-kicker">HISTORY</p>
            <h2>Check-ins</h2>
          </div>
          <div className="body-csv-actions">
            <input
              ref={bodyCsvInput}
              type="file"
              accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values"
              hidden
              onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                event.currentTarget.value = '';
                if (file) void importBodyCsv(file);
              }}
            />
            <button
              type="button"
              disabled={importingBodyCsv}
              onClick={() => bodyCsvInput.current?.click()}
            >
              {importingBodyCsv ? 'Importing…' : 'Import CSV'}
            </button>
            <button type="button" disabled={exportingBodyCsv} onClick={() => void exportBodyCsv()}>
              {exportingBodyCsv ? 'Exporting…' : 'Export CSV'}
            </button>
          </div>
        </div>
        <p className="body-csv-format">
          Date and Weight (kg); Body Fat (%) and Notes are optional.
        </p>
        {bodyCsvMessage && (
          <p className="body-csv-status" role="status">
            {bodyCsvMessage}
          </p>
        )}
        {bodyCsvError && (
          <p className="inline-error" role="alert">
            {bodyCsvError}
          </p>
        )}
        {!measurements.length && (
          <p className="body-empty">Your first check-in will appear here.</p>
        )}
        {measurements.length > 0 && (
          <div className="body-history-table-head" aria-hidden="true">
            <span>Date</span>
            <span>Bodyweight</span>
            <span>Body Fat</span>
            <span />
          </div>
        )}
        {pagedMeasurements.map((measurement) => (
          <Fragment key={measurement.id}>
            <article>
              <div className="body-history-date">
                <strong>
                  {new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(
                    new Date(`${measurement.measurement_date}T12:00:00`),
                  )}
                </strong>
                <small>{measurement.measurement_date.slice(0, 4)}</small>
              </div>
              <div className="body-history-weight">
                <strong>{measurement.weight_kg} kg</strong>
                <small>{measurement.is_sample && 'Sample'}</small>
                {measurement.notes && <p>{measurement.notes}</p>}
              </div>
              <div className="body-history-fat">
                <strong>
                  {measurement.body_fat_pct !== null ? `${measurement.body_fat_pct}%` : '–'}
                </strong>
                <small>{measurement.body_fat_pct !== null ? 'estimate' : ''}</small>
              </div>
              <details className="body-row-menu">
                <summary aria-label={`Actions for ${prettyDate(measurement.measurement_date)}`}>
                  ⋮
                </summary>
                <div className="body-history-actions">
                  <button type="button" onClick={() => beginMeasurementEdit(measurement)}>
                    Edit
                  </button>
                  <InlineConfirmButton
                    label="Delete"
                    confirmLabel="Delete check-in"
                    onConfirm={() => onDelete(measurement.id)}
                  />
                </div>
              </details>
            </article>
            {editingMeasurement?.id === measurement.id && (
              <form
                className="body-edit-form"
                aria-label={`Edit check-in for ${prettyDate(editingMeasurement.measurement_date)}`}
                onSubmit={(event) => {
                  event.preventDefault();
                  void submitMeasurementEdit();
                }}
              >
                <header>
                  <div>
                    <p className="section-kicker">EDIT CHECK-IN</p>
                    <h2>{prettyDate(editingMeasurement.measurement_date)}</h2>
                  </div>
                </header>
                <div className="body-edit-content">
                  <div className="body-edit-fields">
                    <label>
                      Weight (kg)
                      <input
                        inputMode="decimal"
                        type="number"
                        min="1"
                        max="500"
                        step="0.1"
                        value={editWeight}
                        onChange={(event) => setEditWeight(event.target.value)}
                      />
                    </label>
                    <label>
                      Body fat %
                      <input
                        inputMode="decimal"
                        type="number"
                        min="1"
                        max="70"
                        step="0.1"
                        value={editBodyFat}
                        onChange={(event) => setEditBodyFat(event.target.value)}
                        placeholder="Optional"
                      />
                    </label>
                  </div>
                  {editError && <p className="inline-error">{editError}</p>}
                </div>
                <div className="body-edit-actions">
                  <button
                    type="button"
                    disabled={editSaving}
                    onClick={() => setEditingMeasurement(null)}
                  >
                    Cancel
                  </button>
                  <button type="submit" disabled={editSaving}>
                    {editSaving ? 'Saving…' : 'Save changes'}
                  </button>
                </div>
              </form>
            )}
          </Fragment>
        ))}
        <PaginationControls
          currentPage={checkInPage}
          totalPages={checkInPageCount}
          onPageChange={setCheckInPage}
          label="check-in history"
        />
      </section>
    </section>
  );
}

function BodyTrendChart({
  measurements,
  goal,
  phases,
  currentMode,
}: {
  measurements: BodyMeasurement[];
  goal: BodyWeightGoal | null;
  phases: Array<Pick<TrainingPhase, 'start_date' | 'mode'>>;
  currentMode: TrainingMode;
}) {
  const [displayRange, setDisplayRange] = useState<BodyTrendRange>('3m');
  const [activePointIndex, setActivePointIndex] = useState<number | null>(null);
  const [showWeight, setShowWeight] = useState(true);
  const [showBodyFat, setShowBodyFat] = useState(true);
  const visibleMeasurements = filterMeasurementsByRange(measurements, displayRange);
  const ordered = visibleMeasurements.slice().reverse();
  const width = 340;
  const height = 190;
  const left = 42;
  const right = 38;
  const top = 18;
  const bottom = 34;
  const weightValues = ordered.map((item) => item.weight_kg);
  const fatValues = ordered.map((item) => item.body_fat_pct);

  function range(values: Array<number | null>): { min: number; max: number } | null {
    const present = values.filter((value): value is number => value !== null);
    if (!present.length) return null;
    const rawMin = Math.min(...present);
    const rawMax = Math.max(...present);
    const spread = Math.max(rawMax - rawMin, rawMax * 0.02, 1);
    return { min: rawMin - spread * 0.15, max: rawMax + spread * 0.15 };
  }

  const weightRange = range(goal ? [...weightValues, goal.target_weight_kg] : weightValues)!;
  const fatRange = range(fatValues);
  const weightVisible = showWeight || fatRange === null;
  const bodyFatVisible = showBodyFat && fatRange !== null;
  const weightPoints = weightValues.map((value, index) => {
    const x = left + (index / Math.max(ordered.length - 1, 1)) * (width - left - right);
    const ratio = (value - weightRange.min) / Math.max(weightRange.max - weightRange.min, 1);
    const y = height - bottom - ratio * (height - top - bottom);
    return { date: ordered[index].measurement_date, x, y };
  });
  const fatPoints = fatValues.map((value, index) => {
    if (value === null || fatRange === null) return null;
    const x = left + (index / Math.max(ordered.length - 1, 1)) * (width - left - right);
    const ratio = (value - fatRange.min) / Math.max(fatRange.max - fatRange.min, 1);
    const y = height - bottom - ratio * (height - top - bottom);
    return { x, y };
  });
  const fatLinePoints = fatPoints
    .filter((point): point is { x: number; y: number } => point !== null)
    .map((point) => `${point.x},${point.y}`)
    .join(' ');
  const fallbackMode = phases.length ? 'maintenance' : currentMode;
  const weightSegments = splitWeightLineByPhase(weightPoints, phases, fallbackMode);
  const yFractions = [0, 0.5, 1];
  const xIndexes = [...new Set([0, Math.floor((ordered.length - 1) / 2), ordered.length - 1])];
  const activeMeasurement = activePointIndex === null ? null : (ordered[activePointIndex] ?? null);
  const activeWeightPoint =
    activePointIndex === null ? null : (weightPoints[activePointIndex] ?? null);
  const activeFatPoint = activePointIndex === null ? null : (fatPoints[activePointIndex] ?? null);
  const activeMode = activeMeasurement
    ? trainingPhaseAtDate(activeMeasurement.measurement_date, phases, fallbackMode)
    : null;
  const tooltipWidth = 112;
  const tooltipValueCount =
    Number(weightVisible) + Number(bodyFatVisible && activeMeasurement?.body_fat_pct !== null);
  const tooltipHeight = 24 + tooltipValueCount * 10;
  const tooltipX = activeWeightPoint
    ? Math.min(width - right - tooltipWidth, Math.max(left, activeWeightPoint.x - tooltipWidth / 2))
    : 0;
  const tooltipY = activeWeightPoint
    ? Math.max(
        3,
        Math.min(
          ...(weightVisible ? [activeWeightPoint.y] : []),
          ...(bodyFatVisible && activeFatPoint ? [activeFatPoint.y] : []),
        ) -
          tooltipHeight -
          8,
      )
    : 0;

  function selectPointAtClientX(clientX: number, svg: SVGSVGElement) {
    const bounds = svg.getBoundingClientRect();
    if (bounds.width === 0) return;
    const chartX = ((clientX - bounds.left) / bounds.width) * width;
    if (weightVisible) {
      setActivePointIndex(nearestChartPointIndex(chartX, left, width - right, ordered.length));
      return;
    }
    const bodyFatIndexes = fatPoints.flatMap((point, index) => (point ? [index] : []));
    const nearestBodyFatIndex = bodyFatIndexes.reduce(
      (nearest, index) =>
        Math.abs(weightPoints[index].x - chartX) < Math.abs(weightPoints[nearest].x - chartX)
          ? index
          : nearest,
      bodyFatIndexes[0],
    );
    setActivePointIndex(nearestBodyFatIndex);
  }

  return (
    <div className="body-chart">
      <div className="body-chart-controls">
        <span>
          {ordered.length} {ordered.length === 1 ? 'check-in' : 'check-ins'} shown
        </span>
        <div role="group" aria-label="Body-composition graph range">
          {(
            [
              ['3m', '3 months'],
              ['9m', '9 months'],
              ['1y', '1 year'],
              ['all', 'All time'],
            ] as Array<[BodyTrendRange, string]>
          ).map(([value, label]) => (
            <button
              type="button"
              className={displayRange === value ? 'active' : ''}
              aria-pressed={displayRange === value}
              onClick={() => {
                setDisplayRange(value);
                setActivePointIndex(null);
              }}
              key={value}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="body-chart-series-controls" role="group" aria-label="Graph measurements">
        <span>Display</span>
        <button
          type="button"
          className={weightVisible ? 'active' : ''}
          aria-pressed={weightVisible}
          disabled={weightVisible && !bodyFatVisible}
          onClick={() => {
            setShowWeight((visible) => !visible);
            setActivePointIndex(null);
          }}
        >
          <i className="weight-series-swatch" />
          Body weight
        </button>
        <button
          type="button"
          className={bodyFatVisible ? 'active' : ''}
          aria-pressed={bodyFatVisible}
          disabled={fatRange === null || (bodyFatVisible && !weightVisible)}
          onClick={() => {
            setShowBodyFat((visible) => !visible);
            setActivePointIndex(null);
          }}
        >
          <i className="fat-series-swatch" />
          Body fat
        </button>
      </div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label="Body composition trend. Drag horizontally to inspect each check-in. Weight is blue for a cut, green for maintenance, and red for a bulk."
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          selectPointAtClientX(event.clientX, event.currentTarget);
        }}
        onPointerMove={(event) => {
          if (
            event.pointerType === 'mouse' ||
            event.currentTarget.hasPointerCapture(event.pointerId)
          ) {
            selectPointAtClientX(event.clientX, event.currentTarget);
          }
        }}
        onPointerUp={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId);
          }
        }}
        onPointerCancel={() => setActivePointIndex(null)}
        onPointerLeave={(event) => {
          if (event.pointerType === 'mouse') setActivePointIndex(null);
        }}
      >
        {yFractions.map((fraction) => {
          const y = height - bottom - fraction * (height - top - bottom);
          const weightTick = weightRange.min + fraction * (weightRange.max - weightRange.min);
          const fatTick = fatRange ? fatRange.min + fraction * (fatRange.max - fatRange.min) : null;
          return (
            <g className="chart-axis" key={fraction}>
              <line x1={left} x2={width - right} y1={y} y2={y} />
              {weightVisible && (
                <text x={left - 5} y={y + 3} textAnchor="end">
                  {weightTick.toFixed(1)}
                </text>
              )}
              {bodyFatVisible && fatTick !== null && (
                <text className="fat-axis-label" x={width - right + 5} y={y + 3} textAnchor="start">
                  {fatTick.toFixed(1)}
                </text>
              )}
            </g>
          );
        })}
        <line className="chart-axis-line" x1={left} x2={left} y1={top} y2={height - bottom} />
        <line
          className="chart-axis-line"
          x1={left}
          x2={width - right}
          y1={height - bottom}
          y2={height - bottom}
        />
        {weightVisible &&
          weightSegments.map((segment, index) => (
            <line
              className={`weight-segment phase-${segment.mode}`}
              key={`${segment.x1}-${segment.x2}-${index}`}
              x1={segment.x1}
              y1={segment.y1}
              x2={segment.x2}
              y2={segment.y2}
            />
          ))}
        {weightVisible &&
          weightPoints.map((point) => {
            const mode = trainingPhaseAtDate(point.date, phases, fallbackMode);
            return (
              <circle
                className={`weight-point phase-${mode}`}
                key={point.date}
                cx={point.x}
                cy={point.y}
                r="2.8"
              />
            );
          })}
        {weightVisible &&
          goal &&
          (() => {
            const ratio =
              (goal.target_weight_kg - weightRange.min) /
              Math.max(weightRange.max - weightRange.min, 1);
            const y = height - bottom - ratio * (height - top - bottom);
            return (
              <>
                <line className="goal-line" x1={left} x2={width - right} y1={y} y2={y} />
                <text className="goal-line-label" x={width - right} y={y - 4} textAnchor="end">
                  Goal {goal.target_weight_kg} kg
                </text>
              </>
            );
          })()}
        {bodyFatVisible && <polyline className="fat-line" points={fatLinePoints} />}
        {bodyFatVisible &&
          fatPoints.map((point, index) =>
            point ? (
              <circle
                className="fat-point"
                key={ordered[index].measurement_date}
                cx={point.x}
                cy={point.y}
                r="2.8"
              />
            ) : null,
          )}
        {xIndexes.map((index) => {
          const x = left + (index / Math.max(ordered.length - 1, 1)) * (width - left - right);
          return (
            <text
              className="chart-x-label"
              key={index}
              x={x}
              y={height - 11}
              textAnchor={index === 0 ? 'start' : index === ordered.length - 1 ? 'end' : 'middle'}
            >
              {new Date(`${ordered[index].measurement_date}T12:00:00`).toLocaleDateString(
                undefined,
                {
                  month: 'short',
                  day: 'numeric',
                },
              )}
            </text>
          );
        })}
        {weightVisible && (
          <text className="chart-y-title weight-axis-title" x="4" y="11">
            Weight kg
          </text>
        )}
        {bodyFatVisible && fatRange && (
          <text className="chart-y-title fat-axis-title" x={width - 3} y="11" textAnchor="end">
            Body fat %
          </text>
        )}
        {activeMeasurement && activeWeightPoint && activeMode && (
          <g className="body-chart-selection" aria-hidden="true">
            <line
              className="selection-guide"
              x1={activeWeightPoint.x}
              x2={activeWeightPoint.x}
              y1={top}
              y2={height - bottom}
            />
            {weightVisible && (
              <circle
                className={`selected-weight-point phase-${activeMode}`}
                cx={activeWeightPoint.x}
                cy={activeWeightPoint.y}
                r="5"
              />
            )}
            {bodyFatVisible && activeFatPoint && (
              <circle
                className="selected-fat-point"
                cx={activeFatPoint.x}
                cy={activeFatPoint.y}
                r="4.5"
              />
            )}
            <g className="measurement-tooltip">
              <rect x={tooltipX} y={tooltipY} width={tooltipWidth} height={tooltipHeight} rx="6" />
              <text x={tooltipX + 8} y={tooltipY + 12}>
                <tspan className="tooltip-date">
                  {new Date(`${activeMeasurement.measurement_date}T12:00:00`).toLocaleDateString(
                    undefined,
                    { month: 'short', day: 'numeric', year: 'numeric' },
                  )}
                </tspan>
                {weightVisible && (
                  <tspan className={`tooltip-weight phase-${activeMode}`} x={tooltipX + 8} dy="11">
                    {activeMeasurement.weight_kg} kg
                  </tspan>
                )}
                {bodyFatVisible && activeMeasurement.body_fat_pct !== null && (
                  <tspan className="tooltip-fat" x={tooltipX + 8} dy="10">
                    {activeMeasurement.body_fat_pct}% body fat
                  </tspan>
                )}
              </text>
            </g>
          </g>
        )}
      </svg>
      <p className="sr-only" aria-live="polite">
        {activeMeasurement
          ? `${prettyDate(activeMeasurement.measurement_date)}: ${weightVisible ? `${activeMeasurement.weight_kg} kilograms` : ''}${weightVisible && bodyFatVisible ? ', ' : ''}${bodyFatVisible && activeMeasurement.body_fat_pct !== null ? `${activeMeasurement.body_fat_pct} percent body fat` : ''}`
          : ''}
      </p>
      <div className="body-chart-legend" aria-label="Chart legend">
        {weightVisible && (
          <>
            <span>
              <i className="phase-cut" /> Cut
            </span>
            <span>
              <i className="phase-maintenance" /> Maintenance
            </span>
            <span>
              <i className="phase-bulk" /> Bulk
            </span>
          </>
        )}
        {bodyFatVisible && (
          <span>
            <i className="fat" /> Body fat
          </span>
        )}
      </div>
    </div>
  );
}

function CardioScreen({ onDataChange }: { onDataChange: () => Promise<void> }) {
  const empty: CardioSessionInput = {
    session_date: localDate(),
    activity_type: 'Walking',
    duration_minutes: 30,
    intensity: 'Conversational pace',
    zone: 'Zone 2',
    qualifies_zone2: true,
    notes: null,
  };
  const [overview, setOverview] = useState<CardioOverview | null>(null);
  const [draft, setDraft] = useState<CardioSessionInput>(empty);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = () =>
    api
      .cardioOverview()
      .then(setOverview)
      .catch((reason) =>
        setError(reason instanceof Error ? reason.message : 'Could not load cardio.'),
      );
  useEffect(() => {
    void load();
  }, []);
  async function save() {
    try {
      if (editingId) await api.updateCardio(editingId, draft);
      else await api.createCardio(draft);
      setDraft(empty);
      setEditingId(null);
      await load();
      await onDataChange();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not save cardio.');
    }
  }
  async function remove(id: string) {
    try {
      await api.deleteCardio(id);
      await load();
      await onDataChange();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not delete cardio.');
    }
  }
  if (!overview) return <LoadingState />;
  const week = overview.current_week;
  return (
    <div className="cardio-screen">
      {error && <p className="inline-error">{error}</p>}
      <section className={`panel zone2-card ${week.complete ? 'complete' : ''}`}>
        <div className="panel-heading">
          <div>
            <p className="section-kicker">THIS WEEK</p>
            <h2>Zone 2 cardio</h2>
          </div>
          <strong>
            {week.completed_minutes} / {week.goal_minutes} min
          </strong>
        </div>
        <div className="zone2-track">
          <i style={{ width: `${week.percentage}%` }} />
        </div>
        <p>
          {week.complete ? 'Weekly goal complete.' : `${week.remaining_minutes} minutes remaining.`}
        </p>
        <div className="training-preferences-grid">
          <label>
            Weekly Zone 2 goal
            <input
              type="number"
              min="1"
              value={overview.preferences.zone2_goal_minutes}
              onChange={(event) =>
                setOverview({
                  ...overview,
                  preferences: {
                    ...overview.preferences,
                    zone2_goal_minutes: Number(event.target.value),
                  },
                })
              }
            />
          </label>
          <label>
            Weight unit
            <select
              value={overview.preferences.preferred_weight_unit}
              onChange={(event) =>
                setOverview({
                  ...overview,
                  preferences: {
                    ...overview.preferences,
                    preferred_weight_unit: event.target.value as 'kg' | 'lb',
                  },
                })
              }
            >
              <option value="kg">Kilograms</option>
              <option value="lb">Pounds</option>
            </select>
          </label>
          <label>
            Week starts
            <select
              value={overview.preferences.week_start}
              onChange={(event) =>
                setOverview({
                  ...overview,
                  preferences: {
                    ...overview.preferences,
                    week_start: event.target.value as 'monday' | 'sunday' | 'saturday',
                  },
                })
              }
            >
              <option value="monday">Monday</option>
              <option value="sunday">Sunday</option>
              <option value="saturday">Saturday</option>
            </select>
          </label>
          <button
            onClick={() =>
              void api.updateTrainingPreferences(overview.preferences).then(load).then(onDataChange)
            }
          >
            Save preferences
          </button>
        </div>
      </section>
      <section className="panel cardio-form">
        <h2>{editingId ? 'Edit cardio session' : 'Log cardio session'}</h2>
        <div className="cardio-fields">
          <label>
            Date
            <input
              type="date"
              value={draft.session_date}
              onChange={(event) => setDraft({ ...draft, session_date: event.target.value })}
            />
          </label>
          <label>
            Activity
            <input
              value={draft.activity_type}
              onChange={(event) => setDraft({ ...draft, activity_type: event.target.value })}
            />
          </label>
          <label>
            Minutes
            <input
              type="number"
              min="1"
              inputMode="numeric"
              value={draft.duration_minutes}
              onChange={(event) =>
                setDraft({ ...draft, duration_minutes: Number(event.target.value) })
              }
            />
          </label>
          <label>
            Intensity
            <input
              value={draft.intensity ?? ''}
              onChange={(event) => setDraft({ ...draft, intensity: event.target.value || null })}
            />
          </label>
          <label>
            Zone
            <select
              value={draft.zone ?? ''}
              onChange={(event) => setDraft({ ...draft, zone: event.target.value || null })}
            >
              <option value="">Not set</option>
              {[1, 2, 3, 4, 5].map((zone) => (
                <option key={zone} value={`Zone ${zone}`}>
                  Zone {zone}
                </option>
              ))}
            </select>
          </label>
          <label className="zone2-check">
            <input
              type="checkbox"
              checked={draft.qualifies_zone2}
              onChange={(event) => setDraft({ ...draft, qualifies_zone2: event.target.checked })}
            />
            Qualifies as Zone 2
          </label>
        </div>
        <textarea
          value={draft.notes ?? ''}
          onChange={(event) => setDraft({ ...draft, notes: event.target.value || null })}
          placeholder="Notes"
        />
        <button className="primary-action" onClick={() => void save()}>
          {editingId ? 'Save changes' : 'Add cardio session'}
        </button>
      </section>
      <section className="panel cardio-history">
        <h2>Cardio history</h2>
        {overview.sessions.map((session) => (
          <article key={session.id}>
            <div>
              <strong>{session.activity_type}</strong>
              <small>
                {prettyDate(session.session_date)} · {session.duration_minutes} min ·{' '}
                {session.zone ?? session.intensity ?? 'Unspecified'}
                {session.qualifies_zone2 ? ' · Zone 2 ✓' : ''}
                {session.source_workout_id ? ' · Imported from workout' : ''}
              </small>
            </div>
            {!session.source_workout_id && (
              <>
                <button
                  onClick={() => {
                    setEditingId(session.id);
                    setDraft(session);
                  }}
                >
                  Edit
                </button>
                <InlineConfirmButton
                  label="Delete"
                  confirmLabel="Delete session"
                  onConfirm={() => remove(session.id)}
                />
              </>
            )}
          </article>
        ))}
      </section>
      <section className="panel previous-zone2">
        <h2>Previous weeks</h2>
        {overview.previous_weeks.map((item) => (
          <div key={item.week_start}>
            <span>{prettyDate(item.week_start)}</span>
            <strong>{item.completed_minutes} min</strong>
          </div>
        ))}
      </section>
    </div>
  );
}

function HistoryScreen({
  workouts,
  measurements,
  exercises,
  currentBodyweight,
  onEdit,
  onDelete,
  onImport,
  onExport,
  onDeleteSamples,
  personalRecords,
  onDataChange,
  initialOpenId,
  initialSection,
  initialExerciseId,
  onStartWorkout,
}: {
  workouts: TrackedWorkout[];
  measurements: BodyMeasurement[];
  exercises: Exercise[];
  currentBodyweight: number | null;
  onEdit: (workout: TrackedWorkout) => void;
  onDelete: (workout: TrackedWorkout) => void;
  onImport: (file: File) => Promise<void>;
  onExport: () => Promise<void>;
  onDeleteSamples: () => Promise<void>;
  personalRecords: PersonalRecord[];
  onDataChange: () => Promise<void>;
  initialOpenId: string | null;
  initialSection: 'history' | 'progress' | 'cardio';
  initialExerciseId: string | null;
  onStartWorkout: () => void;
}) {
  const initialWorkoutIndex = initialOpenId
    ? workouts.findIndex((workout) => workout.id === initialOpenId)
    : -1;
  const [openId, setOpenId] = useState<string | null>(initialOpenId);
  const [workoutPage, setWorkoutPage] = useState(
    initialWorkoutIndex >= 0 ? Math.floor(initialWorkoutIndex / HISTORY_PAGE_SIZE) + 1 : 1,
  );
  const [section, setSection] = useState<'history' | 'progress' | 'cardio'>(initialSection);
  const [importing, setImporting] = useState(false);
  const [expandedPhoto, setExpandedPhoto] = useState<MachinePhoto | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const workoutPageCount = Math.max(1, Math.ceil(workouts.length / HISTORY_PAGE_SIZE));
  const pagedWorkouts = workouts.slice(
    (workoutPage - 1) * HISTORY_PAGE_SIZE,
    workoutPage * HISTORY_PAGE_SIZE,
  );

  useEffect(() => {
    setWorkoutPage((page) => Math.min(page, workoutPageCount));
  }, [workoutPageCount]);

  return (
    <section className="history-screen content-page">
      <div className="history-section-tabs">
        <button
          className={section === 'history' ? 'active' : ''}
          onClick={() => setSection('history')}
        >
          Workout history
        </button>
        <button
          className={section === 'progress' ? 'active' : ''}
          onClick={() => setSection('progress')}
        >
          Exercise progress
        </button>
        <button
          className={section === 'cardio' ? 'active' : ''}
          onClick={() => setSection('cardio')}
        >
          Cardio
        </button>
      </div>
      {section === 'progress' ? (
        <ProgressScreen
          exercises={exercises}
          currentBodyweight={currentBodyweight}
          embedded
          initialExerciseId={initialExerciseId}
        />
      ) : section === 'cardio' ? (
        <CardioScreen onDataChange={onDataChange} />
      ) : (
        <>
          <div className="screen-intro history-intro">
            <div>
              <p className="section-kicker">TRAINING LOG</p>
              <h1>Workout history</h1>
            </div>
            <div className="data-actions">
              <button className="history-add-workout" type="button" onClick={onStartWorkout}>
                ＋ Add Workout
              </button>
              <button onClick={() => fileInput.current?.click()} disabled={importing}>
                {importing ? 'Importing…' : '↑ Import CSV'}
              </button>
              <button onClick={() => void onExport()}>↓ Export CSV</button>
              {workouts.some((workout) => workout.is_sample) && (
                <InlineConfirmButton
                  className="sample-clear"
                  label="Remove samples"
                  confirmLabel="Confirm removal"
                  onConfirm={onDeleteSamples}
                />
              )}
              <input
                ref={fileInput}
                className="sr-only"
                type="file"
                accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (!file) return;
                  setImporting(true);
                  void onImport(file).finally(() => {
                    setImporting(false);
                    event.target.value = '';
                  });
                }}
              />
            </div>
          </div>
          {!workouts.length && (
            <EmptyState
              title="Your log is empty"
              body="Your completed workouts will show up here."
            />
          )}
          {pagedWorkouts.map((workout) => {
            const open = openId === workout.id;
            const completedWorkoutSets = workout.movements
              .flatMap((movement) => movement.sets)
              .filter((item) => item.completed);
            const totalReps = completedWorkoutSets.reduce(
              (total, item) => total + (item.reps ?? 0),
              0,
            );
            const totalVolume = completedWorkoutSets.reduce(
              (total, item) => total + (item.weight_kg ?? 0) * (item.reps ?? 0),
              0,
            );
            const workoutBodyweight =
              bodyweightForDate(measurements, workout.workout_date) ??
              workout.movements
                .flatMap((movement) => movement.sets)
                .find((item) => item.bodyweight_kg !== null)?.bodyweight_kg ??
              null;
            return (
              <article className={`history-card panel ${open ? 'open' : ''}`} key={workout.id}>
                <button
                  className="history-card-summary"
                  onClick={() => setOpenId(open ? null : workout.id)}
                >
                  <i style={{ background: categoryColors[workout.category] }} />
                  <div>
                    <span>
                      {categoryNames[workout.category]}
                      {workout.is_sample ? ' · SAMPLE' : ''}
                    </span>
                    <strong>{workout.name}</strong>
                    <small>
                      {prettyDate(workout.workout_date)} ·{' '}
                      {formatMinutesDuration(workout.duration_minutes)}
                    </small>
                  </div>
                  <b>{open ? '−' : '+'}</b>
                </button>
                {open && (
                  <div className="history-detail">
                    <div className="history-workout-stats" aria-label="Workout totals">
                      <span>
                        <small>Time</small>
                        <strong>{formatMinutesDuration(workout.duration_minutes)}</strong>
                      </span>
                      <span>
                        <small>Sets</small>
                        <strong>{completedWorkoutSets.length}</strong>
                      </span>
                      <span>
                        <small>Reps</small>
                        <strong>{totalReps || '–'}</strong>
                      </span>
                      <span>
                        <small>Volume</small>
                        <strong>
                          {totalVolume ? `${Math.round(totalVolume).toLocaleString()} kg` : '–'}
                        </strong>
                      </span>
                    </div>
                    {workout.movements.map((movement) => (
                      <div className="history-movement" key={movement.id}>
                        <strong>
                          {movement.exercise.name}
                          {workoutBodyweight !== null && ` @ ${workoutBodyweight} kg`}
                        </strong>
                        {movement.machine_photos.length > 0 && (
                          <>
                            <div className="history-machine-photos">
                              {movement.machine_photos.map((photo) => (
                                <button
                                  type="button"
                                  key={photo.id}
                                  onClick={() =>
                                    setExpandedPhoto((current) =>
                                      current?.id === photo.id ? null : photo,
                                    )
                                  }
                                  aria-label={`${expandedPhoto?.id === photo.id ? 'Collapse' : 'Expand'} ${photo.caption}`}
                                  aria-expanded={expandedPhoto?.id === photo.id}
                                >
                                  <span className="history-photo-image">
                                    <img
                                      src={photo.thumbnail_url}
                                      alt={photo.caption}
                                      loading="lazy"
                                    />
                                    <svg
                                      className="history-photo-expand-icon"
                                      viewBox="0 0 20 20"
                                      aria-hidden="true"
                                    >
                                      <path d="M7 3H3v4M13 3h4v4M7 17H3v-4M13 17h4v-4" />
                                    </svg>
                                  </span>
                                  <span className="history-photo-caption">{photo.caption}</span>
                                </button>
                              ))}
                            </div>
                            {expandedPhoto &&
                              movement.machine_photos.some(
                                (photo) => photo.id === expandedPhoto.id,
                              ) && (
                                <MachinePhotoDetail
                                  photo={expandedPhoto}
                                  onClose={() => setExpandedPhoto(null)}
                                />
                              )}
                          </>
                        )}
                        <HistorySetFlow
                          sets={movement.sets.filter((item) => item.completed)}
                          personalRecords={personalRecords}
                        />
                        {movement.sets
                          .filter((item) => item.notes)
                          .map((item) => (
                            <small key={item.id}>
                              Set {item.order_index + 1}: {item.notes}
                            </small>
                          ))}
                        {movement.notes && <MovementNotes notes={movement.notes} />}
                      </div>
                    ))}
                    {workout.notes && <p>{workout.notes}</p>}
                    <div className="workout-actions">
                      <button onClick={() => onEdit(workout)}>Edit workout</button>
                      <InlineConfirmButton
                        className="delete-workout"
                        label="Delete workout"
                        confirmLabel="Confirm delete"
                        onConfirm={() => onDelete(workout)}
                      />
                    </div>
                  </div>
                )}
              </article>
            );
          })}
          <PaginationControls
            currentPage={workoutPage}
            totalPages={workoutPageCount}
            onPageChange={setWorkoutPage}
            label="workout history"
          />
        </>
      )}
    </section>
  );
}

function HistorySetFlow({
  sets,
  personalRecords,
}: {
  sets: TrackedSet[];
  personalRecords: PersonalRecord[];
}) {
  return (
    <div className="history-set-flow">
      {sets.map((item, index) => (
        <Fragment key={item.id}>
          <div className={`history-set-pill ${item.failed ? 'failed-set' : ''}`}>
            <b>Set {item.order_index + 1}</b>
            <span>{setResult(item)}</span>
            {item.rpe !== null && <small>RPE {item.rpe}</small>}
            <em>
              {item.set_type === 'warmup'
                ? 'Warm-up'
                : item.set_type === 'drop'
                  ? 'Drop'
                  : item.failed
                    ? 'Failed'
                    : ''}
            </em>
            {personalRecords.some((record) => record.set_id === item.id) && (
              <strong className="pr-badge">PR</strong>
            )}
          </div>
          {index < sets.length - 1 && (
            <div className="history-rest-gap">
              <i />
              <span>
                {item.rest_seconds !== null
                  ? `${formatDuration(item.rest_seconds)} rest`
                  : 'Rest not set'}
              </span>
              <i />
            </div>
          )}
        </Fragment>
      ))}
    </div>
  );
}

function setResult(item: TrackedSet): string {
  if (item.weight_kg !== null) return `${item.weight_kg} kg × ${item.reps ?? '–'}`;
  const cardioValues = [
    item.duration_seconds ? formatDuration(item.duration_seconds) : null,
    item.distance_km !== null ? `${item.distance_km} km` : null,
    item.incline_percent !== null ? `${item.incline_percent}% incline` : null,
    item.speed_kph !== null ? `${item.speed_kph} km/h` : null,
  ].filter((value): value is string => value !== null);
  if (cardioValues.length) return cardioValues.join(' · ');
  return `${item.reps ?? '–'} reps`;
}

function MovementNotes({ notes }: { notes: string }) {
  return (
    <div className="movement-notes-display">
      {notes.split('\n').map((line, index) => {
        const video = line.match(/^Video - (.+?) @ ([0-9:]+): (https:\/\/\S+)$/);
        return video ? (
          <a key={`${line}-${index}`} href={video[3]} target="_blank" rel="noreferrer">
            <span aria-hidden="true">▶</span>
            <span>
              <b>{video[1]}</b>
              <small>Watch from {video[2]}</small>
            </span>
          </a>
        ) : (
          <p key={`${line}-${index}`}>{line}</p>
        );
      })}
    </div>
  );
}

function EmptyState({
  title,
  body,
  action,
  onAction,
}: {
  title: string;
  body: string;
  action?: string;
  onAction?: () => void;
}) {
  return (
    <div className="empty-state">
      <span>↗</span>
      <strong>{title}</strong>
      <p>{body}</p>
      {action && onAction && <button onClick={onAction}>{action}</button>}
    </div>
  );
}

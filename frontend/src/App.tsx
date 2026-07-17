import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from './api';
import type {
  DashboardData,
  Exercise,
  ExerciseProgress,
  TrackedWorkout,
  WorkoutCategory,
  WorkoutInput,
  WorkoutSetInput,
} from './types';
import { localDate } from './utils';
import { VideoUpload } from './VideoUpload';

type AppTab = 'dashboard' | 'log' | 'progress' | 'history' | 'videos';
type ProgressMetric = 'estimated_1rm' | 'best_weight_kg' | 'volume_kg';
type DashboardMetric = 'workouts' | 'sets' | 'volume' | 'streak';

type DraftSet = WorkoutSetInput & { key: string };
type DraftMovement = {
  key: string;
  exercise: Exercise;
  notes: string;
  sets: DraftSet[];
};

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

const restOptions = [30, 45, 60, 90, 120, 150, 180, 240, 300];

function emptySet(kind: Exercise['kind'], previous?: DraftSet): DraftSet {
  return {
    key: crypto.randomUUID(),
    reps: kind === 'strength' ? (previous?.reps ?? null) : null,
    weight_kg: kind === 'strength' ? (previous?.weight_kg ?? null) : null,
    rpe: previous?.rpe ?? null,
    rest_seconds: previous?.rest_seconds ?? 120,
    duration_seconds: kind === 'cardio' ? (previous?.duration_seconds ?? null) : null,
    distance_km: kind === 'cardio' ? (previous?.distance_km ?? null) : null,
    notes: null,
    completed: false,
  };
}

function numberOrNull(value: string): number | null {
  return value === '' ? null : Number(value);
}

function formatDuration(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

function prettyDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(`${value}T12:00:00`));
}

export function App() {
  const [tab, setTab] = useState<AppTab>(() => {
    const requested = window.location.hash.slice(1) as AppTab;
    return ['dashboard', 'log', 'progress', 'history', 'videos'].includes(requested)
      ? requested
      : 'dashboard';
  });
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [workouts, setWorkouts] = useState<TrackedWorkout[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);

  async function refreshData() {
    try {
      const [nextDashboard, nextExercises, nextWorkouts] = await Promise.all([
        api.dashboard(),
        api.listExercises(),
        api.listWorkouts(),
      ]);
      setDashboard(nextDashboard);
      setExercises(nextExercises);
      setWorkouts(nextWorkouts);
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
    await api.createWorkout(payload);
    await refreshData();
    setTab('dashboard');
    setMessage('Workout saved. Nice work.');
  }

  async function deleteWorkout(workout: TrackedWorkout) {
    if (!window.confirm(`Delete “${workout.name}” from your training history?`)) return;
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
    if (!window.confirm('Remove all sample workouts? Your real workouts and videos will be kept.'))
      return;
    try {
      await api.deleteSampleData();
      await refreshData();
      setMessage('Sample workouts removed. They will not be seeded again.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not remove sample data.');
    }
  }

  const titles: Record<AppTab, string> = {
    dashboard: 'Overview',
    log: 'Log workout',
    progress: 'Progress',
    history: 'History',
    videos: 'Workout videos',
  };

  return (
    <div className="tracker-app">
      <header className="app-header">
        <div>
          <span className="brand-mark">GL</span>
          <div>
            <small>GYM LOGGER</small>
            <strong>{titles[tab]}</strong>
          </div>
        </div>
        {tab !== 'log' && (
          <button className="header-start" onClick={() => setTab('log')}>
            <span>＋</span> Start workout
          </button>
        )}
      </header>

      {message && (
        <button className="toast-message" onClick={() => setMessage(null)}>
          {message}
        </button>
      )}

      <main className={`tracker-content ${tab === 'videos' ? 'video-content' : ''}`}>
        {loading && <LoadingState />}
        {!loading && tab === 'dashboard' && dashboard && (
          <DashboardScreen data={dashboard} onStart={() => setTab('log')} />
        )}
        {!loading && tab === 'log' && (
          <WorkoutLogger
            exercises={exercises}
            onSave={saveWorkout}
            onCancel={() => setTab('dashboard')}
          />
        )}
        {!loading && tab === 'progress' && <ProgressScreen exercises={exercises} />}
        {!loading && tab === 'history' && (
          <HistoryScreen
            workouts={workouts}
            onDelete={deleteWorkout}
            onImport={importWorkoutCsv}
            onExport={exportWorkoutCsv}
            onDeleteSamples={deleteSampleData}
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
        <NavButton
          active={tab === 'progress'}
          label="Progress"
          icon="↗"
          onClick={() => setTab('progress')}
        />
        <button
          className={`nav-log ${tab === 'log' ? 'active' : ''}`}
          onClick={() => setTab('log')}
        >
          <span>＋</span>
          Log
        </button>
        <NavButton
          active={tab === 'history'}
          label="History"
          icon="◷"
          onClick={() => setTab('history')}
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

function DashboardScreen({ data, onStart }: { data: DashboardData; onStart: () => void }) {
  const [activeMetric, setActiveMetric] = useState<DashboardMetric | null>(null);

  return (
    <section className="dashboard-screen content-page">
      <div className="welcome-row">
        <div>
          <p className="section-kicker">TRAINING DASHBOARD</p>
          <h1>Keep the momentum.</h1>
          <p>Your week at a glance, with every set adding to the story.</p>
        </div>
        <button className="quick-start" onClick={onStart}>
          Start
        </button>
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
          value={Math.round(data.volume_this_week_kg).toLocaleString()}
          label="Volume"
          suffix="kg this week"
          onClick={() => setActiveMetric('volume')}
        />
        <MetricCard
          value={data.current_streak}
          label="Day streak"
          suffix={data.current_streak ? 'keep it going' : 'ready to begin'}
          onClick={() => setActiveMetric('streak')}
        />
      </div>

      <section className="panel heatmap-panel">
        <div className="panel-heading">
          <div>
            <p className="section-kicker">CONSISTENCY</p>
            <h2>Training heatmap</h2>
          </div>
          <small>Last 20 weeks</small>
        </div>
        <WorkoutHeatmap entries={data.heatmap} />
        <div className="heatmap-legend">
          {(Object.keys(categoryNames) as WorkoutCategory[])
            .filter((category) => category !== 'other' && category !== 'full_body')
            .map((category) => (
              <span key={category}>
                <i style={{ background: categoryColors[category] }} /> {categoryNames[category]}
              </span>
            ))}
        </div>
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
          data.recent_workouts.map((workout) => (
            <WorkoutSummary key={workout.id} workout={workout} />
          ))
        )}
      </section>

      {activeMetric && (
        <WeeklyInsight data={data} metric={activeMetric} onClose={() => setActiveMetric(null)} />
      )}
    </section>
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
    volume: 'Weekly training volume',
    streak: 'Training streak',
  }[metric];

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="weekly-insight"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onMouseDown={(event) => event.stopPropagation()}
      >
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
          ) : metric === 'volume' ? (
            data.weekly_days.map((day) => (
              <article className="weekly-day-card" key={day.workout_date}>
                <div className="weekly-day-heading">
                  <strong>{weekday(day.workout_date)}</strong>
                  <b>{Math.round(day.volume_kg).toLocaleString()} kg</b>
                </div>
                {day.exercises
                  .filter((exercise) => exercise.volume_kg > 0)
                  .map((exercise) => (
                    <div className="weekly-exercise-line" key={exercise.exercise_id}>
                      <span>{exercise.exercise_name}</span>
                      <small>{Math.round(exercise.volume_kg).toLocaleString()} kg</small>
                    </div>
                  ))}
              </article>
            ))
          ) : (
            <StreakBreakdown data={data} />
          )}
        </div>
      </section>
    </div>
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
      <p>A training day counts whether you lift, do cardio, or combine both.</p>
    </div>
  );
}

function weekday(value: string): string {
  return new Date(`${value}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short' });
}

function WorkoutHeatmap({ entries }: { entries: DashboardData['heatmap'] }) {
  const map = new Map(entries.map((entry) => [entry.workout_date, entry]));
  const dates = useMemo(() => {
    const end = new Date();
    end.setHours(12, 0, 0, 0);
    const start = new Date(end);
    start.setDate(start.getDate() - 139 - start.getDay());
    return Array.from({ length: 140 + end.getDay() }, (_, index) => {
      const next = new Date(start);
      next.setDate(start.getDate() + index);
      return next;
    });
  }, []);

  return (
    <div className="heatmap-scroll">
      <div className="heatmap-grid">
        {dates.map((day) => {
          const key = day.toISOString().slice(0, 10);
          const entry = map.get(key);
          const colours = entry?.categories.map((category) => categoryColors[category]) ?? [];
          const background =
            colours.length > 1
              ? `linear-gradient(135deg, ${colours[0]} 0 49%, ${colours[1]} 51% 100%)`
              : (colours[0] ?? '#222926');
          return (
            <span
              className="heatmap-day"
              key={key}
              style={{ background }}
              title={
                entry
                  ? `${prettyDate(key)}: ${entry.workout_count} workout, ${entry.set_count} sets`
                  : prettyDate(key)
              }
            />
          );
        })}
      </div>
    </div>
  );
}

function WorkoutSummary({ workout }: { workout: TrackedWorkout }) {
  const completedSets = workout.movements
    .flatMap((movement) => movement.sets)
    .filter((item) => item.completed);
  const volume = completedSets.reduce(
    (sum, item) => sum + (item.weight_kg ?? 0) * (item.reps ?? 0),
    0,
  );
  return (
    <article className="workout-summary">
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
      <div className="summary-stat">
        <strong>{Math.round(volume).toLocaleString()}</strong>
        <small>kg</small>
      </div>
    </article>
  );
}

function WorkoutLogger({
  exercises,
  onSave,
  onCancel,
}: {
  exercises: Exercise[];
  onSave: (payload: WorkoutInput) => Promise<void>;
  onCancel: () => void;
}) {
  const [name, setName] = useState('');
  const [workoutDate, setWorkoutDate] = useState(localDate());
  const [category, setCategory] = useState<WorkoutCategory>('push');
  const [notes, setNotes] = useState('');
  const [movements, setMovements] = useState<DraftMovement[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [restLeft, setRestLeft] = useState(0);
  const startedAt = useState(() => Date.now())[0];

  useEffect(() => {
    const timer = window.setInterval(
      () => setElapsed(Math.floor((Date.now() - startedAt) / 1000)),
      1000,
    );
    return () => window.clearInterval(timer);
  }, [startedAt]);

  useEffect(() => {
    if (restLeft <= 0) return;
    const timer = window.setInterval(
      () => setRestLeft((current) => Math.max(0, current - 1)),
      1000,
    );
    return () => window.clearInterval(timer);
  }, [restLeft]);

  function addExercise(exercise: Exercise) {
    setMovements((current) => [
      ...current,
      { key: crypto.randomUUID(), exercise, notes: '', sets: [emptySet(exercise.kind)] },
    ]);
    if (!name) setName(`${categoryNames[category]} workout`);
    setPickerOpen(false);
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

  function addSet(movement: DraftMovement) {
    setMovements((current) =>
      current.map((item) =>
        item.key === movement.key
          ? { ...item, sets: [...item.sets, emptySet(item.exercise.kind, item.sets.at(-1))] }
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
        duration_minutes: Math.max(1, Math.round(elapsed / 60)),
        movements: movements.map((movement) => ({
          exercise_id: movement.exercise.id,
          notes: movement.notes.trim() || null,
          sets: movement.sets.map((item) => ({
            reps: item.reps,
            weight_kg: item.weight_kg,
            rpe: item.rpe,
            rest_seconds: item.rest_seconds,
            duration_seconds: item.duration_seconds,
            distance_km: item.distance_km,
            notes: item.notes,
            completed: item.completed,
          })),
        })),
      });
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Could not save the workout.');
      setSaving(false);
    }
  }

  return (
    <section className="logger-screen content-page">
      <div className="live-workout-bar">
        <button onClick={onCancel}>Cancel</button>
        <div>
          <span className="live-dot" /> LIVE · {formatDuration(elapsed)}
        </div>
        <button className="finish-button" disabled={saving} onClick={() => void finishWorkout()}>
          {saving ? 'Saving…' : 'Finish'}
        </button>
      </div>

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
        </div>
      </section>

      {error && <p className="inline-error">{error}</p>}

      <div className="movement-stack">
        {movements.map((movement, movementIndex) => (
          <MovementCard
            key={movement.key}
            movement={movement}
            number={movementIndex + 1}
            onUpdateSet={(setKey, update) => updateSet(movement.key, setKey, update)}
            onToggleSet={(item) => toggleSet(movement, item)}
            onAddSet={() => addSet(movement)}
            onRemove={() => removeMovement(movement.key)}
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

      <button className="add-exercise-button" onClick={() => setPickerOpen(true)}>
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

      {pickerOpen && (
        <ExercisePicker
          exercises={exercises}
          onChoose={addExercise}
          onClose={() => setPickerOpen(false)}
        />
      )}
      {restLeft > 0 && (
        <RestTimer
          seconds={restLeft}
          onAdd={() => setRestLeft((current) => current + 30)}
          onSkip={() => setRestLeft(0)}
        />
      )}
    </section>
  );
}

function MovementCard({
  movement,
  number,
  onUpdateSet,
  onToggleSet,
  onAddSet,
  onRemove,
  onMovementNotes,
}: {
  movement: DraftMovement;
  number: number;
  onUpdateSet: (setKey: string, update: Partial<DraftSet>) => void;
  onToggleSet: (item: DraftSet) => void;
  onAddSet: () => void;
  onRemove: () => void;
  onMovementNotes: (value: string) => void;
}) {
  const cardio = movement.exercise.kind === 'cardio';
  return (
    <article className="movement-card panel">
      <header>
        <span className="movement-number">{number}</span>
        <div>
          <h2>{movement.exercise.name}</h2>
          <p>
            {movement.exercise.muscle_group} · {movement.exercise.equipment}
          </p>
        </div>
        <button
          className="icon-button"
          onClick={onRemove}
          aria-label={`Remove ${movement.exercise.name}`}
        >
          ×
        </button>
      </header>

      <div className={`set-grid set-grid-${cardio ? 'cardio' : 'strength'}`}>
        <div className="set-grid-head">
          <span>SET</span>
          {cardio ? (
            <>
              <span>MIN</span>
              <span>KM</span>
            </>
          ) : (
            <>
              <span>KG</span>
              <span>REPS</span>
            </>
          )}
          <span>RPE</span>
          <span>DONE</span>
        </div>
        {movement.sets.map((item, index) => (
          <div className={`set-row ${item.completed ? 'completed' : ''}`} key={item.key}>
            <span className="set-index">{index + 1}</span>
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
              onChange={(event) => onUpdateSet(item.key, { rpe: numberOrNull(event.target.value) })}
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
                      {seconds < 60 ? `${seconds}s` : `${seconds / 60}m`}
                    </option>
                  ))}
                </select>
              </label>
              <input
                value={item.notes ?? ''}
                onChange={(event) => onUpdateSet(item.key, { notes: event.target.value || null })}
                placeholder="Set note (optional)"
              />
            </div>
          </div>
        ))}
      </div>
      <button className="add-set-button" onClick={onAddSet}>
        ＋ Add set
      </button>
      <input
        className="movement-note"
        value={movement.notes}
        onChange={(event) => onMovementNotes(event.target.value)}
        placeholder="Exercise note for next time…"
      />
    </article>
  );
}

function ExercisePicker({
  exercises,
  onChoose,
  onClose,
}: {
  exercises: Exercise[];
  onChoose: (exercise: Exercise) => void;
  onClose: () => void;
}) {
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<WorkoutCategory | 'all'>('all');
  const filtered = exercises.filter(
    (exercise) =>
      (filter === 'all' || exercise.category === filter) &&
      `${exercise.name} ${exercise.muscle_group}`.toLowerCase().includes(search.toLowerCase()),
  );
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="exercise-picker"
        role="dialog"
        aria-modal="true"
        aria-label="Choose exercise"
      >
        <header>
          <div>
            <p className="section-kicker">EXERCISE LIBRARY</p>
            <h2>Add movement</h2>
          </div>
          <button className="icon-button" onClick={onClose}>
            ×
          </button>
        </header>
        <input
          className="exercise-search"
          autoFocus
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search exercises or muscles…"
        />
        <div className="filter-pills">
          <button className={filter === 'all' ? 'active' : ''} onClick={() => setFilter('all')}>
            All
          </button>
          {(['push', 'pull', 'lower', 'upper', 'cardio'] as WorkoutCategory[]).map((category) => (
            <button
              key={category}
              className={filter === category ? 'active' : ''}
              onClick={() => setFilter(category)}
            >
              {categoryNames[category]}
            </button>
          ))}
        </div>
        <div className="exercise-list">
          {filtered.map((exercise) => (
            <button key={exercise.id} onClick={() => onChoose(exercise)}>
              <i style={{ background: categoryColors[exercise.category] }} />
              <span>
                <strong>{exercise.name}</strong>
                <small>
                  {exercise.muscle_group} · {exercise.equipment}
                </small>
              </span>
              <b>＋</b>
            </button>
          ))}
          {!filtered.length && <p className="muted-empty">No exercises match that search.</p>}
        </div>
      </section>
    </div>
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
    <aside className="rest-timer">
      <div>
        <span>REST TIMER</span>
        <strong>{formatDuration(seconds)}</strong>
      </div>
      <button onClick={onAdd}>+30s</button>
      <button onClick={onSkip}>Skip</button>
    </aside>
  );
}

function ProgressScreen({ exercises }: { exercises: Exercise[] }) {
  const strengthExercises = exercises.filter((exercise) => exercise.kind === 'strength');
  const [exerciseId, setExerciseId] = useState(strengthExercises[0]?.id ?? '');
  const [metric, setMetric] = useState<ProgressMetric>('estimated_1rm');
  const [progress, setProgress] = useState<ExerciseProgress | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!exerciseId) return;
    setLoading(true);
    void api
      .exerciseProgress(exerciseId)
      .then(setProgress)
      .finally(() => setLoading(false));
  }, [exerciseId]);

  return (
    <section className="progress-screen content-page">
      <div className="screen-intro">
        <p className="section-kicker">PERFORMANCE</p>
        <h1>Movement progress</h1>
        <p>Follow your best work over time and spot the trend.</p>
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
                <h2>{progress.exercise.name}</h2>
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
          {progress.points
            .slice()
            .reverse()
            .map((point) => (
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
  const values = progress.points.map((point) => point[metric]);
  const maximum = Math.max(...values, 1);
  const minimum = Math.min(...values, 0);
  const width = 340;
  const height = 170;
  const padding = 18;
  const points = values.map((value, index) => {
    const x = padding + (index / Math.max(values.length - 1, 1)) * (width - padding * 2);
    const y =
      height -
      padding -
      ((value - minimum) / Math.max(maximum - minimum, 1)) * (height - padding * 2);
    return { x, y, value };
  });
  return (
    <div className="chart-wrap">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Exercise progress chart">
        <defs>
          <linearGradient id="chart-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#e14a3b" stopOpacity="0.28" />
            <stop offset="1" stopColor="#e14a3b" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path
          className="chart-area"
          d={`M ${points[0].x} ${height - padding} ${points.map((point) => `L ${point.x} ${point.y}`).join(' ')} L ${points.at(-1)!.x} ${height - padding} Z`}
        />
        <polyline points={points.map((point) => `${point.x},${point.y}`).join(' ')} />
        {points.map((point, index) => (
          <circle key={index} cx={point.x} cy={point.y} r="4" />
        ))}
      </svg>
      <div className="chart-labels">
        <span>{prettyDate(progress.points[0].workout_date)}</span>
        <span>{prettyDate(progress.points.at(-1)!.workout_date)}</span>
      </div>
    </div>
  );
}

function HistoryScreen({
  workouts,
  onDelete,
  onImport,
  onExport,
  onDeleteSamples,
}: {
  workouts: TrackedWorkout[];
  onDelete: (workout: TrackedWorkout) => void;
  onImport: (file: File) => Promise<void>;
  onExport: () => Promise<void>;
  onDeleteSamples: () => Promise<void>;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  return (
    <section className="history-screen content-page">
      <div className="screen-intro history-intro">
        <div>
          <p className="section-kicker">TRAINING LOG</p>
          <h1>Workout history</h1>
          <p>
            {workouts.length} saved {workouts.length === 1 ? 'session' : 'sessions'}.
          </p>
        </div>
        <div className="data-actions">
          <button onClick={() => fileInput.current?.click()} disabled={importing}>
            {importing ? 'Importing…' : '↑ Import CSV'}
          </button>
          <button onClick={() => void onExport()}>↓ Export CSV</button>
          {workouts.some((workout) => workout.is_sample) && (
            <button className="sample-clear" onClick={() => void onDeleteSamples()}>
              Remove samples
            </button>
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
        <EmptyState title="Your log is empty" body="Your completed workouts will show up here." />
      )}
      {workouts.map((workout) => {
        const open = openId === workout.id;
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
                  {prettyDate(workout.workout_date)} · {workout.duration_minutes ?? '–'} min
                </small>
              </div>
              <b>{open ? '−' : '+'}</b>
            </button>
            {open && (
              <div className="history-detail">
                {workout.movements.map((movement) => (
                  <div className="history-movement" key={movement.id}>
                    <strong>{movement.exercise.name}</strong>
                    <span>
                      {movement.sets
                        .filter((item) => item.completed)
                        .map((item) =>
                          item.weight_kg !== null
                            ? `${item.weight_kg} × ${item.reps ?? '–'}`
                            : item.duration_seconds
                              ? `${Math.round(item.duration_seconds / 60)} min`
                              : `${item.reps ?? '–'} reps`,
                        )
                        .join(' · ')}
                    </span>
                    {movement.sets
                      .filter((item) => item.notes)
                      .map((item) => (
                        <small key={item.id}>
                          Set {item.order_index + 1}: {item.notes}
                        </small>
                      ))}
                  </div>
                ))}
                {workout.notes && <p>{workout.notes}</p>}
                <button className="delete-workout" onClick={() => onDelete(workout)}>
                  Delete workout
                </button>
              </div>
            )}
          </article>
        );
      })}
    </section>
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

import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { api } from './api';
import type {
  BodyMeasurement,
  DashboardData,
  Exercise,
  ExerciseProgress,
  MachinePhoto,
  TrackedSet,
  TrackedWorkout,
  TrainingMode,
  WorkoutCategory,
  WorkoutInput,
  WorkoutRecommendation,
  WorkoutSetInput,
  WeeklyGoal,
} from './types';
import { localDate } from './utils';
import { VideoUpload } from './VideoUpload';

type AppTab = 'dashboard' | 'log' | 'body' | 'history' | 'videos';
type ProgressMetric = 'estimated_1rm' | 'best_weight_kg' | 'volume_kg';
type DashboardMetric = 'workouts' | 'sets' | 'streak';

type DraftSet = WorkoutSetInput & { key: string };
type DraftMovement = {
  key: string;
  exercise: Exercise;
  notes: string;
  machinePhotoIds: string[];
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
  const [workoutStartDate, setWorkoutStartDate] = useState(localDate());
  const [editingWorkout, setEditingWorkout] = useState<TrackedWorkout | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);

  async function refreshData() {
    try {
      const [nextDashboard, nextExercises, nextWorkouts, nextMeasurements] = await Promise.all([
        api.dashboard(),
        api.listExercises(),
        api.listWorkouts(),
        api.listBodyMeasurements(),
      ]);
      setDashboard(nextDashboard);
      setExercises(nextExercises);
      setWorkouts(nextWorkouts);
      setMeasurements(nextMeasurements);
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
    if (editingWorkout) await api.updateWorkout(editingWorkout.id, payload);
    else await api.createWorkout(payload);
    await refreshData();
    setTab(editingWorkout ? 'history' : 'dashboard');
    setMessage(editingWorkout ? 'Workout changes saved.' : 'Workout saved. Nice work.');
    setEditingWorkout(null);
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

  function startWorkout(workoutDate = localDate()) {
    if (!window.confirm('Start a new workout now?')) return;
    setEditingWorkout(null);
    setWorkoutStartDate(workoutDate);
    setTab('log');
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
    await api.deleteBodyMeasurement(id);
    await refreshData();
    setMessage('Body measurement deleted.');
  }

  async function updateTrainingMode(mode: TrainingMode) {
    try {
      await api.updateTrainingMode(mode);
      await refreshData();
      setMessage(`Training mode changed to ${mode}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not update the training mode.');
    }
  }

  return (
    <div className="tracker-app">
      {message && (
        <button className="toast-message" onClick={() => setMessage(null)}>
          {message}
        </button>
      )}

      <main className={`tracker-content ${tab === 'videos' ? 'video-content' : ''}`}>
        {loading && <LoadingState />}
        {!loading && tab === 'dashboard' && dashboard && (
          <DashboardScreen
            data={dashboard}
            currentBodyweight={measurements[0]?.weight_kg ?? null}
            onStart={startWorkout}
            onBody={() => setTab('body')}
            onEditWorkout={(id) => {
              const workout = workouts.find((item) => item.id === id);
              if (workout) editWorkout(workout);
            }}
            onTrainingMode={updateTrainingMode}
          />
        )}
        {!loading && tab === 'log' && (
          <WorkoutLogger
            exercises={exercises}
            recommendation={dashboard?.recommendation ?? null}
            initialDate={workoutStartDate}
            initialWorkout={editingWorkout}
            currentBodyweight={measurements[0]?.weight_kg ?? null}
            onSave={saveWorkout}
            onCancel={() => {
              setTab(editingWorkout ? 'history' : 'dashboard');
              setEditingWorkout(null);
            }}
          />
        )}
        {!loading && tab === 'body' && (
          <BodyCompositionScreen
            measurements={measurements}
            onSave={saveMeasurement}
            onDelete={deleteMeasurement}
          />
        )}
        {!loading && tab === 'history' && (
          <HistoryScreen
            workouts={workouts}
            measurements={measurements}
            exercises={exercises}
            currentBodyweight={measurements[0]?.weight_kg ?? null}
            onEdit={editWorkout}
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
        <NavButton active={tab === 'body'} label="Body" icon="◒" onClick={() => setTab('body')} />
        <button
          className={`nav-log ${tab === 'log' ? 'active' : ''}`}
          onClick={() => startWorkout()}
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

function DashboardScreen({
  data,
  currentBodyweight,
  onStart,
  onBody,
  onEditWorkout,
  onTrainingMode,
}: {
  data: DashboardData;
  currentBodyweight: number | null;
  onStart: (workoutDate?: string) => void;
  onBody: () => void;
  onEditWorkout: (workoutId: string) => void;
  onTrainingMode: (mode: TrainingMode) => Promise<void>;
}) {
  const [activeMetric, setActiveMetric] = useState<DashboardMetric | null>(null);
  const [calendarMonths, setCalendarMonths] = useState<number | 'all'>(6);
  const [selectedDay, setSelectedDay] = useState<DashboardData['heatmap'][number] | null>(null);

  return (
    <section className="dashboard-screen content-page">
      <div className="welcome-row">
        <div>
          <p className="section-kicker">TRAINING DASHBOARD</p>
          <h1>Keep the momentum.</h1>
        </div>
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

      <WeeklyGoalCard goal={data.weekly_goal} onModeChange={onTrainingMode} />

      <section className="panel heatmap-panel">
        <div className="panel-heading">
          <div>
            <p className="section-kicker">CONSISTENCY</p>
            <h2>Training calendar</h2>
          </div>
          <label className="calendar-range">
            Range
            <select
              value={calendarMonths}
              onChange={(event) =>
                setCalendarMonths(event.target.value === 'all' ? 'all' : Number(event.target.value))
              }
            >
              <option value={3}>3 months</option>
              <option value={6}>6 months</option>
              <option value={12}>12 months</option>
              <option value="all">All history</option>
            </select>
          </label>
        </div>
        <WorkoutHeatmap
          entries={data.heatmap}
          monthCount={calendarMonths}
          onDayClick={(workoutDate, entry) => {
            if (entry) setSelectedDay(entry);
            else if (workoutDate === localDate()) onStart(workoutDate);
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
      {selectedDay && (
        <CalendarDayDetail
          day={selectedDay}
          onClose={() => setSelectedDay(null)}
          onEditWorkout={onEditWorkout}
        />
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

const trainingModeLabels: Record<TrainingMode, string> = {
  cut: 'Cut',
  maintenance: 'Maintenance',
  bulk: 'Bulk',
};

function WeeklyGoalCard({
  goal,
  onModeChange,
}: {
  goal: WeeklyGoal;
  onModeChange: (mode: TrainingMode) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [changing, setChanging] = useState(false);
  const targetTotal = goal.target_sets_per_muscle * goal.muscle_groups.length;
  const belowTarget = goal.muscle_groups.filter((item) => item.status === 'below').length;
  const displayedPercent = Math.min(goal.overall_percent, 100);

  async function changeMode(mode: TrainingMode) {
    if (mode === goal.mode || changing) return;
    setChanging(true);
    try {
      await onModeChange(mode);
    } finally {
      setChanging(false);
    }
  }

  return (
    <>
      <section className={`panel weekly-goal-card goal-mode-${goal.mode}`}>
        <div className="weekly-goal-topline">
          <div>
            <p className="section-kicker">WEEKLY GOAL</p>
            <h2>{trainingModeLabels[goal.mode]} phase</h2>
          </div>
          <div className="goal-mode-tabs" aria-label="Training phase">
            {(Object.keys(trainingModeLabels) as TrainingMode[]).map((mode) => (
              <button
                type="button"
                className={goal.mode === mode ? 'active' : ''}
                disabled={changing}
                onClick={() => void changeMode(mode)}
                key={mode}
              >
                {trainingModeLabels[mode]}
              </button>
            ))}
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
      {open && (
        <WeeklyGoalDetail
          goal={goal}
          changing={changing}
          onModeChange={changeMode}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

function WeeklyGoalDetail({
  goal,
  changing,
  onModeChange,
  onClose,
}: {
  goal: WeeklyGoal;
  changing: boolean;
  onModeChange: (mode: TrainingMode) => Promise<void>;
  onClose: () => void;
}) {
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="weekly-goal-detail"
        role="dialog"
        aria-modal="true"
        aria-label="Weekly training goal"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <p className="section-kicker">TRAINING PHASE</p>
            <h2>Your weekly target</h2>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>
        <div className="goal-mode-tabs goal-mode-tabs-large" aria-label="Training phase">
          {(Object.keys(trainingModeLabels) as TrainingMode[]).map((mode) => (
            <button
              type="button"
              className={goal.mode === mode ? 'active' : ''}
              disabled={changing}
              onClick={() => void onModeChange(mode)}
              key={mode}
            >
              {trainingModeLabels[mode]}
              <small>{mode === 'cut' ? 10 : mode === 'maintenance' ? 12 : 14} sets / muscle</small>
            </button>
          ))}
        </div>
        <div className="goal-explainer">
          <strong>{goal.target_sets_per_muscle} hard sets per active muscle</strong>
          <p>
            Completed strength sets at RPE 7–10 count. Warmups, cardio, and lower-effort sets do not
            fill the bar; secondary muscles receive half credit.
          </p>
        </div>
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
    </div>
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

function WorkoutHeatmap({
  entries,
  monthCount,
  onDayClick,
}: {
  entries: DashboardData['heatmap'];
  monthCount: number | 'all';
  onDayClick: (workoutDate: string, entry: DashboardData['heatmap'][number] | undefined) => void;
}) {
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
    });
  }, [entries, monthCount]);
  const todayKey = localCalendarDate(new Date());

  return (
    <div className="calendar-scroll">
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
                  disabled={!entry && key !== todayKey}
                  onClick={() => onDayClick(key, entry)}
                  title={
                    entry
                      ? `${prettyDate(key)}: ${entry.workout_count} ${entry.workout_count === 1 ? 'workout' : 'workouts'}, ${entry.set_count} sets`
                      : prettyDate(key)
                  }
                >
                  {day.getDate()}
                  {entry && entry.workout_count > 1 && <b>{entry.workout_count}</b>}
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
  onEditWorkout,
}: {
  day: DashboardData['heatmap'][number];
  onClose: () => void;
  onEditWorkout: (workoutId: string) => void;
}) {
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="calendar-day-detail"
        role="dialog"
        aria-modal="true"
        aria-label={`Workouts for ${prettyDate(day.workout_date)}`}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <p className="section-kicker">TRAINING DAY</p>
            <h2>{prettyDate(day.workout_date)}</h2>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>
        <div className="calendar-day-workouts">
          {day.workouts.map((workout) => (
            <article key={workout.id}>
              <div>
                <i style={{ background: categoryColors[workout.category] }} />
                <div>
                  <strong>{workout.name}</strong>
                  <small>
                    {categoryNames[workout.category]} · {workout.duration_minutes ?? '–'} min
                  </small>
                </div>
              </div>
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
                Edit workout
              </button>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}

function localCalendarDate(value: Date): string {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
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
  recommendation,
  initialDate,
  initialWorkout,
  currentBodyweight,
  onSave,
  onCancel,
}: {
  exercises: Exercise[];
  recommendation: WorkoutRecommendation | null;
  initialDate: string;
  initialWorkout: TrackedWorkout | null;
  currentBodyweight: number | null;
  onSave: (payload: WorkoutInput) => Promise<void>;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initialWorkout?.name ?? '');
  const [workoutDate, setWorkoutDate] = useState(initialDate);
  const [category, setCategory] = useState<WorkoutCategory>(
    initialWorkout?.category ?? recommendation?.category ?? 'push',
  );
  const [notes, setNotes] = useState(initialWorkout?.notes ?? '');
  const [movements, setMovements] = useState<DraftMovement[]>(() =>
    initialWorkout
      ? initialWorkout.movements.map((movement) => ({
          key: crypto.randomUUID(),
          exercise: movement.exercise,
          notes: movement.notes ?? '',
          machinePhotoIds: movement.machine_photos.map((photo) => photo.id),
          sets: movement.sets.map((item) => ({
            key: crypto.randomUUID(),
            reps: item.reps,
            weight_kg: item.weight_kg,
            rpe: item.rpe,
            rest_seconds: item.rest_seconds,
            duration_seconds: item.duration_seconds,
            distance_km: item.distance_km,
            bodyweight_kg: item.bodyweight_kg,
            percentile: item.percentile,
            warmup: item.warmup,
            notes: item.notes,
            completed: item.completed,
          })),
        }))
      : [],
  );
  const [pickerOpen, setPickerOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState((initialWorkout?.duration_minutes ?? 0) * 60);
  const [restLeft, setRestLeft] = useState(0);
  const startedAt = useState(() => Date.now())[0];

  useEffect(() => {
    if (initialWorkout) return;
    const timer = window.setInterval(
      () => setElapsed(Math.floor((Date.now() - startedAt) / 1000)),
      1000,
    );
    return () => window.clearInterval(timer);
  }, [initialWorkout, startedAt]);

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
      {
        key: crypto.randomUUID(),
        exercise,
        notes: '',
        machinePhotoIds: [],
        sets: [emptySet(exercise.kind)],
      },
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
        duration_minutes: initialWorkout?.duration_minutes ?? Math.max(1, Math.round(elapsed / 60)),
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
            bodyweight_kg: item.bodyweight_kg,
            percentile: item.percentile,
            warmup: item.warmup,
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
          {!initialWorkout && <span className="live-dot" />}
          {initialWorkout ? 'EDIT WORKOUT' : ` LIVE · ${formatDuration(elapsed)}`}
        </div>
        <button className="finish-button" disabled={saving} onClick={() => void finishWorkout()}>
          {saving ? 'Saving…' : initialWorkout ? 'Save' : 'Finish'}
        </button>
      </div>

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
        </div>
      </section>

      {error && <p className="inline-error">{error}</p>}

      <div className="movement-stack">
        {movements.map((movement, movementIndex) => (
          <MovementCard
            key={movement.key}
            movement={movement}
            number={movementIndex + 1}
            currentBodyweight={currentBodyweight}
            onUpdateSet={(setKey, update) => updateSet(movement.key, setKey, update)}
            onToggleSet={(item) => toggleSet(movement, item)}
            onAddSet={() => addSet(movement)}
            onRemove={() => removeMovement(movement.key)}
            onMachinePhotos={(machinePhotoIds) =>
              setMovements((current) =>
                current.map((item) =>
                  item.key === movement.key ? { ...item, machinePhotoIds } : item,
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
          currentBodyweight={currentBodyweight}
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
  currentBodyweight,
  onUpdateSet,
  onToggleSet,
  onAddSet,
  onRemove,
  onMachinePhotos,
  onMovementNotes,
}: {
  movement: DraftMovement;
  number: number;
  currentBodyweight: number | null;
  onUpdateSet: (setKey: string, update: Partial<DraftSet>) => void;
  onToggleSet: (item: DraftSet) => void;
  onAddSet: () => void;
  onRemove: () => void;
  onMachinePhotos: (photoIds: string[]) => void;
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
            {currentBodyweight !== null && ` · @ ${currentBodyweight} kg`}
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

      {!cardio && (
        <MachinePhotoChooser
          exercise={movement.exercise}
          selectedIds={movement.machinePhotoIds}
          onChange={onMachinePhotos}
        />
      )}

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
          <Fragment key={item.key}>
            <div className={`set-row ${item.completed ? 'completed' : ''}`}>
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

function MachinePhotoChooser({
  exercise,
  selectedIds,
  onChange,
}: {
  exercise: Exercise;
  selectedIds: string[];
  onChange: (photoIds: string[]) => void;
}) {
  const [photos, setPhotos] = useState<MachinePhoto[]>([]);
  const [pending, setPending] = useState<{ file: File; previewUrl: string } | null>(null);
  const [caption, setCaption] = useState('');
  const [expanded, setExpanded] = useState<MachinePhoto | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void api
      .listMachinePhotos(exercise.id)
      .then((items) => {
        if (active) setPhotos(items);
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
      onChange([...new Set([...selectedIds, photo.id])]);
      setPending(null);
      setCaption('');
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : 'Could not save that photo.');
    } finally {
      setUploading(false);
    }
  }

  function togglePhoto(photoId: string) {
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

  return (
    <section className="machine-photo-picker" aria-label={`Machine photos for ${exercise.name}`}>
      <div className="machine-photo-heading">
        <div>
          <strong>Machine used</strong>
          <small>Pin one or more photos to every set in this exercise.</small>
        </div>
        {selectedIds.length > 0 && <span>{selectedIds.length} pinned</span>}
      </div>
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
        <div className="machine-photo-rail">
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
                <button type="button" className="machine-pin" onClick={() => togglePhoto(photo.id)}>
                  {selected ? '✓ Pinned' : 'Pin to sets'}
                </button>
              </article>
            );
          })}
        </div>
      )}
      {error && <p className="machine-photo-error">{error}</p>}

      {pending && (
        <div className="modal-backdrop photo-modal-backdrop" role="presentation">
          <section className="photo-caption-dialog" role="dialog" aria-modal="true">
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
              <div className="photo-dialog-actions">
                <button type="button" onClick={() => setPending(null)} disabled={uploading}>
                  Cancel
                </button>
                <button type="button" onClick={() => void uploadPhoto()} disabled={uploading}>
                  {uploading ? 'Saving…' : 'Save and pin'}
                </button>
              </div>
            </div>
          </section>
        </div>
      )}
      {expanded && (
        <MachinePhotoLightbox
          photo={expanded}
          onClose={() => setExpanded(null)}
          onUpdate={updatePhoto}
          onDelete={deletePhoto}
        />
      )}
    </section>
  );
}

function MachinePhotoLightbox({
  photo,
  onClose,
  onUpdate,
  onDelete,
}: {
  photo: MachinePhoto;
  onClose: () => void;
  onUpdate?: (photo: MachinePhoto, caption: string) => Promise<void>;
  onDelete?: (photo: MachinePhoto) => Promise<void>;
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
    if (!onDelete || !window.confirm(`Delete “${photo.caption}” from the machine library?`)) return;
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
    <div
      className="photo-lightbox"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section role="dialog" aria-modal="true" aria-label={photo.caption}>
        <button className="photo-lightbox-close" type="button" onClick={onClose} aria-label="Close">
          ×
        </button>
        <img src={photo.full_url} alt={photo.caption} />
        <div className="photo-lightbox-caption">
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
          {onDelete && (
            <button
              className="photo-delete"
              type="button"
              onClick={() => void removePhoto()}
              disabled={saving}
            >
              Delete
            </button>
          )}
          {error && <p>{error}</p>}
        </div>
      </section>
    </div>
  );
}

function ExercisePicker({
  exercises,
  currentBodyweight,
  onChoose,
  onClose,
}: {
  exercises: Exercise[];
  currentBodyweight: number | null;
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
                  {currentBodyweight !== null && ` · @ ${currentBodyweight} kg`}
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

function ProgressScreen({
  exercises,
  currentBodyweight,
  embedded = false,
}: {
  exercises: Exercise[];
  currentBodyweight: number | null;
  embedded?: boolean;
}) {
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
  return (
    <div className="chart-wrap">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Exercise progress chart">
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
      </svg>
    </div>
  );
}

function BodyCompositionScreen({
  measurements,
  onSave,
  onDelete,
}: {
  measurements: BodyMeasurement[];
  onSave: (payload: {
    measurement_date: string;
    weight_kg: number;
    body_fat_pct: number | null;
    notes: string | null;
  }) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const [measurementDate, setMeasurementDate] = useState(localDate());
  const [weight, setWeight] = useState('');
  const [bodyFat, setBodyFat] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const latest = measurements[0];

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
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Could not save this measurement.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="body-screen content-page">
      <div className="screen-intro">
        <p className="section-kicker">BODY COMPOSITION</p>
        <h1>Track the change.</h1>
      </div>

      <div className="body-current-grid">
        <MetricCard
          value={latest ? `${latest.weight_kg} kg` : '–'}
          label="Current weight"
          suffix={latest ? prettyDate(latest.measurement_date) : 'No entries yet'}
        />
        <MetricCard
          value={latest && latest.body_fat_pct !== null ? `${latest.body_fat_pct}%` : '–'}
          label="Body fat"
          suffix={latest ? 'latest estimate' : 'optional'}
        />
      </div>

      <section className="panel body-entry-panel">
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
          <BodyTrendChart measurements={measurements} />
        </section>
      )}

      <section className="panel body-history-panel">
        <div className="panel-heading">
          <div>
            <p className="section-kicker">HISTORY</p>
            <h2>Check-ins</h2>
          </div>
        </div>
        {!measurements.length && (
          <p className="body-empty">Your first check-in will appear here.</p>
        )}
        {measurements.map((measurement) => (
          <article key={measurement.id}>
            <div>
              <strong>{measurement.weight_kg} kg</strong>
              <small>
                {prettyDate(measurement.measurement_date)}
                {measurement.body_fat_pct !== null && ` · ${measurement.body_fat_pct}% body fat`}
                {measurement.is_sample && ' · Sample'}
              </small>
              {measurement.notes && <p>{measurement.notes}</p>}
            </div>
            <button
              type="button"
              onClick={() => {
                if (window.confirm('Delete this body-composition check-in?')) {
                  void onDelete(measurement.id);
                }
              }}
            >
              Delete
            </button>
          </article>
        ))}
      </section>
    </section>
  );
}

function BodyTrendChart({ measurements }: { measurements: BodyMeasurement[] }) {
  const ordered = measurements.slice().reverse();
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

  function points(
    values: Array<number | null>,
    valueRange: { min: number; max: number } | null,
  ): string {
    if (!valueRange) return '';
    return values
      .map((value, index) => {
        if (value === null) return null;
        const x = left + (index / Math.max(ordered.length - 1, 1)) * (width - left - right);
        const ratio = (value - valueRange.min) / Math.max(valueRange.max - valueRange.min, 1);
        const y = height - bottom - ratio * (height - top - bottom);
        return `${x},${y}`;
      })
      .filter(Boolean)
      .join(' ');
  }

  const weightRange = range(weightValues)!;
  const fatRange = range(fatValues);
  const yFractions = [0, 0.5, 1];
  const xIndexes = [...new Set([0, Math.floor((ordered.length - 1) / 2), ordered.length - 1])];

  return (
    <div className="body-chart">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Body composition trend">
        {yFractions.map((fraction) => {
          const y = height - bottom - fraction * (height - top - bottom);
          const weightTick = weightRange.min + fraction * (weightRange.max - weightRange.min);
          const fatTick = fatRange ? fatRange.min + fraction * (fatRange.max - fatRange.min) : null;
          return (
            <g className="chart-axis" key={fraction}>
              <line x1={left} x2={width - right} y1={y} y2={y} />
              <text x={left - 5} y={y + 3} textAnchor="end">
                {weightTick.toFixed(1)}
              </text>
              {fatTick !== null && (
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
        <polyline className="weight-line" points={points(weightValues, weightRange)} />
        <polyline className="fat-line" points={points(fatValues, fatRange)} />
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
        <text className="chart-y-title weight-axis-title" x="4" y="11">
          Weight kg
        </text>
        {fatRange && (
          <text className="chart-y-title fat-axis-title" x={width - 3} y="11" textAnchor="end">
            Body fat %
          </text>
        )}
      </svg>
      <div>
        <span>
          <i className="weight" /> Weight
        </span>
        <span>
          <i className="fat" /> Body fat
        </span>
      </div>
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
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [section, setSection] = useState<'history' | 'progress'>('history');
  const [importing, setImporting] = useState(false);
  const [expandedPhoto, setExpandedPhoto] = useState<MachinePhoto | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
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
      </div>
      {section === 'progress' ? (
        <ProgressScreen exercises={exercises} currentBodyweight={currentBodyweight} embedded />
      ) : (
        <>
          <div className="screen-intro history-intro">
            <div>
              <p className="section-kicker">TRAINING LOG</p>
              <h1>Workout history</h1>
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
            <EmptyState
              title="Your log is empty"
              body="Your completed workouts will show up here."
            />
          )}
          {workouts.map((workout) => {
            const open = openId === workout.id;
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
                      {prettyDate(workout.workout_date)} · {workout.duration_minutes ?? '–'} min
                    </small>
                  </div>
                  <b>{open ? '−' : '+'}</b>
                </button>
                {open && (
                  <div className="history-detail">
                    {workout.movements.map((movement) => (
                      <div className="history-movement" key={movement.id}>
                        <strong>
                          {movement.exercise.name}
                          {workoutBodyweight !== null && ` @ ${workoutBodyweight} kg`}
                        </strong>
                        {movement.machine_photos.length > 0 && (
                          <div className="history-machine-photos">
                            {movement.machine_photos.map((photo) => (
                              <button
                                type="button"
                                key={photo.id}
                                onClick={() => setExpandedPhoto(photo)}
                                aria-label={`Expand ${photo.caption}`}
                              >
                                <img src={photo.thumbnail_url} alt={photo.caption} loading="lazy" />
                                <span>{photo.caption}</span>
                              </button>
                            ))}
                          </div>
                        )}
                        <HistorySetFlow sets={movement.sets.filter((item) => item.completed)} />
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
                      <button className="delete-workout" onClick={() => onDelete(workout)}>
                        Delete workout
                      </button>
                    </div>
                  </div>
                )}
              </article>
            );
          })}
        </>
      )}
      {expandedPhoto && (
        <MachinePhotoLightbox photo={expandedPhoto} onClose={() => setExpandedPhoto(null)} />
      )}
    </section>
  );
}

function HistorySetFlow({ sets }: { sets: TrackedSet[] }) {
  return (
    <div className="history-set-flow">
      {sets.map((item, index) => (
        <Fragment key={item.id}>
          <div className="history-set-pill">
            <b>Set {item.order_index + 1}</b>
            <span>{setResult(item)}</span>
            {item.rpe !== null && <small>RPE {item.rpe}</small>}
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
  if (item.duration_seconds) {
    const distance = item.distance_km !== null ? ` · ${item.distance_km} km` : '';
    return `${formatDuration(item.duration_seconds)}${distance}`;
  }
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

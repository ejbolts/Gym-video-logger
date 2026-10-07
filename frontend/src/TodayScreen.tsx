import { useEffect, useMemo, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { Icon } from './Icon';
import { Meter, SparkBars, Sparkline, TrainingHeatmap } from './PulseCharts';
import {
  averageOf,
  CATEGORY_LABELS,
  daysBetween,
  formatVolume,
  parseLocalDate,
  recentStrengthRecords,
  sessionTemplateFor,
  shortDate,
  trainingDayGrid,
  weekStartDayFrom,
  weeklyTrainingTotals,
  type SessionTemplate,
} from './trainingSummary';
import type {
  BodyMeasurement,
  DashboardData,
  PersonalRecord,
  TrackedWorkout,
  WorkoutTypeColors,
} from './types';
import { localDate } from './utils';
import { formatElapsed, useElapsedSeconds } from './elapsed';

export function PageHeader({
  eyebrow,
  title,
  actions,
}: {
  eyebrow?: string;
  title: string;
  actions?: ReactNode;
}) {
  return (
    <header className="page-header">
      <div>
        {eyebrow && <p className="page-eyebrow">{eyebrow}</p>}
        <h1>{title}</h1>
      </div>
      {actions && <div className="page-header-actions">{actions}</div>}
    </header>
  );
}

const RECORD_LABELS: Partial<Record<PersonalRecord['record_type'], string>> = {
  estimated_1rm: 'Estimated 1RM',
  weight: 'Heaviest weight',
};

export interface TodayScreenProps {
  data: DashboardData | null;
  workouts: TrackedWorkout[];
  measurements: BodyMeasurement[];
  personalRecords: PersonalRecord[];
  categoryColors: WorkoutTypeColors;
  workoutStartedAt: number | null;
  todayBodyweight: number | null;
  onSaveBodyweight: (weight: number) => Promise<void>;
  onStartTemplate: (template: SessionTemplate) => void;
  onStartEmpty: () => void;
  onResumeWorkout: () => void;
  onOpenHistory: () => void;
  onOpenProgress: (exerciseId?: string) => void;
  onOpenCardio: () => void;
  onOpenBody: () => void;
  onOpenSettings: () => void;
  onOpenVideos: () => void;
  today?: string;
}

export function TodayScreen({
  data,
  workouts,
  measurements,
  personalRecords,
  categoryColors,
  workoutStartedAt,
  todayBodyweight,
  onSaveBodyweight,
  onStartTemplate,
  onStartEmpty,
  onResumeWorkout,
  onOpenHistory,
  onOpenProgress,
  onOpenCardio,
  onOpenBody,
  onOpenSettings,
  onOpenVideos,
  today = localDate(),
}: TodayScreenProps) {
  const weekStartDay = weekStartDayFrom(data?.weekly_sets?.week_start ?? data?.zone2?.week_start);
  const weeks = useMemo(
    () => weeklyTrainingTotals(workouts, today, weekStartDay, 12),
    [today, weekStartDay, workouts],
  );
  const grid = useMemo(
    () => trainingDayGrid(workouts, today, weekStartDay, 12),
    [today, weekStartDay, workouts],
  );
  const recommendation = data?.recommendation ?? null;
  const template = useMemo(
    () => (recommendation ? sessionTemplateFor(workouts, recommendation.category, today) : null),
    [recommendation, today, workouts],
  );
  const currentWeek = weeks.at(-1);
  const history = weeks.slice(0, -1);
  const haveWorkouts = workouts.length > 0;
  const workoutsThisWeek = haveWorkouts ? (currentWeek?.workouts ?? 0) : data?.workouts_this_week;
  const setsThisWeek = haveWorkouts ? (currentWeek?.sets ?? 0) : data?.sets_this_week;
  const volumeThisWeek = haveWorkouts ? (currentWeek?.volumeKg ?? 0) : data?.volume_this_week_kg;
  const averageWorkouts = averageOf(history.map((week) => week.workouts));
  const averageSets = averageOf(history.map((week) => week.sets));
  const averageVolume = averageOf(history.map((week) => week.volumeKg));
  const trainingDays = grid.flat().filter((day) => day.workouts > 0).length;
  const muscles = (data?.weekly_sets?.muscle_groups ?? [])
    .filter((muscle) => muscle.raw_sets > 0)
    .sort((left, right) => right.raw_sets - left.raw_sets);
  const untrainedMuscles = (data?.weekly_sets?.muscle_groups ?? []).filter(
    (muscle) => muscle.raw_sets <= 0,
  ).length;
  const maxMuscleSets = Math.max(...muscles.map((muscle) => muscle.raw_sets), 1);
  const zone2 = data?.zone2 ?? null;
  const cardioMinutes = data?.cardio_minutes_this_week ?? zone2?.completed_minutes ?? null;
  const zone2DaysLeft = zone2 ? Math.max(0, daysBetween(today, zone2.week_end) + 1) : null;
  const latest = measurements[0] ?? null;
  const recentWeights = measurements
    .slice(0, 30)
    .map((measurement) => measurement.weight_kg)
    .reverse();
  const monthAgo = latest
    ? measurements.find(
        (measurement) => daysBetween(measurement.measurement_date, latest.measurement_date) >= 28,
      )
    : null;
  const monthChange = latest && monthAgo ? latest.weight_kg - monthAgo.weight_kg : null;
  const records = recentStrengthRecords(personalRecords, 3);
  const recommendationLabel = recommendation
    ? recommendation.category === 'cardio'
      ? 'Cardio'
      : CATEGORY_LABELS[recommendation.category]
    : null;

  return (
    <section className="today-screen content-page">
      <PageHeader
        eyebrow={parseLocalDate(today).toLocaleDateString('en-GB', {
          weekday: 'long',
          day: 'numeric',
          month: 'long',
        })}
        title="Today"
        actions={
          <>
            <button
              className="icon-button-pulse"
              type="button"
              onClick={onOpenVideos}
              aria-label="Video logger"
            >
              <Icon name="video" />
            </button>
            <button
              className="icon-button-pulse"
              type="button"
              onClick={onOpenSettings}
              aria-label="Settings"
            >
              <Icon name="settings" />
            </button>
          </>
        }
      />

      {workoutStartedAt !== null ? (
        <LiveWorkoutCard startedAt={workoutStartedAt} onResume={onResumeWorkout} />
      ) : (
        <section className="pulse-card next-session" aria-labelledby="next-session-title">
          <p className="next-session-tag">
            {recommendation && (
              <i
                className="category-dot"
                style={{ background: categoryColors[recommendation.category] }}
                aria-hidden="true"
              />
            )}
            {recommendation ? 'Up next' : 'Ready when you are'}
          </p>
          <h2 id="next-session-title">
            {recommendationLabel ? `${recommendationLabel} day` : 'Start a workout'}
          </h2>
          {recommendation && <p className="next-session-reason">{recommendation.reason}</p>}
          {template ? (
            <>
              <p className="next-session-meta">
                {template.exercises.length}{' '}
                {template.exercises.length === 1 ? 'exercise' : 'exercises'} · last{' '}
                {recommendationLabel?.toLowerCase()}{' '}
                {shortDate(template.sourceWorkout.workout_date)}
              </p>
              <ul className="next-session-exercises">
                {template.exercises.slice(0, 4).map(({ exercise, summary }) => (
                  <li key={exercise.id}>
                    <span>{exercise.name}</span>
                    <b className="num">{summary}</b>
                  </li>
                ))}
              </ul>
              {template.exercises.length > 4 && (
                <p className="next-session-more">
                  +{template.exercises.length - 4} more from last time
                </p>
              )}
            </>
          ) : (
            <p className="next-session-meta">
              {recommendation
                ? 'No previous session of this type yet. Start empty and add exercises.'
                : 'Log your first session to get a suggested next workout.'}
            </p>
          )}
          <div className="next-session-actions">
            {template ? (
              <>
                <button
                  className="pulse-button primary"
                  type="button"
                  onClick={() => onStartTemplate(template)}
                >
                  <Icon name="play" filled />
                  Start {recommendationLabel?.toLowerCase()} workout
                </button>
                <button className="pulse-button secondary" type="button" onClick={onStartEmpty}>
                  Empty
                </button>
              </>
            ) : (
              <button className="pulse-button primary" type="button" onClick={onStartEmpty}>
                <Icon name="plus" />
                Start workout
              </button>
            )}
          </div>
        </section>
      )}

      <section className="pulse-kpis" aria-label="This week">
        <button type="button" className="pulse-kpi" onClick={onOpenHistory}>
          <span>Workouts</span>
          <strong>{workoutsThisWeek ?? '–'}</strong>
          <em>
            {averageWorkouts === null ? 'This week' : `12-wk avg ${averageWorkouts.toFixed(1)}`}
          </em>
          <SparkBars
            values={weeks.map((week) => week.workouts)}
            label="Workouts per week, last 12 weeks"
          />
        </button>
        <button type="button" className="pulse-kpi" onClick={onOpenHistory}>
          <span>Working sets</span>
          <strong>{setsThisWeek ?? '–'}</strong>
          <em>{averageSets === null ? 'This week' : `12-wk avg ${Math.round(averageSets)}`}</em>
          <SparkBars
            values={weeks.map((week) => week.sets)}
            label="Working sets per week, last 12 weeks"
          />
        </button>
        <button type="button" className="pulse-kpi" onClick={onOpenHistory}>
          <span>Volume</span>
          <strong>{volumeThisWeek === undefined ? '–' : formatVolume(volumeThisWeek)}</strong>
          <em>
            {averageVolume === null ? 'This week' : `12-wk avg ${formatVolume(averageVolume)}`}
          </em>
          <SparkBars
            values={weeks.map((week) => week.volumeKg)}
            label="Volume per week, last 12 weeks"
          />
        </button>
      </section>

      <section className="pulse-card" aria-labelledby="consistency-title">
        <header className="pulse-card-header">
          <h2 id="consistency-title">Consistency</h2>
          <span>Last 12 weeks</span>
        </header>
        <div className="consistency-stats">
          <div>
            <span>Streak</span>
            <b>
              {data?.current_streak ?? 0} {data?.current_streak === 1 ? 'day' : 'days'}
            </b>
          </div>
          <div>
            <span>Training days</span>
            <b>{trainingDays}</b>
          </div>
          <div>
            <span>Avg / week</span>
            <b>{(trainingDays / 12).toFixed(1)}</b>
          </div>
        </div>
        <TrainingHeatmap weeks={grid} today={today} />
        <div className="heat-legend" aria-hidden="true">
          <span>Fewer sets</span>
          <i data-level="0" />
          <i data-level="1" />
          <i data-level="2" />
          <i data-level="3" />
          <span>More</span>
        </div>
      </section>

      <section className="pulse-card" aria-labelledby="muscle-sets-title">
        <header className="pulse-card-header">
          <h2 id="muscle-sets-title">Sets per muscle</h2>
          <span>This week · working sets</span>
        </header>
        {muscles.length ? (
          <ul className="muscle-bars">
            {muscles.slice(0, 8).map((muscle, index) => (
              <li key={muscle.muscle_group}>
                <span>{muscle.muscle_group}</span>
                <span className="muscle-bar-track">
                  <i
                    style={
                      {
                        width: `${(muscle.raw_sets / maxMuscleSets) * 100}%`,
                        '--d': `${index * 45}ms`,
                      } as CSSProperties
                    }
                  />
                </span>
                <b className="num">{Number(muscle.raw_sets.toFixed(1))}</b>
              </li>
            ))}
          </ul>
        ) : (
          <p className="pulse-empty-line">No working sets logged yet this week.</p>
        )}
        {data?.weekly_sets && muscles.length > 0 && (
          <p className="pulse-footnote">
            RPE logged on {Math.round(data.weekly_sets.rpe_logging_percent)}% of sets
            {untrainedMuscles ? ` · ${untrainedMuscles} muscles not trained yet` : ''}
          </p>
        )}
      </section>

      <div className="pulse-pair">
        <button type="button" className="pulse-card pulse-mini" onClick={onOpenCardio}>
          <span>Zone 2 cardio</span>
          <strong>
            {cardioMinutes ?? '–'}
            {zone2 && <small> / {zone2.goal_minutes} min</small>}
          </strong>
          {zone2 && (
            <Meter
              value={zone2.completed_minutes}
              max={zone2.goal_minutes}
              label="Zone 2 minutes this week"
            />
          )}
          <p>
            {zone2
              ? zone2.complete
                ? 'Weekly goal reached'
                : `${zone2.remaining_minutes} min to go${zone2DaysLeft !== null ? ` · ${zone2DaysLeft} ${zone2DaysLeft === 1 ? 'day' : 'days'} left` : ''}`
              : 'Minutes this week'}
          </p>
        </button>
        <button type="button" className="pulse-card pulse-mini" onClick={onOpenBody}>
          <span>Bodyweight</span>
          <strong>
            {latest ? latest.weight_kg.toFixed(1) : '–'}
            <small> kg</small>
          </strong>
          <Sparkline values={recentWeights} label="Bodyweight, last 30 check-ins" />
          <p className={monthChange !== null && monthChange < 0 ? 'trend-down' : ''}>
            {monthChange === null
              ? `${measurements.length} check-ins`
              : `${monthChange > 0 ? '+' : monthChange < 0 ? '−' : '±'}${Math.abs(monthChange).toFixed(1)} kg in 30 days`}
          </p>
        </button>
      </div>

      <DashboardQuickBodyweight
        latestBodyweight={latest?.weight_kg ?? null}
        todayBodyweight={todayBodyweight}
        onSave={onSaveBodyweight}
      />

      {records.length > 0 && (
        <section className="pulse-card" aria-labelledby="records-title">
          <header className="pulse-card-header">
            <h2 id="records-title">Recent records</h2>
            <button type="button" className="text-link" onClick={() => onOpenProgress()}>
              Progress
            </button>
          </header>
          <ul className="record-list">
            {records.map((record) => (
              <li key={record.id}>
                <button type="button" onClick={() => onOpenProgress(record.exercise_id)}>
                  <span className="record-icon" aria-hidden="true">
                    <Icon name="trophy" />
                  </span>
                  <span className="record-copy">
                    <b>{record.exercise_name ?? 'Exercise'}</b>
                    <small>
                      {RECORD_LABELS[record.record_type]} · {shortDate(record.achieved_date)}
                    </small>
                  </span>
                  <strong className="num">
                    {Number(record.value.toFixed(1))} {record.unit}
                  </strong>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </section>
  );
}

function LiveWorkoutCard({ startedAt, onResume }: { startedAt: number; onResume: () => void }) {
  const elapsed = useElapsedSeconds(startedAt);
  return (
    <button className="pulse-card live-workout-card" type="button" onClick={onResume}>
      <span className="live-workout-label">
        <i aria-hidden="true" />
        Workout live
      </span>
      <time className="live-workout-duration num" dateTime={`PT${elapsed}S`}>
        {formatElapsed(elapsed)}
      </time>
      <span className="live-workout-resume">
        Resume
        <Icon name="chevron-right" />
      </span>
    </button>
  );
}

export function DashboardQuickBodyweight({
  latestBodyweight,
  todayBodyweight,
  onSave,
}: {
  latestBodyweight: number | null;
  todayBodyweight: number | null;
  onSave: (weight: number) => Promise<void>;
}) {
  const initialWeight = todayBodyweight ?? latestBodyweight;
  const [weight, setWeight] = useState(initialWeight === null ? '' : initialWeight.toFixed(1));
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const selectedWeight = Number(weight);

  useEffect(() => {
    const nextWeight = todayBodyweight ?? latestBodyweight;
    if (nextWeight !== null) setWeight(nextWeight.toFixed(1));
  }, [latestBodyweight, todayBodyweight]);

  async function save() {
    if (!Number.isFinite(selectedWeight) || selectedWeight <= 0 || selectedWeight > 500) {
      setError('Enter a bodyweight between 1 and 500 kg.');
      setMessage(null);
      return;
    }
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      await onSave(selectedWeight);
      setMessage(`${selectedWeight.toFixed(1)} kg saved for today.`);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Could not save today’s weight.');
    } finally {
      setSaving(false);
    }
  }

  function nudge(delta: number) {
    const base =
      Number.isFinite(selectedWeight) && selectedWeight > 0
        ? selectedWeight
        : (latestBodyweight ?? 0);
    setWeight(Math.max(0, base + delta).toFixed(1));
    setError(null);
    setMessage(null);
  }

  return (
    <section className="pulse-card quick-bodyweight" aria-labelledby="daily-bodyweight-title">
      <header className="pulse-card-header">
        <h2 id="daily-bodyweight-title">Daily check-in</h2>
        <span className={todayBodyweight === null ? '' : 'logged'}>
          {todayBodyweight === null
            ? 'Not logged today'
            : `Today · ${todayBodyweight.toFixed(1)} kg`}
        </span>
      </header>
      <form
        className="quick-bodyweight-form"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <button
          type="button"
          className="stepper"
          onClick={() => nudge(-0.1)}
          aria-label="Decrease by 0.1 kg"
        >
          −
        </button>
        <label>
          <span className="sr-only">Bodyweight in kilograms</span>
          <input
            type="number"
            inputMode="decimal"
            min="1"
            max="500"
            step="0.1"
            value={weight}
            onChange={(event) => {
              setWeight(event.target.value);
              setError(null);
              setMessage(null);
            }}
          />
          <b>kg</b>
        </label>
        <button
          type="button"
          className="stepper"
          onClick={() => nudge(0.1)}
          aria-label="Increase by 0.1 kg"
        >
          +
        </button>
        <button className="pulse-button primary" type="submit" disabled={saving}>
          {saving ? 'Saving…' : todayBodyweight === null ? 'Log' : 'Update'}
        </button>
      </form>
      {message && (
        <p className="quick-bodyweight-message" role="status">
          {message}
        </p>
      )}
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

export function TodaySkeleton() {
  return (
    <section
      className="today-screen content-page today-loading-skeleton"
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <p className="sr-only">Loading your training summary</p>
      <div className="page-header" aria-hidden="true">
        <div>
          <span className="skeleton-block skeleton-eyebrow" />
          <span className="skeleton-block skeleton-title" />
        </div>
      </div>
      <div className="pulse-card skeleton-card skeleton-card-tall" aria-hidden="true" />
      <div className="pulse-kpis" aria-hidden="true">
        {[0, 1, 2].map((item) => (
          <div className="pulse-kpi" key={item}>
            <span className="skeleton-block skeleton-label" />
            <span className="skeleton-block skeleton-value" />
          </div>
        ))}
      </div>
      <div className="pulse-card skeleton-card" aria-hidden="true" />
    </section>
  );
}

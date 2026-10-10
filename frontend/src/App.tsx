import { useActiveWorkoutReminder } from './activeWorkoutReminder';
import {
  extendInactiveWorkoutFinishAt,
  inactiveWorkoutFinishAt,
  MAX_INACTIVE_WORKOUT_MS,
} from './activeWorkoutTimeout';
import { Fragment, startTransition, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, PointerEvent as ReactPointerEvent, ReactNode, RefObject } from 'react';
import { createPortal, flushSync } from 'react-dom';
import { api } from './api';
import type {
  BodyMeasurement,
  BodyWeightGoal,
  CardioOverview,
  CardioScreenshotScan,
  CardioSession,
  CardioSessionInput,
  DashboardData,
  Exercise,
  ExerciseCreateInput,
  ExerciseProgress,
  MachinePhoto,
  PersonalRecord,
  TrackedSet,
  TrackedWorkout,
  TrainingPreferences,
  WorkoutCategory,
  User,
  WorkoutTypeColors,
  WorkoutInput,
  WorkoutRecommendation,
  WorkoutSetInput,
} from './types';
import {
  BODY_TREND_DURATION_OPTIONS,
  bodyweightEntryPlaceholder,
  clipBodyWeightGoalPath,
  filterMeasurementsByRange,
  summarizeBodyWeightTrend,
} from './bodyTrend';
import type { BodyTrendDuration, BodyTrendRange, BodyTrendStatistic } from './bodyTrend';
import { summarizeBodyHistory } from './bodyMeasurementHistory';
import type { BodyHistoryPeriod } from './bodyMeasurementHistory';
import {
  DEFAULT_BODY_TREND_PREFERENCE,
  loadBodyTrendPreference,
  saveBodyTrendPreference,
  type BodyTrendPreference,
} from './bodyTrendPreference';
import { monthCountFromOldestWorkout } from './calendarRange';
import { InlineConfirmButton } from './InlineConfirmButton';
import { NotificationDialog } from './NotificationDialog';
import { PopupDialog } from './PopupDialog';
import { CreateExerciseDialog } from './CreateExerciseDialog';
import { BackgroundActivityBar } from './BackgroundActivityBar';
import { CardioEnergyCard } from './CardioEnergyCard';
import { CardioMetricsEditor } from './CardioMetricsEditor';
import { fatEnergyEquivalent } from './cardioEnergy';
import { cardioSetUpdateFromScan } from './cardioScreenshot';
import { CachedTabPanel } from './CachedTabPanel';
import { ConfettiBurst } from './ConfettiBurst';
import { EdgeSwipeBack } from './EdgeSwipeBack';
import { ProgressExerciseSearch } from './ProgressExerciseSearch';
import {
  personalBestProgressPoint,
  progressPointsForChart,
  type ProgressMetric,
} from './progressChart';
import { restTimerPreferenceEnabled, saveRestTimerPreference } from './restTimerPreference';
import { cancelRestTimerPushSchedule } from './restTimer';
import {
  disablePhonePushNotifications,
  dismissRestTimerNotifications,
  enablePhonePushNotifications,
  existingPhonePushSubscription,
  PHONE_PUSH_PREFERENCE_EVENT,
  pushNotificationsSupported,
  showRestTimerNotification,
  showWorkoutAutoSavedNotification,
} from './push';
import {
  useCollapseAnimation,
  useExpandAnimation,
  useFlipAnimation,
  useSlidingIndicator,
} from './motionHooks';
import {
  applyReduceMotion,
  motionReduced,
  reduceMotionPreference,
  saveReduceMotionPreference,
  systemPrefersReducedMotion,
} from './motion';
import {
  RPE_OPTIONS,
  SET_KINDS,
  setKindOf,
  setKindUpdate,
  setNumberLabels,
} from './setFieldValues';
import { SwipeToDeleteSetRow } from './SwipeToDeleteSetRow';
import { unusualSetEntryWarning, type SetEntryWarning } from './setEntryConfirmation';
import {
  appTabFromHash,
  createAppHistoryState,
  historySectionForTab,
  isAppHistoryState,
  mainTabFor,
  type AppTab,
  type HistorySection,
} from './appNavigation';
import { AppTabBar } from './AppTabBar';
import { Icon } from './Icon';
import { TrendChart, type GoalPath, type TrendPoint } from './PulseCharts';
import { PageHeader, TodayScreen, TodaySkeleton } from './TodayScreen';
import {
  compactSetSummary,
  dayMonth,
  formatKg,
  formatVolume,
  groupWorkoutsByWeek,
  mostTrainedExerciseId,
  recordCountsByWorkout,
  setLabel,
  shortDate,
  topWorkingSet,
  weekGroupLabel,
  weekStartDayFrom,
  weeklyBestPoints,
  workingSets,
  workoutDisplayName,
  workoutVolumeKg,
  type SessionTemplate,
} from './trainingSummary';
import { recentExerciseHistory, type ExerciseHistoryEntry } from './exerciseHistory';
import { exerciseIconFor } from './exerciseIcons';
import { fuzzyHighlightIndices, rankExerciseSearchMatches } from './exerciseSearch';
import {
  decimalNumberOrNull,
  formatMinutesDuration,
  formatSeconds,
  formatWorkoutTimeRange,
  localDate,
  mergeUniqueById,
  itemsInSelectionOrder,
  reorder,
  workoutDurationMinutes,
  workoutTimeInputValue,
} from './utils';
import { VideoUpload } from './VideoUpload';
import { ProfileScreen } from './ProfileScreen';
import { AdminScreen } from './AdminScreen';
import { canUploadVideos, useUserSession } from './userContext';
import { WorkoutHeaderMeta } from './WorkoutRestTimer';
import {
  clearActiveWorkoutDraft,
  readActiveWorkoutDraft,
  savedWorkoutMatchesOldDraft,
  writeActiveWorkoutDraft,
} from './workoutDraft';
import {
  createSuggestedWorkoutSet,
  createWorkoutSet,
  DEFAULT_REST_SECONDS,
  isCompletedWorkingSet,
  latestExerciseSets,
  restTimerSecondsAfterSetUpdate,
} from './workoutSets';
import { finalizeWorkoutIdentity } from './workoutCategory';
import {
  replaceMovementExercise,
  type WorkoutDraftMovement as DraftMovement,
  type WorkoutDraftSet as DraftSet,
} from './workoutMovements';
import { applySupersetSelection, clearSuperset } from './workoutSupersets';
import { upsertWorkoutByRecency } from './workoutHistory';
import { calculateDraftPrs } from './workoutPr';
import { completedWorkoutDurationMinutes } from './workoutResume';
import { isWorkoutSetAutoSavable, workoutSetForAutoSave } from './workoutAutoSave';
import { readDashboardCache, writeDashboardCache } from './workoutCache';
import { trainingDataActivityLabel } from './trainingDataRefresh';
import {
  dateRangeForDates,
  TIME_RANGE_OPTIONS,
  type DateRange,
  type TimeRange,
} from './dateRanges';

type SetField = 'weight' | 'reps' | 'duration' | 'distance' | 'rpe' | 'notes';
type RestAlertStatus =
  'checking' | 'available' | 'enabling' | 'enabled' | 'blocked' | 'unsupported';
type BackgroundActivity = { id: number; label: string };

const categoryNames: Record<WorkoutCategory, string> = {
  upper: 'Upper body',
  lower: 'Lower body',
  push: 'Push',
  pull: 'Pull',
  full_body: 'Full body',
  cardio: 'Cardio',
  other: 'Other',
};

const defaultCategoryColors: WorkoutTypeColors = {
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
const CARDIO_HISTORY_PAGE_SIZE = 5;
const IMPORTED_BODYWEIGHT_NOTE = 'Imported from workout CSV.';

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

function setTypeTitle(item: Pick<DraftSet, 'set_type' | 'warmup' | 'failed'>): string {
  return SET_KINDS.find((option) => option.kind === setKindOf(item))?.label ?? 'Working set';
}

/** Sets pre-filled from the exercise's most recent session, marked as suggestions. */
function suggestedSetsFromHistory(
  workouts: TrackedWorkout[],
  exercise: Exercise,
  onOrBeforeDate: string,
  excludedWorkoutId?: string,
): DraftSet[] {
  const previousSets = latestExerciseSets(workouts, exercise.id, onOrBeforeDate, excludedWorkoutId);
  if (!previousSets.length) return [emptySet(exercise.kind)];
  return previousSets.map((previous) => ({
    key: crypto.randomUUID(),
    ...createSuggestedWorkoutSet(exercise.kind, previous),
    fromPrevious: true,
  }));
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

function moveItem<T>(items: T[], from: number, to: number): T[] {
  return reorder(items, from, to);
}

function SetDragHandle({
  setNumber,
  disabled,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
  onMoveEarlier,
  onMoveLater,
}: {
  setNumber: number;
  disabled: boolean;
  onPointerDown: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onPointerMove: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onPointerUp: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onPointerCancel: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onMoveEarlier: () => void;
  onMoveLater: () => void;
}) {
  return (
    <button
      type="button"
      className="set-drag-handle"
      aria-label={`Drag set ${setNumber} to reorder`}
      title="Drag to reorder"
      disabled={disabled}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onKeyDown={(event) => {
        if (event.key === 'ArrowUp') {
          event.preventDefault();
          onMoveEarlier();
        } else if (event.key === 'ArrowDown') {
          event.preventDefault();
          onMoveLater();
        }
      }}
    >
      <span className="set-drag-grip" aria-hidden="true">
        {[0, 1, 2, 3, 4, 5].map((dot) => (
          <i key={dot} />
        ))}
      </span>
    </button>
  );
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

function WorkoutCompletionDialog({
  records,
  personalRecords,
  onClose,
}: {
  records: PersonalRecord[];
  personalRecords: PersonalRecord[];
  onClose: () => void;
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
    window.requestAnimationFrame(() => closeButtonRef.current?.focus());

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
      className="modal-backdrop pr-summary-backdrop"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <ConfettiBurst />
      <section
        className="pr-summary panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="workout-completion-title"
      >
        <button
          ref={closeButtonRef}
          type="button"
          className="icon-button popup-close"
          onClick={onClose}
          aria-label="Close personal record summary"
        >
          ×
        </button>
        <span className="pr-trophy" aria-hidden="true">
          🏆
        </span>
        <p className="section-kicker">WORKOUT COMPLETE</p>
        <h2 id="workout-completion-title">
          {records.length} new PR{records.length === 1 ? '' : 's'}
        </h2>
        {records.map((record) => (
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
        <button type="button" className="pr-summary-done" onClick={onClose}>
          Done
        </button>
      </section>
    </div>,
    document.body,
  );
}

export function App() {
  const { user } = useUserSession();
  const videosAllowed = canUploadVideos(user);
  const isAdmin = user?.is_admin === true;
  const initialHistoryState = isAppHistoryState(window.history.state) ? window.history.state : null;
  const [tab, setTabState] = useState<AppTab>(() =>
    initialHistoryState ? initialHistoryState.tab : appTabFromHash(window.location.hash),
  );
  const historyIndexRef = useRef(initialHistoryState?.index ?? 0);
  const scrollPositionsRef = useRef(new Map<number, number>());
  const navigationActionRef = useRef<'push' | 'replace' | 'pop'>('replace');
  const currentTabRef = useRef(tab);
  const initialRefreshStartedRef = useRef(false);
  const backgroundActivityIdRef = useRef(0);
  currentTabRef.current = tab;
  const [visitedTabs, setVisitedTabs] = useState(() => new Set<AppTab>([tab]));
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [workouts, setWorkouts] = useState<TrackedWorkout[]>([]);
  const [measurements, setMeasurements] = useState<BodyMeasurement[]>([]);
  const [personalRecords, setPersonalRecords] = useState<PersonalRecord[]>([]);
  const [completionRecords, setCompletionRecords] = useState<PersonalRecord[]>([]);
  const [restTimerEnabled, setRestTimerEnabled] = useState(restTimerPreferenceEnabled);
  const [reduceMotion, setReduceMotion] = useState(reduceMotionPreference);
  const [navDirection, setNavDirection] = useState<'forward' | 'back'>('forward');
  const [bodyTrendPreference, setBodyTrendPreference] = useState(loadBodyTrendPreference);
  const [workoutTypeColors, setWorkoutTypeColors] =
    useState<WorkoutTypeColors>(defaultCategoryColors);
  const [workoutStartDate, setWorkoutStartDate] = useState(localDate());
  const [editingWorkout, setEditingWorkout] = useState<TrackedWorkout | null>(null);
  const [resumingWorkoutId, setResumingWorkoutId] = useState<string | null>(
    () => readActiveWorkoutDraft()?.resumingWorkoutId ?? null,
  );
  const [activeWorkoutStartedAt, setActiveWorkoutStartedAt] = useState<number | null>(() => {
    const storedDraft = readActiveWorkoutDraft();
    if (storedDraft) return storedDraft.startedAt;
    return window.location.hash === '#log' ? Date.now() : null;
  });
  const [historyOpenId, setHistoryOpenId] = useState<string | null>(null);
  const [historyExerciseId, setHistoryExerciseId] = useState<string | null>(null);
  const sectionFromTab = historySectionForTab(tab);
  const [lastHistorySection, setLastHistorySection] = useState<HistorySection>(
    sectionFromTab ?? 'history',
  );
  if (sectionFromTab && sectionFromTab !== lastHistorySection) {
    setLastHistorySection(sectionFromTab);
  }
  const historySection = sectionFromTab ?? lastHistorySection;
  const historyGroupVisited =
    sectionFromTab !== null ||
    visitedTabs.has('history') ||
    visitedTabs.has('progress') ||
    visitedTabs.has('cardio');
  const [workoutTemplate, setWorkoutTemplate] = useState<SessionTemplate | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [backgroundActivities, setBackgroundActivities] = useState<BackgroundActivity[]>([]);
  useActiveWorkoutReminder(activeWorkoutStartedAt);
  useEffect(() => {
    // Accounts without upload access never reach the video screen, even from an old #videos link.
    if (tab !== 'videos' || videosAllowed) return;
    navigationActionRef.current = 'replace';
    setTabState('dashboard');
  }, [tab, videosAllowed]);
  useEffect(() => {
    // Only administrators can open the admin console, even from an old #admin link.
    if (tab !== 'admin' || isAdmin) return;
    navigationActionRef.current = 'replace';
    setTabState('settings');
  }, [tab, isAdmin]);
  useEffect(() => {
    if (loading || activeWorkoutStartedAt === null) return;
    const draft = readActiveWorkoutDraft();
    if (!draft || !workouts.some((workout) => savedWorkoutMatchesOldDraft(draft, workout))) return;
    clearActiveWorkoutDraft();
    setActiveWorkoutStartedAt(null);
    setResumingWorkoutId(null);
    if (tab === 'log') {
      navigationActionRef.current = 'replace';
      setTabState('dashboard');
    }
  }, [activeWorkoutStartedAt, loading, tab, workouts]);
  const activeWorkoutDate =
    activeWorkoutStartedAt === null
      ? null
      : (readActiveWorkoutDraft()?.workoutDate ?? workoutStartDate);
  const resumingWorkout = resumingWorkoutId
    ? (workouts.find((workout) => workout.id === resumingWorkoutId) ?? null)
    : null;
  const todayMeasurement = measurements.find(
    (measurement) => measurement.measurement_date === localDate(),
  );
  const backgroundActivityLabel =
    backgroundActivities.length > 0
      ? backgroundActivities[backgroundActivities.length - 1].label
      : null;
  const canNavigateBack =
    tab !== 'dashboard' ||
    (isAppHistoryState(window.history.state) && window.history.state.index > 0);

  function setTab(nextTab: AppTab, options: { replace?: boolean } = {}) {
    if (nextTab === tab) return;
    scrollPositionsRef.current.set(historyIndexRef.current, window.scrollY);
    navigationActionRef.current = options.replace ? 'replace' : 'push';
    setNavDirection('forward');
    setTabState(nextTab);
  }

  function navigateBack() {
    const currentState = window.history.state;
    if (tab === 'log') {
      setEditingWorkout(null);
      if (isAppHistoryState(currentState) && currentState.index > 0) {
        window.history.back();
        return;
      }
      setTab(editingWorkout ? 'history' : 'dashboard', { replace: true });
      return;
    }
    if (isAppHistoryState(currentState) && currentState.index > 0) {
      window.history.back();
      return;
    }
    if (tab !== 'dashboard') setTab('dashboard', { replace: true });
  }

  function beginBackgroundActivity(label: string): () => void {
    const id = ++backgroundActivityIdRef.current;
    setBackgroundActivities((current) => [...current, { id, label }]);
    let finished = false;
    return () => {
      if (finished) return;
      finished = true;
      setBackgroundActivities((current) => current.filter((activity) => activity.id !== id));
    };
  }

  async function withBackgroundActivity<T>(label: string, operation: () => Promise<T>): Promise<T> {
    const finish = beginBackgroundActivity(label);
    try {
      return await operation();
    } finally {
      finish();
    }
  }

  async function refreshData({
    silent = false,
    activityLabel = trainingDataActivityLabel('startup'),
  }: { silent?: boolean; activityLabel?: string | null } = {}) {
    const refresh = async () => {
      const results = await Promise.allSettled([
        api.dashboard().then((nextDashboard) => {
          startTransition(() => setDashboard(nextDashboard));
          void writeDashboardCache(nextDashboard);
        }),
        api.listExercises().then((nextExercises) => {
          startTransition(() => setExercises(nextExercises));
        }),
        api.listWorkouts().then((nextWorkouts) => {
          startTransition(() => setWorkouts(nextWorkouts));
        }),
        api.listBodyMeasurements().then((nextMeasurements) => {
          startTransition(() => setMeasurements(nextMeasurements));
        }),
        api.listPersonalRecords().then((nextRecords) => {
          startTransition(() => setPersonalRecords(nextRecords));
        }),
      ]);
      const firstFailure = results.find(
        (result): result is PromiseRejectedResult => result.status === 'rejected',
      );

      if (!silent)
        setMessage(
          firstFailure
            ? firstFailure.reason instanceof Error
              ? firstFailure.reason.message
              : 'Could not load all of your training data.'
            : null,
        );
      setLoading(false);
    };

    if (activityLabel) await withBackgroundActivity(activityLabel, refresh);
    else await refresh();
  }

  function refreshAfterMutation(): Promise<void> {
    return refreshData({ silent: true, activityLabel: trainingDataActivityLabel('mutation') });
  }

  useEffect(() => {
    if (initialRefreshStartedRef.current) return;
    initialRefreshStartedRef.current = true;
    let cancelled = false;

    void readDashboardCache().then((cachedDashboard) => {
      if (!cancelled && cachedDashboard) setDashboard(cachedDashboard);
      if (!cancelled) void refreshData();
    });

    return () => {
      cancelled = true;
      initialRefreshStartedRef.current = false;
    };
    // This is the single startup read; later refreshes are invoked by mutation handlers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void api
      .getWorkoutTypeColors()
      .then(setWorkoutTypeColors)
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    // Navigation only reveals an already-cached screen. Training data is refreshed at startup
    // and by the mutation handlers below, never as a side effect of changing views.
    setVisitedTabs((current) => {
      if (current.has(tab)) return current;
      const next = new Set(current);
      next.add(tab);
      return next;
    });
  }, [tab]);

  useEffect(() => {
    const action = navigationActionRef.current;
    // Screens share the page scroll: new screens open at the top, and going back returns to
    // where that screen was left.
    // Runs before any screen's own animation-frame scroll (e.g. revealing an opened workout).
    window.scrollTo(
      0,
      action === 'pop' ? (scrollPositionsRef.current.get(historyIndexRef.current) ?? 0) : 0,
    );
    if (action === 'pop') {
      navigationActionRef.current = 'replace';
      return;
    }

    if (action === 'push') {
      historyIndexRef.current += 1;
      window.history.pushState(createAppHistoryState(tab, historyIndexRef.current), '', `#${tab}`);
    } else {
      window.history.replaceState(
        createAppHistoryState(tab, historyIndexRef.current),
        '',
        `#${tab}`,
      );
    }
    navigationActionRef.current = 'replace';
  }, [tab]);

  useEffect(() => {
    // The app restores each screen's scroll itself; the browser's restore would fight it.
    if ('scrollRestoration' in window.history) window.history.scrollRestoration = 'manual';
    const restoreNavigation = (event: PopStateEvent) => {
      const nextTab = isAppHistoryState(event.state)
        ? event.state.tab
        : appTabFromHash(window.location.hash);
      scrollPositionsRef.current.set(historyIndexRef.current, window.scrollY);
      if (isAppHistoryState(event.state)) historyIndexRef.current = event.state.index;
      navigationActionRef.current = 'pop';
      if (currentTabRef.current === nextTab) {
        navigationActionRef.current = 'replace';
        return;
      }
      setNavDirection('back');
      setTabState(nextTab);
    };

    window.addEventListener('popstate', restoreNavigation);
    return () => window.removeEventListener('popstate', restoreNavigation);
  }, []);

  async function saveWorkout(payload: WorkoutInput) {
    const wasEditing = editingWorkout !== null;
    const resumedId = resumingWorkoutId;
    const saved = await withBackgroundActivity(
      wasEditing || resumedId ? 'Saving workout changes…' : 'Saving workout…',
      () =>
        editingWorkout
          ? api.updateWorkout(editingWorkout.id, payload)
          : resumedId
            ? api.updateWorkout(resumedId, payload)
            : api.createWorkout(payload),
    );

    setWorkouts((current) => upsertWorkoutByRecency(current, saved));
    if (!wasEditing) {
      clearActiveWorkoutDraft();
      setActiveWorkoutStartedAt(null);
      setResumingWorkoutId(null);
    }
    setTab(wasEditing || resumedId ? 'history' : 'dashboard', { replace: true });
    setEditingWorkout(null);

    void api
      .listPersonalRecords({ workoutId: saved.id })
      .then(setCompletionRecords)
      .catch(() => undefined);
    void refreshData({ silent: true, activityLabel: 'Updating workout data…' });
  }

  async function deleteWorkout(workout: TrackedWorkout) {
    try {
      await withBackgroundActivity('Deleting workout…', async () => {
        await api.deleteWorkout(workout.id);
        if (workout.id === resumingWorkoutId) {
          clearActiveWorkoutDraft();
          setActiveWorkoutStartedAt(null);
          setResumingWorkoutId(null);
        }
        await refreshData({ activityLabel: null });
      });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not delete that workout.');
    }
  }

  async function importWorkoutCsv(file: File) {
    try {
      const result = await withBackgroundActivity('Importing workouts…', async () => {
        const imported = await api.importWorkouts(file);
        await refreshData({ activityLabel: null });
        return imported;
      });
      const bodyweightCount = result.body_measurements_created + result.body_measurements_updated;
      setMessage(
        `Imported ${result.sets_imported} sets across ${result.workouts_created} workouts${
          result.exercises_created ? ` and added ${result.exercises_created} exercises` : ''
        }${bodyweightCount ? `; synced ${bodyweightCount} body-weight check-ins` : ''}.`,
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not import that CSV file.');
    }
  }

  async function exportWorkoutCsv(range: DateRange) {
    try {
      const blob = await withBackgroundActivity('Preparing workout export…', () =>
        api.exportWorkouts(range),
      );
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `gym-workouts-${range.start_date ? `${range.start_date}-to-${range.end_date}` : localDate()}.csv`;
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
      await withBackgroundActivity('Removing sample workouts…', async () => {
        await api.deleteSampleData();
        await refreshData({ activityLabel: null });
      });
      setMessage('Sample workouts removed. They will not be seeded again.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not remove sample data.');
    }
  }

  function startWorkout(
    workoutDate = localDate(),
    replaceActiveWorkout = false,
    template: SessionTemplate | null = null,
  ) {
    if (replaceActiveWorkout) clearActiveWorkoutDraft();
    const storedDraft = replaceActiveWorkout ? null : readActiveWorkoutDraft();
    setWorkoutTemplate(storedDraft || activeWorkoutStartedAt !== null ? null : template);
    const startedAt = storedDraft?.startedAt ?? Date.now();
    setEditingWorkout(null);
    setResumingWorkoutId(storedDraft?.resumingWorkoutId ?? null);
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

  function resumeWorkout(workout: TrackedWorkout) {
    if (activeWorkoutStartedAt !== null) return;
    clearActiveWorkoutDraft();
    setEditingWorkout(null);
    setResumingWorkoutId(workout.id);
    setActiveWorkoutStartedAt(Date.now());
    setWorkoutStartDate(workout.workout_date);
    setTab('log');
    if (navigator.storage?.persist) void navigator.storage.persist().catch(() => false);
  }

  async function saveMeasurement(payload: {
    measurement_date: string;
    weight_kg: number;
    body_fat_pct: number | null;
    notes: string | null;
  }) {
    await withBackgroundActivity('Saving measurement…', async () => {
      await api.saveBodyMeasurement(payload);
      await refreshData({ activityLabel: null });
    });
  }

  async function deleteMeasurement(id: string) {
    try {
      await withBackgroundActivity('Deleting measurement…', async () => {
        await api.deleteBodyMeasurement(id);
        await refreshData({ activityLabel: null });
      });
      setMessage('Body measurement deleted.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not delete that measurement.');
    }
  }

  async function updateExerciseFavorite(exerciseId: string, isFavorite: boolean) {
    const updated = await withBackgroundActivity('Updating exercise…', () =>
      api.updateExerciseFavorite(exerciseId, isFavorite),
    );
    setExercises((current) =>
      current.map((exercise) => (exercise.id === updated.id ? updated : exercise)),
    );
  }

  async function createExercise(input: ExerciseCreateInput): Promise<Exercise> {
    const exercise = await withBackgroundActivity('Creating exercise…', () =>
      api.createExercise(input),
    );
    setExercises((current) => mergeUniqueById(current, [exercise]));
    return exercise;
  }

  function updateRestTimerPreference(enabled: boolean) {
    saveRestTimerPreference(enabled);
    setRestTimerEnabled(enabled);
  }

  function updateReduceMotion(reduced: boolean) {
    saveReduceMotionPreference(reduced);
    applyReduceMotion(reduced);
    setReduceMotion(reduced);
  }

  function updateBodyTrendPreference(preference: BodyTrendPreference) {
    saveBodyTrendPreference(preference);
    setBodyTrendPreference(preference);
  }

  const nestedHeader =
    tab === 'settings'
      ? { title: 'Settings', subtitle: 'Timers • notifications • data' }
      : tab === 'videos' && videosAllowed
        ? { title: 'Videos', subtitle: 'Workout clips • uploads' }
        : tab === 'profile'
          ? { title: 'Profile', subtitle: user ? user.display_name : 'Account • security' }
          : tab === 'admin' && isAdmin
            ? { title: 'Admin console', subtitle: 'Accounts • switches • server' }
            : null;
  const activeMainTab = mainTabFor(tab);
  const showTabBar = tab !== 'log';

  function openHistorySection(section: HistorySection, exerciseId: string | null = null) {
    setHistoryOpenId(null);
    setHistoryExerciseId(exerciseId);
    setTab(section);
  }

  return (
    <div className={`tracker-app ${showTabBar ? 'has-tab-bar' : ''}`}>
      <EdgeSwipeBack onBack={navigateBack} enabled={canNavigateBack} />
      <BackgroundActivityBar label={backgroundActivityLabel} />
      {message && (
        <NotificationDialog key={message} message={message} onClose={() => setMessage(null)} />
      )}
      {completionRecords.length > 0 && (
        <WorkoutCompletionDialog
          records={completionRecords}
          personalRecords={personalRecords}
          onClose={() => setCompletionRecords([])}
        />
      )}

      {nestedHeader && (
        <OverlayScreenHeader
          title={nestedHeader.title}
          subtitle={nestedHeader.subtitle}
          onBack={navigateBack}
        />
      )}

      <main
        className={`tracker-content ${tab === 'videos' ? 'video-content' : ''} ${nestedHeader || tab === 'log' ? 'with-overlay-header' : ''}`}
        data-nav-direction={navDirection}
      >
        {loading &&
          tab !== 'dashboard' &&
          tab !== 'videos' &&
          tab !== 'profile' &&
          tab !== 'admin' && <TodaySkeleton />}
        {(tab === 'dashboard' || visitedTabs.has('dashboard')) && (
          <CachedTabPanel active={tab === 'dashboard'}>
            {loading && dashboard === null ? (
              <TodaySkeleton />
            ) : (
              <TodayScreen
                data={dashboard}
                workouts={workouts}
                measurements={measurements}
                personalRecords={personalRecords}
                categoryColors={workoutTypeColors}
                workoutStartedAt={activeWorkoutStartedAt}
                todayBodyweight={todayMeasurement?.weight_kg ?? null}
                onSaveBodyweight={(weight) =>
                  saveMeasurement({
                    measurement_date: localDate(),
                    weight_kg: weight,
                    body_fat_pct: todayMeasurement?.body_fat_pct ?? null,
                    notes: todayMeasurement?.notes ?? null,
                  })
                }
                onStartTemplate={(template) => startWorkout(localDate(), false, template)}
                onStartEmpty={() => startWorkout()}
                onResumeWorkout={() => setTab('log')}
                onOpenHistory={() => openHistorySection('history')}
                onOpenProgress={(exerciseId) => openHistorySection('progress', exerciseId ?? null)}
                onOpenCardio={() => openHistorySection('cardio')}
                onOpenBody={() => setTab('body')}
                onOpenSettings={() => setTab('settings')}
                onOpenVideos={videosAllowed ? () => setTab('videos') : undefined}
                onOpenProfile={user ? () => setTab('profile') : undefined}
                profileLabel={user?.display_name}
                calendar={
                  <InteractiveWorkoutCalendar
                    entries={dashboard?.heatmap ?? []}
                    workouts={workouts}
                    categoryColors={workoutTypeColors}
                    activeWorkout={activeWorkoutStartedAt !== null}
                    activeWorkoutDate={activeWorkoutDate}
                    onResumeWorkout={() => setTab('log')}
                    onEditWorkout={editWorkout}
                    onStartWorkout={(workoutDate) => startWorkout(workoutDate)}
                    onReplaceActiveWorkout={(workoutDate) => startWorkout(workoutDate, true)}
                  />
                }
              />
            )}
          </CachedTabPanel>
        )}
        {!loading &&
          (tab === 'log' ||
            activeWorkoutStartedAt !== null ||
            (visitedTabs.has('log') && editingWorkout !== null)) && (
            <CachedTabPanel active={tab === 'log'}>
              <WorkoutLogger
                key={
                  editingWorkout
                    ? `edit-${editingWorkout.id}`
                    : `active-${activeWorkoutStartedAt ?? workoutStartDate}`
                }
                exercises={exercises}
                recommendation={dashboard?.recommendation ?? null}
                template={workoutTemplate}
                initialDate={workoutStartDate}
                initialWorkout={editingWorkout}
                resumingWorkout={resumingWorkout}
                currentBodyweight={measurements[0]?.weight_kg ?? null}
                personalRecords={personalRecords}
                historicalWorkouts={workouts}
                restTimerEnabled={restTimerEnabled}
                categoryColors={workoutTypeColors}
                onExerciseHistory={(exerciseId) => openHistorySection('progress', exerciseId)}
                onExerciseFavorite={updateExerciseFavorite}
                onCreateExercise={createExercise}
                onSave={saveWorkout}
                onAutoSaved={() =>
                  setMessage('Your inactive workout passed its time limit and was auto-saved.')
                }
                activeStartedAt={activeWorkoutStartedAt}
                onClose={navigateBack}
                onDelete={() => {
                  if (editingWorkout) {
                    void deleteWorkout(editingWorkout);
                    setTab('history');
                  } else {
                    clearActiveWorkoutDraft();
                    setActiveWorkoutStartedAt(null);
                    setResumingWorkoutId(null);
                    setTab('dashboard');
                  }
                  setEditingWorkout(null);
                }}
              />
            </CachedTabPanel>
          )}
        {!loading && (tab === 'body' || visitedTabs.has('body')) && (
          <CachedTabPanel active={tab === 'body'}>
            <BodyCompositionScreen
              measurements={measurements}
              onSave={saveMeasurement}
              onDelete={deleteMeasurement}
              onDataChange={refreshAfterMutation}
              trendPreference={bodyTrendPreference}
            />
          </CachedTabPanel>
        )}
        {!loading && historyGroupVisited && (
          <CachedTabPanel active={sectionFromTab !== null}>
            <HistoryScreen
              key={`${historyOpenId ?? 'history'}-${historyExerciseId ?? 'all'}`}
              workouts={workouts}
              categoryColors={workoutTypeColors}
              measurements={measurements}
              exercises={exercises}
              onEdit={editWorkout}
              onResume={resumeWorkout}
              onDelete={deleteWorkout}
              personalRecords={personalRecords}
              onDataChange={refreshAfterMutation}
              initialOpenId={historyOpenId}
              section={historySection}
              onSectionChange={(section) => setTab(section)}
              onOpenExercise={(exerciseId) => openHistorySection('progress', exerciseId)}
              onOpenWorkout={(workoutId, exerciseId) => {
                setHistoryOpenId(workoutId);
                setHistoryExerciseId(exerciseId);
                setTab('history');
              }}
              initialExerciseId={historyExerciseId}
              weekStartDay={weekStartDayFrom(dashboard?.weekly_sets?.week_start)}
              heatmap={dashboard?.heatmap ?? []}
              activeWorkout={activeWorkoutStartedAt !== null}
              activeWorkoutDate={activeWorkoutDate}
              onResumeWorkout={() => setTab('log')}
              onStartWorkout={(workoutDate) => startWorkout(workoutDate)}
              onReplaceActiveWorkout={(workoutDate) => startWorkout(workoutDate, true)}
            />
          </CachedTabPanel>
        )}
        {!loading && (tab === 'settings' || visitedTabs.has('settings')) && (
          <CachedTabPanel active={tab === 'settings'}>
            <SettingsScreen
              workouts={workouts}
              measurements={measurements}
              workoutTypeColors={workoutTypeColors}
              onWorkoutTypeColorsChange={setWorkoutTypeColors}
              restTimerEnabled={restTimerEnabled}
              onRestTimerEnabledChange={updateRestTimerPreference}
              reduceMotion={reduceMotion}
              onReduceMotionChange={updateReduceMotion}
              bodyTrendPreference={bodyTrendPreference}
              onBodyTrendPreferenceChange={updateBodyTrendPreference}
              onImportWorkouts={importWorkoutCsv}
              onExportWorkouts={exportWorkoutCsv}
              onDeleteSamples={deleteSampleData}
              onDataChange={refreshAfterMutation}
              account={user}
              onOpenProfile={() => setTab('profile')}
              onOpenAdmin={isAdmin ? () => setTab('admin') : undefined}
            />
          </CachedTabPanel>
        )}
        {user && (tab === 'profile' || visitedTabs.has('profile')) && (
          <CachedTabPanel active={tab === 'profile'}>
            <ProfileScreen />
          </CachedTabPanel>
        )}
        {isAdmin && (tab === 'admin' || visitedTabs.has('admin')) && (
          <CachedTabPanel active={tab === 'admin'}>
            <AdminScreen active={tab === 'admin'} />
          </CachedTabPanel>
        )}
        {videosAllowed && (tab === 'videos' || visitedTabs.has('videos')) && (
          <CachedTabPanel active={tab === 'videos'}>
            <VideoUpload />
          </CachedTabPanel>
        )}
      </main>

      {showTabBar && (
        <AppTabBar
          active={activeMainTab}
          workoutStartedAt={activeWorkoutStartedAt}
          onSelect={(nextTab) => {
            if (nextTab === 'history' || nextTab === 'progress') openHistorySection(nextTab);
            else setTab(nextTab);
          }}
          onStart={() => startWorkout()}
        />
      )}
    </div>
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

function OverlayScreenHeader({
  title,
  subtitle,
  onBack,
  actions,
  onTitleClick,
  titleActionLabel,
}: {
  title: string;
  subtitle: ReactNode;
  onBack: () => void;
  actions?: ReactNode;
  onTitleClick?: () => void;
  titleActionLabel?: string;
}) {
  return (
    <header className="overlay-screen-header">
      <button className="overlay-header-back" type="button" onClick={onBack} aria-label="Go back">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M14.5 5.5 8 12l6.5 6.5" />
        </svg>
      </button>
      <div className="overlay-header-copy">
        {onTitleClick ? (
          <button
            className="overlay-header-title-button"
            type="button"
            onClick={onTitleClick}
            aria-label={titleActionLabel ?? `Edit ${title}`}
          >
            <strong>{title}</strong>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="m4 20 4.2-1 10.6-10.6a2.1 2.1 0 0 0-3-3L5.2 16 4 20Zm10.5-13.5 3 3" />
            </svg>
          </button>
        ) : (
          <strong>{title}</strong>
        )}
        <span>{subtitle}</span>
      </div>
      {actions && <div className="overlay-header-actions">{actions}</div>}
    </header>
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

function WorkoutCalendar({
  entries,
  categoryColors,
  activeWorkoutDate = null,
  onActiveWorkoutClick,
  onDayClick,
}: {
  entries: DashboardData['heatmap'];
  categoryColors: WorkoutTypeColors;
  activeWorkoutDate?: string | null;
  onActiveWorkoutClick?: () => void;
  onDayClick: (workoutDate: string, entry: DashboardData['heatmap'][number] | undefined) => void;
}) {
  const calendarScrollRef = useRef<HTMLDivElement>(null);
  const map = new Map(entries.map((entry) => [entry.workout_date, entry]));
  const months = useMemo(() => {
    const today = new Date();
    today.setHours(12, 0, 0, 0);
    const datedEntries = activeWorkoutDate
      ? [...entries, { workout_date: activeWorkoutDate }]
      : entries;
    const allMonthCount = monthCountFromOldestWorkout(datedEntries, today);
    return Array.from({ length: Math.max(allMonthCount, 1) }, (_, offset) => {
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
  }, [activeWorkoutDate, entries]);
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
            <span className="calendar-week-total-heading">Sets</span>
          </div>
          <div className="calendar-days">
            {Array.from({ length: 6 }, (_, row) => month.cells.slice(row * 7, row * 7 + 7))
              .filter((week) => week.some(Boolean))
              .map((week, row) => {
                const weekSets = week.reduce(
                  (total, day) =>
                    day ? total + (map.get(localCalendarDate(day))?.set_count ?? 0) : total,
                  0,
                );
                return (
                  <Fragment key={`row-${row}`}>
                    {week.map((day, index) => {
                      if (!day) {
                        return (
                          <span className="calendar-day empty" key={`empty-${row}-${index}`} />
                        );
                      }
                      const key = localCalendarDate(day);
                      const entry = map.get(key);
                      const inProgress = key === activeWorkoutDate;
                      const colours =
                        entry?.categories.map((category) => categoryColors[category]) ?? [];
                      return (
                        <button
                          type="button"
                          className={`calendar-day ${entry ? 'trained' : ''} ${inProgress ? 'in-progress' : ''} ${key === todayKey ? 'today' : ''} ${key > todayKey ? 'future' : ''}`}
                          key={key}
                          onClick={() => {
                            if (inProgress && onActiveWorkoutClick) onActiveWorkoutClick();
                            else onDayClick(key, entry);
                          }}
                          aria-current={key === todayKey ? 'date' : undefined}
                          aria-label={
                            inProgress
                              ? `Resume workout in progress for ${prettyDate(key)}`
                              : entry
                                ? `View ${entry.workout_count} ${entry.workout_count === 1 ? 'workout' : 'workouts'} for ${prettyDate(key)}`
                                : `Create workout for ${prettyDate(key)}`
                          }
                          title={
                            inProgress
                              ? `${prettyDate(key)}: workout in progress`
                              : entry
                                ? `${prettyDate(key)}: ${entry.workout_count} ${entry.workout_count === 1 ? 'workout' : 'workouts'}, ${entry.set_count} sets`
                                : prettyDate(key)
                          }
                        >
                          <span className="calendar-day-number">{day.getDate()}</span>
                          <span className="calendar-day-dots" aria-hidden="true">
                            {inProgress ? (
                              <i className="calendar-live-dot" />
                            ) : (
                              colours.map((colour, dotIndex) => (
                                <i key={dotIndex} style={{ background: colour }} />
                              ))
                            )}
                          </span>
                        </button>
                      );
                    })}
                    <span className="calendar-week-total num">{weekSets || ''}</span>
                  </Fragment>
                );
              })}
          </div>
        </article>
      ))}
    </div>
  );
}

function InteractiveWorkoutCalendar({
  entries,
  workouts,
  categoryColors,
  activeWorkout,
  activeWorkoutDate,
  onResumeWorkout,
  onEditWorkout,
  onStartWorkout,
  onReplaceActiveWorkout,
}: {
  entries: DashboardData['heatmap'];
  workouts: TrackedWorkout[];
  categoryColors: WorkoutTypeColors;
  activeWorkout: boolean;
  activeWorkoutDate: string | null;
  onResumeWorkout: () => void;
  onEditWorkout: (workout: TrackedWorkout) => void;
  onStartWorkout: (workoutDate: string) => void;
  onReplaceActiveWorkout: (workoutDate: string) => void;
}) {
  const [selectedDay, setSelectedDay] = useState<DashboardData['heatmap'][number] | null>(null);
  const [pendingWorkoutDate, setPendingWorkoutDate] = useState<string | null>(null);
  const presentCategories = (Object.keys(categoryNames) as WorkoutCategory[]).filter((category) =>
    entries.some((day) => day.categories.includes(category)),
  );

  return (
    <>
      <WorkoutCalendar
        entries={entries}
        categoryColors={categoryColors}
        activeWorkoutDate={activeWorkoutDate}
        onActiveWorkoutClick={onResumeWorkout}
        onDayClick={(workoutDate, entry) => {
          if (entry) setSelectedDay(entry);
          else setPendingWorkoutDate(workoutDate);
        }}
      />
      {presentCategories.length > 0 && (
        <ul className="category-legend" aria-label="Workout types">
          {presentCategories.map((category) => (
            <li key={category}>
              <i style={{ background: categoryColors[category] }} aria-hidden="true" />
              {categoryNames[category]}
            </li>
          ))}
        </ul>
      )}
      {selectedDay && (
        <CalendarDayDetail
          day={selectedDay}
          categoryColors={categoryColors}
          onClose={() => setSelectedDay(null)}
          onStartWorkout={(workoutDate) => {
            setSelectedDay(null);
            setPendingWorkoutDate(workoutDate);
          }}
          onEditWorkout={(workoutId) => {
            const workout = workouts.find((item) => item.id === workoutId);
            if (!workout) return;
            setSelectedDay(null);
            onEditWorkout(workout);
          }}
        />
      )}
      {pendingWorkoutDate && (
        <CalendarCreateWorkoutDialog
          workoutDate={pendingWorkoutDate}
          activeWorkout={activeWorkout}
          onCancel={() => setPendingWorkoutDate(null)}
          onConfirm={() => {
            const workoutDate = pendingWorkoutDate;
            setPendingWorkoutDate(null);
            if (activeWorkout) onReplaceActiveWorkout(workoutDate);
            else onStartWorkout(workoutDate);
          }}
        />
      )}
    </>
  );
}

function CalendarDayDetail({
  day,
  categoryColors,
  onClose,
  onStartWorkout,
  onEditWorkout,
}: {
  day: DashboardData['heatmap'][number];
  categoryColors: WorkoutTypeColors;
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

function WorkoutLogger({
  exercises,
  categoryColors,
  recommendation,
  template,
  initialDate,
  initialWorkout,
  resumingWorkout,
  currentBodyweight,
  personalRecords,
  historicalWorkouts,
  restTimerEnabled,
  onExerciseHistory,
  onExerciseFavorite,
  onCreateExercise,
  onSave,
  onAutoSaved,
  activeStartedAt,
  onClose,
  onDelete,
}: {
  exercises: Exercise[];
  categoryColors: WorkoutTypeColors;
  recommendation: WorkoutRecommendation | null;
  template: SessionTemplate | null;
  initialDate: string;
  initialWorkout: TrackedWorkout | null;
  resumingWorkout: TrackedWorkout | null;
  currentBodyweight: number | null;
  personalRecords: PersonalRecord[];
  historicalWorkouts: TrackedWorkout[];
  restTimerEnabled: boolean;
  onExerciseHistory: (exerciseId: string) => void;
  onExerciseFavorite: (exerciseId: string, isFavorite: boolean) => Promise<void>;
  onCreateExercise: (input: ExerciseCreateInput) => Promise<Exercise>;
  onSave: (payload: WorkoutInput) => Promise<void>;
  onAutoSaved: () => void;
  activeStartedAt: number | null;
  onClose: () => void;
  onDelete: () => void;
}) {
  const restoredDraft = useState(() => (initialWorkout ? null : readActiveWorkoutDraft()))[0];
  const [name, setName] = useState(
    initialWorkout?.name ?? restoredDraft?.name ?? resumingWorkout?.name ?? '',
  );
  const [workoutDate, setWorkoutDate] = useState(
    initialWorkout?.workout_date ??
      restoredDraft?.workoutDate ??
      resumingWorkout?.workout_date ??
      initialDate,
  );
  const [category, setCategory] = useState<WorkoutCategory>(
    initialWorkout?.category ??
      restoredDraft?.category ??
      resumingWorkout?.category ??
      template?.category ??
      recommendation?.category ??
      'push',
  );
  const [notes, setNotes] = useState(
    initialWorkout?.notes ?? restoredDraft?.notes ?? resumingWorkout?.notes ?? '',
  );
  const [durationOverrideMinutes, setDurationOverrideMinutes] = useState<number | null>(
    restoredDraft?.durationOverrideMinutes ?? null,
  );
  const [editedDurationMinutes, setEditedDurationMinutes] = useState(
    initialWorkout?.duration_minutes ?? 0,
  );
  const [startTime, setStartTime] = useState(
    workoutTimeInputValue(initialWorkout?.start_time ?? null),
  );
  const [endTime, setEndTime] = useState(workoutTimeInputValue(initialWorkout?.end_time ?? null));
  const sourceWorkout = initialWorkout ?? (restoredDraft ? null : resumingWorkout);
  const [movements, setMovements] = useState<DraftMovement[]>(() =>
    sourceWorkout
      ? sourceWorkout.movements.map((movement) => ({
          key: crypto.randomUUID(),
          exercise: movement.exercise,
          notes: movement.notes ?? '',
          machinePhotoIds: movement.machine_photos.map((photo) => photo.id),
          machinePhotosInitialized: true,
          supersetKey: movement.superset_group_id,
          isComplete: false,
          sets: movement.sets.map((item) => ({
            key: crypto.randomUUID(),
            reps: item.reps,
            weight_kg: item.weight_kg,
            rpe: item.rpe,
            rest_seconds: item.rest_seconds,
            duration_seconds: item.duration_seconds,
            distance_km: item.distance_km,
            calories_kcal: item.calories_kcal,
            average_heart_rate_bpm: item.average_heart_rate_bpm,
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
      : restoredDraft
        ? restoredDraft.movements.flatMap((movement) => {
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
                    isComplete: movement.isComplete ?? false,
                    sets: movement.sets,
                  },
                ]
              : [];
          })
        : (template?.exercises ?? []).map(({ exercise }) => ({
            key: crypto.randomUUID(),
            exercise,
            notes: '',
            machinePhotoIds: [],
            machinePhotosInitialized: false,
            supersetKey: null,
            isComplete: false,
            sets: suggestedSetsFromHistory(historicalWorkouts, exercise, initialDate),
          })),
  );
  const [pickerOpen, setPickerOpen] = useState(false);
  const movementStackRef = useRef<HTMLDivElement>(null);
  useFlipAnimation(movementStackRef, movements.map((movement) => movement.key).join('|'));
  const [switchingMovementKey, setSwitchingMovementKey] = useState<string | null>(null);
  const [supersetPickerKey, setSupersetPickerKey] = useState<string | null>(null);
  const [deleteConfirmationOpen, setDeleteConfirmationOpen] = useState(false);
  const [finishConfirmationOpen, setFinishConfirmationOpen] = useState(false);
  const [nameEditorOpen, setNameEditorOpen] = useState(false);
  const [nameDraft, setNameDraft] = useState(name);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const deleteButtonRef = useRef<HTMLButtonElement>(null);
  const supersetButtonRef = useRef<HTMLButtonElement>(null);
  const startedAt = useState(() => restoredDraft?.startedAt ?? activeStartedAt ?? Date.now())[0];
  const resumedWorkoutId = restoredDraft?.resumingWorkoutId ?? resumingWorkout?.id ?? null;
  const previousDurationMinutes = useState(
    () => restoredDraft?.previousDurationMinutes ?? resumingWorkout?.duration_minutes ?? 0,
  )[0];
  const initialActivity = useState(() => {
    const lastActiveAt = Math.max(
      startedAt,
      restoredDraft?.lastActiveAt ?? restoredDraft?.updatedAt ?? startedAt,
    );
    const normalFinishAt = inactiveWorkoutFinishAt(startedAt, lastActiveAt);
    const legacyDraftAlreadyOverdue =
      restoredDraft !== null &&
      restoredDraft.inactiveFinishAt === undefined &&
      Date.now() >= startedAt + MAX_INACTIVE_WORKOUT_MS;
    return {
      lastActiveAt,
      finishAt:
        restoredDraft?.inactiveFinishAt ??
        (legacyDraftAlreadyOverdue ? startedAt + MAX_INACTIVE_WORKOUT_MS : normalFinishAt),
    };
  })[0];
  const lastActiveAtRef = useRef(initialActivity.lastActiveAt);
  const inactiveFinishAtRef = useRef(initialActivity.finishAt);
  const savingRef = useRef(false);
  const finishWorkoutRef = useRef<(automaticEndAt?: number) => Promise<void>>(async () => {});
  const [elapsed, setElapsed] = useState(
    initialWorkout
      ? (initialWorkout.duration_minutes ?? 0) * 60
      : Math.max(0, Math.floor((Date.now() - startedAt) / 1000)),
  );
  const [restLeft, setRestLeft] = useState(0);
  const restNotificationEndpointRef = useRef<string | null>(null);
  const activeRestTimerRef = useRef<{
    id: string;
    endsAt: number;
    serverScheduled: boolean;
    pendingSchedules: Set<Promise<void>>;
  } | null>(null);

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
    let lastActivityWriteAt = 0;
    const persistDraft = () => {
      writeActiveWorkoutDraft({
        version: 1,
        startedAt,
        ...(resumedWorkoutId && {
          resumingWorkoutId: resumedWorkoutId,
          previousDurationMinutes,
        }),
        updatedAt: Date.now(),
        lastActiveAt: lastActiveAtRef.current,
        inactiveFinishAt: inactiveFinishAtRef.current,
        durationOverrideMinutes,
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
          isComplete: movement.isComplete,
          sets: movement.sets,
        })),
      });
    };
    const recordActivity = () => {
      const now = Date.now();
      if (now >= inactiveFinishAtRef.current) {
        void finishWorkoutRef.current(inactiveFinishAtRef.current);
        return;
      }
      lastActiveAtRef.current = now;
      inactiveFinishAtRef.current = extendInactiveWorkoutFinishAt(inactiveFinishAtRef.current, now);
      if (now - lastActivityWriteAt >= 15_000) {
        lastActivityWriteAt = now;
        persistDraft();
      }
    };
    const persistWhenHidden = () => {
      if (document.visibilityState === 'hidden') {
        persistDraft();
      }
    };
    persistDraft();
    window.addEventListener('pagehide', persistDraft);
    window.addEventListener('pointerdown', recordActivity, { capture: true, passive: true });
    window.addEventListener('keydown', recordActivity, true);
    window.addEventListener('scroll', recordActivity, { capture: true, passive: true });
    document.addEventListener('visibilitychange', persistWhenHidden);
    return () => {
      window.removeEventListener('pagehide', persistDraft);
      window.removeEventListener('pointerdown', recordActivity, true);
      window.removeEventListener('keydown', recordActivity, true);
      window.removeEventListener('scroll', recordActivity, true);
      document.removeEventListener('visibilitychange', persistWhenHidden);
    };
  }, [
    category,
    initialWorkout,
    movements,
    name,
    notes,
    previousDurationMinutes,
    resumedWorkoutId,
    startedAt,
    workoutDate,
    durationOverrideMinutes,
  ]);

  useEffect(() => {
    if (!pushNotificationsSupported()) return;
    let active = true;
    const syncPushState = () => {
      void existingPhonePushSubscription()
        .then((subscription) => {
          if (!active) return;
          if (!subscription) {
            restNotificationEndpointRef.current = null;
            return;
          }
          restNotificationEndpointRef.current = subscription.endpoint;
          const timer = activeRestTimerRef.current;
          if (timer) scheduleRestTimerPush(timer, subscription.endpoint);
        })
        .catch(() => undefined);
    };
    syncPushState();
    window.addEventListener(PHONE_PUSH_PREFERENCE_EVENT, syncPushState);
    return () => {
      active = false;
      window.removeEventListener(PHONE_PUSH_PREFERENCE_EVENT, syncPushState);
    };
  }, []);

  useEffect(() => {
    if (restLeft <= 0) return;
    const interval = window.setInterval(() => {
      const active = activeRestTimerRef.current;
      if (!active) return;
      const next = Math.max(0, Math.ceil((active.endsAt - Date.now()) / 1000));
      setRestLeft((current) => {
        if (next === 0 && current > 0) {
          activeRestTimerRef.current = null;
          if (!active.serverScheduled) void showRestTimerNotification();
        }
        return next;
      });
    }, 500);
    return () => window.clearInterval(interval);
  }, [restLeft]);

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
  const completedSetKeysRef = useRef(
    new Set(
      movements.flatMap((movement) =>
        movement.sets.filter((item) => item.completed).map((item) => item.key),
      ),
    ),
  );
  const [prConfettiBurst, setPrConfettiBurst] = useState(0);

  useEffect(() => {
    const completedSetKeys = new Set<string>();
    let achievedNewPr = false;
    movements.forEach((movement) => {
      movement.sets.forEach((item) => {
        if (!item.completed) return;
        completedSetKeys.add(item.key);
        if (
          !completedSetKeysRef.current.has(item.key) &&
          prBadges.get(movement.key)?.has(item.key)
        ) {
          achievedNewPr = true;
        }
      });
    });
    completedSetKeysRef.current = completedSetKeys;
    if (achievedNewPr) setPrConfettiBurst((current) => current + 1);
  }, [movements, prBadges]);
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
    return recent;
  }, [historicalWorkouts]);

  function suggestedSetsForExercise(exercise: Exercise): DraftSet[] {
    return suggestedSetsFromHistory(historicalWorkouts, exercise, workoutDate, initialWorkout?.id);
  }

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
        isComplete: false,
        sets: suggestedSetsForExercise(exercise),
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
    const suggestedSets = suggestedSetsForExercise(replacement);
    setMovements((current) =>
      replaceMovementExercise(current, switchingMovementKey, replacement).map((movement) =>
        movement.key === switchingMovementKey ? { ...movement, sets: suggestedSets } : movement,
      ),
    );
    closeExercisePicker();
  }

  function moveMovement(index: number, direction: -1 | 1) {
    setMovements((current) => moveItem(current, index, index + direction));
  }

  function moveSet(movementKey: string, fromIndex: number, toIndex: number) {
    setMovements((current) =>
      current.map((movement) =>
        movement.key === movementKey
          ? { ...movement, sets: moveItem(movement.sets, fromIndex, toIndex) }
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

  function scheduleRestTimerPush(
    timer: NonNullable<typeof activeRestTimerRef.current>,
    endpoint: string,
  ) {
    const delaySeconds = Math.max(1, Math.ceil((timer.endsAt - Date.now()) / 1000));
    timer.serverScheduled = false;
    const request = api
      .scheduleRestTimerNotification({
        endpoint,
        timer_id: timer.id,
        delay_seconds: delaySeconds,
      })
      .then(() => {
        if (activeRestTimerRef.current?.id === timer.id) timer.serverScheduled = true;
      })
      .catch(() => {
        if (activeRestTimerRef.current?.id === timer.id) timer.serverScheduled = false;
      });
    timer.pendingSchedules.add(request);
  }

  function startRestTimer(seconds: number) {
    if (!restTimerEnabled) return;
    const timer = {
      id: crypto.randomUUID(),
      endsAt: Date.now() + seconds * 1000,
      serverScheduled: false,
      pendingSchedules: new Set<Promise<void>>(),
    };
    activeRestTimerRef.current = timer;
    setRestLeft(seconds);
    const endpoint = restNotificationEndpointRef.current;
    if (endpoint) scheduleRestTimerPush(timer, endpoint);
  }

  function cancelRestTimer() {
    const timer = activeRestTimerRef.current;
    activeRestTimerRef.current = null;
    setRestLeft(0);
    void dismissRestTimerNotifications().catch(() => undefined);
    const endpoint = restNotificationEndpointRef.current;
    if (timer && endpoint) {
      const cancelServerTimer = () =>
        api.cancelRestTimerNotification({ endpoint, timer_id: timer.id });
      void cancelRestTimerPushSchedule(cancelServerTimer, timer.pendingSchedules);
    }
  }

  function skipRestTimer() {
    cancelRestTimer();
  }

  useEffect(() => {
    if (restTimerEnabled) return;
    cancelRestTimer();
  }, [restTimerEnabled]);

  function updateSet(movementKey: string, setKey: string, update: Partial<DraftSet>) {
    const movement = movements.find((item) => item.key === movementKey);
    const currentSet = movement?.sets.find((item) => item.key === setKey);
    const restSeconds =
      movement && currentSet
        ? restTimerSecondsAfterSetUpdate(movement.exercise.kind, currentSet, update)
        : null;

    setMovements((current) =>
      current.map((movement) =>
        movement.key === movementKey
          ? {
              ...movement,
              sets: movement.sets.map((item) =>
                item.key === setKey ? { ...item, ...update, fromPrevious: false } : item,
              ),
            }
          : movement,
      ),
    );
    if (restSeconds !== null) startRestTimer(restSeconds);
  }

  function toggleSet(movement: DraftMovement, item: DraftSet) {
    updateSet(movement.key, item.key, { completed: !item.completed });
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

  function openExercisePicker() {
    setSwitchingMovementKey(null);
    setPickerOpen(true);
  }

  async function finishWorkout(automaticEndAt?: number) {
    if (savingRef.current) return;
    const finishedAt = automaticEndAt ?? Date.now();
    const durationMinutes = initialWorkout
      ? editedDurationMinutes
      : completedWorkoutDurationMinutes(
          previousDurationMinutes,
          startedAt,
          finishedAt,
          durationOverrideMinutes,
        );
    const movementsToSave =
      automaticEndAt === undefined
        ? movements
        : movements.map((movement) => ({
            ...movement,
            sets: movement.sets.map((item) => workoutSetForAutoSave(movement.exercise.kind, item)),
          }));
    const completed = movementsToSave
      .flatMap((movement) => movement.sets)
      .filter((item) => item.completed);
    if (!movements.length || !completed.length) {
      setError('Add an exercise and complete at least one set before saving.');
      return;
    }
    if (initialWorkout && Boolean(startTime) !== Boolean(endTime)) {
      setError('Enter both a workout start time and end time, or leave both blank.');
      return;
    }
    if (!initialWorkout && durationOverrideMinutes === null && durationMinutes > 1440) {
      setError(
        'The total workout duration is over 24 hours. Enter the actual total duration below before saving.',
      );
      return;
    }
    savingRef.current = true;
    setSaving(true);
    setError(null);
    const completedIdentity = finalizeWorkoutIdentity(
      movements.map((movement) => movement.exercise),
      category,
      name,
      !initialWorkout && !resumedWorkoutId,
    );
    try {
      cancelRestTimer();
      await onSave({
        name: completedIdentity.name,
        workout_date: workoutDate,
        category: completedIdentity.category,
        notes: notes.trim() || null,
        duration_minutes: durationMinutes,
        start_time: initialWorkout && startTime && endTime ? startTime : null,
        end_time: initialWorkout && startTime && endTime ? endTime : null,
        movements: movementsToSave.map((movement) => ({
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
            calories_kcal: item.calories_kcal,
            average_heart_rate_bpm: item.average_heart_rate_bpm,
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
      if (automaticEndAt !== undefined) {
        onAutoSaved();
        void showWorkoutAutoSavedNotification().catch(() => undefined);
      }
    } catch (saveError) {
      savingRef.current = false;
      setError(saveError instanceof Error ? saveError.message : 'Could not save the workout.');
      setSaving(false);
    }
  }

  finishWorkoutRef.current = finishWorkout;

  useEffect(() => {
    if (initialWorkout) return;
    const hasSavableSet = movements.some((movement) =>
      movement.sets.some((item) => isWorkoutSetAutoSavable(movement.exercise.kind, item)),
    );
    const checkForInactiveWorkout = () => {
      if (!hasSavableSet || savingRef.current) return;
      const now = Date.now();
      if (now < inactiveFinishAtRef.current) return;
      void finishWorkoutRef.current(inactiveFinishAtRef.current);
    };
    checkForInactiveWorkout();
    const interval = window.setInterval(checkForInactiveWorkout, 30_000);
    window.addEventListener('focus', checkForInactiveWorkout);
    window.addEventListener('online', checkForInactiveWorkout);
    document.addEventListener('visibilitychange', checkForInactiveWorkout);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener('focus', checkForInactiveWorkout);
      window.removeEventListener('online', checkForInactiveWorkout);
      document.removeEventListener('visibilitychange', checkForInactiveWorkout);
    };
  }, [initialWorkout, movements, startedAt]);

  const editedDurationHours = Math.floor(editedDurationMinutes / 60);
  const editedDurationRemainder = editedDurationMinutes % 60;
  const overrideDurationHours =
    durationOverrideMinutes === null ? '' : Math.floor(durationOverrideMinutes / 60);
  const overrideDurationRemainder =
    durationOverrideMinutes === null ? '' : durationOverrideMinutes % 60 || '';
  const updateDurationOverride = (hoursValue: string, minutesValue: string) => {
    if (hoursValue === '' && minutesValue === '') {
      setDurationOverrideMinutes(null);
      return;
    }
    const hours = Math.min(24, Math.max(0, Math.floor(Number(hoursValue) || 0)));
    const minutes = Math.min(59, Math.max(0, Math.floor(Number(minutesValue) || 0)));
    setDurationOverrideMinutes(Math.min(1440, Math.max(1, hours * 60 + minutes)));
  };
  const hasCompleteTimeRange = Boolean(startTime && endTime);
  const updateWorkoutTimes = (nextStart: string, nextEnd: string) => {
    setStartTime(nextStart);
    setEndTime(nextEnd);
    const duration = workoutDurationMinutes(nextStart, nextEnd);
    if (duration !== null) setEditedDurationMinutes(duration);
  };
  const completedSets = movements.flatMap((movement) =>
    movement.sets.filter((item) => item.completed),
  );
  const completedReps = completedSets.reduce((total, item) => total + (item.reps ?? 0), 0);
  const completedVolume = completedSets.reduce(
    (total, item) => total + (item.weight_kg ?? 0) * (item.reps ?? 0),
    0,
  );
  const displayedDurationSeconds = initialWorkout
    ? editedDurationMinutes * 60
    : durationOverrideMinutes !== null
      ? durationOverrideMinutes * 60
      : previousDurationMinutes * 60 + elapsed;
  const openNameEditor = () => {
    setNameDraft(name);
    setNameEditorOpen(true);
  };

  // Matches the name and type saved for a new workout, which are inferred from its exercises.
  const liveIdentity = finalizeWorkoutIdentity(
    movements.map((movement) => movement.exercise),
    category,
    name,
    !initialWorkout && !resumedWorkoutId,
  );

  return (
    <section className="logger-screen content-page">
      {prConfettiBurst > 0 &&
        (motionReduced() ? null : (
          <ConfettiBurst key={prConfettiBurst} onComplete={() => setPrConfettiBurst(0)} />
        ))}
      <OverlayScreenHeader
        title={liveIdentity.name}
        subtitle={
          <WorkoutHeaderMeta
            durationLabel={
              initialWorkout
                ? formatDuration(displayedDurationSeconds)
                : `Live ${formatDuration(elapsed)}`
            }
            restSeconds={restTimerEnabled && restLeft > 0 ? restLeft : null}
            onSkipRest={skipRestTimer}
          />
        }
        onBack={onClose}
        onTitleClick={openNameEditor}
        titleActionLabel="Edit workout name"
        actions={
          <>
            <button
              ref={deleteButtonRef}
              className="overlay-header-action delete"
              type="button"
              onClick={() => setDeleteConfirmationOpen(true)}
              aria-label={resumedWorkoutId ? 'Discard resumed session' : 'Delete workout'}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M4 7h16M9 7V4h6v3m-8 0 1 13h8l1-13M10 11v5m4-5v5" />
              </svg>
            </button>
            <button
              className="overlay-header-action add"
              type="button"
              onClick={openExercisePicker}
              aria-label="Add exercise"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M12 5v14M5 12h14" />
              </svg>
            </button>
          </>
        }
      />
      {recommendation && !initialWorkout && !template && movements.length === 0 && (
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
            <fieldset
              className={`workout-duration-editor${initialWorkout ? '' : ' live-workout-duration-editor'}`}
              aria-label={initialWorkout ? undefined : 'Workout duration'}
            >
              {initialWorkout && <legend>Workout timing</legend>}
              {initialWorkout && (
                <>
                  <label>
                    Start time
                    <input
                      type="time"
                      value={startTime}
                      onChange={(event) => updateWorkoutTimes(event.target.value, endTime)}
                      aria-label="Workout start time"
                    />
                  </label>
                  <label>
                    End time
                    <input
                      type="time"
                      value={endTime}
                      onChange={(event) => updateWorkoutTimes(startTime, event.target.value)}
                      aria-label="Workout end time"
                    />
                  </label>
                </>
              )}
              <label>
                Duration hours
                <input
                  type="number"
                  min="0"
                  max="24"
                  inputMode="numeric"
                  disabled={Boolean(initialWorkout && hasCompleteTimeRange)}
                  value={initialWorkout ? editedDurationHours || '' : overrideDurationHours}
                  placeholder="0"
                  onChange={(event) => {
                    if (!initialWorkout) {
                      updateDurationOverride(event.target.value, String(overrideDurationRemainder));
                      return;
                    }
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
                Duration minutes
                <input
                  type="number"
                  min="0"
                  max="59"
                  inputMode="numeric"
                  disabled={Boolean(initialWorkout && hasCompleteTimeRange)}
                  value={initialWorkout ? editedDurationRemainder || '' : overrideDurationRemainder}
                  placeholder="0"
                  onChange={(event) => {
                    if (!initialWorkout) {
                      updateDurationOverride(String(overrideDurationHours), event.target.value);
                      return;
                    }
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
              <small className="workout-timing-help">
                {initialWorkout
                  ? hasCompleteTimeRange
                    ? `${formatWorkoutTimeRange(startTime, endTime)} · duration calculated automatically`
                    : 'Add both times to calculate duration automatically, including workouts ending after midnight.'
                  : resumedWorkoutId
                    ? `${previousDurationMinutes} min already logged. The live timer started when you resumed; the gap is excluded. Change these fields only to correct the total duration.`
                    : 'Leave both blank to use the live timer. Change them only if the timer is wrong.'}
              </small>
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
              <small>BW kg</small>
              <strong>{currentBodyweight}</strong>
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
            <small>Vol kg</small>
            <strong>{completedVolume.toLocaleString()}</strong>
          </span>
        </div>
      </section>

      {error && <p className="inline-error">{error}</p>}

      <div className="movement-stack" ref={movementStackRef}>
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
            history={recentExerciseHistory(
              historicalWorkouts,
              movement.exercise.id,
              initialWorkout?.id,
            )}
            onExerciseHistory={() => onExerciseHistory(movement.exercise.id)}
            onExerciseComplete={(isComplete) =>
              setMovements((current) =>
                current.map((item) => (item.key === movement.key ? { ...item, isComplete } : item)),
              )
            }
            onUpdateSet={(setKey, update) => updateSet(movement.key, setKey, update)}
            onToggleSet={(item) => toggleSet(movement, item)}
            onAddSet={() => addSet(movement)}
            onSwitch={() => {
              setSwitchingMovementKey(movement.key);
              setPickerOpen(true);
            }}
            onRemove={() => removeMovement(movement.key)}
            onMoveUp={() => moveMovement(movementIndex, -1)}
            onMoveDown={() => moveMovement(movementIndex, 1)}
            canMoveUp={movementIndex > 0}
            canMoveDown={movementIndex < movements.length - 1}
            onMoveSet={(fromIndex, toIndex) => moveSet(movement.key, fromIndex, toIndex)}
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
      <button className="add-exercise-button" type="button" onClick={openExercisePicker}>
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
        onClick={() => {
          if (initialWorkout) void finishWorkout();
          else setFinishConfirmationOpen(true);
        }}
      >
        {saving ? 'Saving…' : initialWorkout ? 'Save workout' : 'Finish workout'}
      </button>

      {deleteConfirmationOpen && (
        <WorkoutCloseDialog
          editing={Boolean(initialWorkout)}
          resuming={Boolean(resumedWorkoutId)}
          onCancel={() => {
            setDeleteConfirmationOpen(false);
            window.requestAnimationFrame(() => deleteButtonRef.current?.focus());
          }}
          onConfirm={() => {
            cancelRestTimer();
            onDelete();
          }}
        />
      )}

      {finishConfirmationOpen && (
        <PopupDialog
          title="Finish workout?"
          kicker="PLEASE CONFIRM"
          className="workout-finish-dialog"
          onClose={() => setFinishConfirmationOpen(false)}
        >
          <p>This saves your workout and stops the live timer. You can resume it from History.</p>
          <div className="popup-dialog-actions workout-finish-actions">
            <button type="button" autoFocus onClick={() => setFinishConfirmationOpen(false)}>
              Keep working out
            </button>
            <button
              type="button"
              className="popup-primary-action"
              disabled={saving}
              onClick={() => {
                setFinishConfirmationOpen(false);
                void finishWorkout();
              }}
            >
              Finish workout
            </button>
          </div>
        </PopupDialog>
      )}

      {nameEditorOpen && (
        <WorkoutNameDialog
          value={nameDraft}
          fallbackName={`${categoryNames[category]} workout`}
          onChange={setNameDraft}
          onCancel={() => setNameEditorOpen(false)}
          onSave={() => {
            setName(nameDraft.trim());
            setNameEditorOpen(false);
          }}
        />
      )}

      {pickerOpen && (
        <ExercisePicker
          key={switchingMovementKey ? `switch-${switchingMovementKey}` : 'add-exercises'}
          exercises={exercises}
          excludedIds={movements.map((item) => item.exercise.id)}
          recentExerciseIds={recentExerciseIds}
          onFavoriteChange={onExerciseFavorite}
          onCreateExercise={onCreateExercise}
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

function WorkoutNameDialog({
  value,
  fallbackName,
  onChange,
  onCancel,
  onSave,
}: {
  value: string;
  fallbackName: string;
  onChange: (value: string) => void;
  onCancel: () => void;
  onSave: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    dialog.showModal();
    return () => {
      if (dialog.open) dialog.close();
    };
  }, []);

  return createPortal(
    <dialog
      ref={dialogRef}
      className="notification-dialog workout-name-dialog"
      aria-modal="true"
      aria-labelledby="workout-name-dialog-title"
      aria-describedby="workout-name-dialog-description"
      onCancel={(event) => {
        event.preventDefault();
        onCancel();
      }}
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          onSave();
        }}
      >
        <header>
          <div>
            <p className="section-kicker">WORKOUT</p>
            <h2 id="workout-name-dialog-title">Name this workout</h2>
          </div>
          <button
            type="button"
            className="notification-close"
            onClick={onCancel}
            aria-label="Close"
          >
            ×
          </button>
        </header>
        <p id="workout-name-dialog-description">
          Give this session a name, or leave it blank to use “{fallbackName}”.
        </p>
        <label>
          Workout name
          <input
            autoFocus
            value={value}
            onChange={(event) => onChange(event.target.value)}
            placeholder={fallbackName}
            maxLength={120}
          />
        </label>
        <footer>
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="notification-ok">
            Save name
          </button>
        </footer>
      </form>
    </dialog>,
    document.body,
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
        <p id="superset-picker-description">Alternate exercises in a superset/circuit.</p>

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
  resuming,
  onCancel,
  onConfirm,
}: {
  editing: boolean;
  resuming: boolean;
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
          {editing
            ? 'Delete this saved workout?'
            : resuming
              ? 'Discard this resumed session?'
              : 'Delete this workout?'}
        </h2>
        <p id="workout-close-description">
          {editing
            ? 'This workout will be permanently removed from your history. This cannot be undone.'
            : resuming
              ? 'Changes made since resuming will be lost. The saved workout will stay in History.'
              : 'Your active workout, sets, and notes will be permanently removed. This cannot be undone.'}
        </p>
        <div className="workout-close-actions">
          <button ref={safeButtonRef} type="button" onClick={onCancel}>
            Keep workout
          </button>
          <button className="discard-workout-button" type="button" onClick={onConfirm}>
            {resuming ? 'Discard session' : 'Delete workout'}
          </button>
        </div>
      </section>
    </div>,
    document.body,
  );
}

function ExerciseIcon({ exercise, number }: { exercise: Exercise; number?: number }) {
  return (
    <span className="exercise-icon" aria-hidden="true">
      <img src={exerciseIconFor(exercise)} alt="" />
      {number !== undefined && <b>{number}</b>}
    </span>
  );
}

function MovementCard({
  movement,
  number,
  history,
  onExerciseHistory,
  onExerciseComplete,
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
  history: ExerciseHistoryEntry[];
  onExerciseHistory: () => void;
  onExerciseComplete: (isComplete: boolean) => void;
  onUpdateSet: (setKey: string, update: Partial<DraftSet>) => void;
  onToggleSet: (item: DraftSet) => void;
  onAddSet: () => void;
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
  onMoveSet: (fromIndex: number, toIndex: number) => void;
  onDeleteSet: (index: number) => void;
  onSuperset: (button: HTMLButtonElement) => void;
}) {
  const cardio = movement.exercise.kind === 'cardio';
  const treadmill =
    cardio && (movement.exercise.equipment?.toLowerCase().includes('treadmill') ?? false);
  const completedWorkingSetCount = movement.sets.filter(isCompletedWorkingSet).length;
  const lastSessionSummary = !cardio && history[0] ? compactSetSummary(history[0].sets) : '';
  const [expanded, setExpanded] = useState(!movement.isComplete);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [openSetActionsKey, setOpenSetActionsKey] = useState<string | null>(null);
  const [openOverrides, setOpenOverrides] = useState<Readonly<Record<string, boolean>>>({});
  const [typeMenuSetKey, setTypeMenuSetKey] = useState<string | null>(null);
  const [draggingSetKey, setDraggingSetKey] = useState<string | null>(null);
  const [dragTargetSetKey, setDragTargetSetKey] = useState<string | null>(null);
  const [weightDrafts, setWeightDrafts] = useState<Record<string, string>>({});
  const [pendingSetCompletion, setPendingSetCompletion] = useState<{
    item: DraftSet;
    warning: SetEntryWarning;
  } | null>(null);
  const draggingSetKeyRef = useRef<string | null>(null);
  const dragTargetSetKeyRef = useRef<string | null>(null);
  const movementMenuRef = useRef<HTMLDetailsElement>(null);
  const movementNoteRef = useRef<HTMLInputElement>(null);
  const setGridRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLElement>(null);
  const setNumbers = setNumberLabels(movement.sets);

  useEffect(() => {
    if (!movement.isComplete) setExpanded(true);
  }, [movement.isComplete]);

  useEffect(() => {
    if (!openSetActionsKey && !typeMenuSetKey) return;

    const closeMenus = () => {
      setOpenSetActionsKey(null);
      setTypeMenuSetKey(null);
    };
    const closeOutside = (event: PointerEvent) => {
      if (
        event.target instanceof Element &&
        event.target.closest('.set-actions-menu, .set-type-picker')
      ) {
        return;
      }
      closeMenus();
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeMenus();
    };

    document.addEventListener('pointerdown', closeOutside);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOutside);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [openSetActionsKey, typeMenuSetKey]);

  function closeMovementMenu() {
    if (movementMenuRef.current) movementMenuRef.current.open = false;
  }

  function clearSetDrag() {
    draggingSetKeyRef.current = null;
    dragTargetSetKeyRef.current = null;
    setDraggingSetKey(null);
    setDragTargetSetKey(null);
  }

  /** New and unticked sets are edited in place; logged and suggested sets open on tap. */
  function isSetOpen(item: DraftSet) {
    return openOverrides[item.key] ?? (!item.completed && !item.fromPrevious);
  }

  /** Pins a set open or closed; `null` returns it to the default for its state. */
  function setOpenOverride(setKey: string, open: boolean | null) {
    setOpenOverrides((current) => {
      if (open === null ? !(setKey in current) : current[setKey] === open) return current;
      const next = { ...current };
      if (open === null) delete next[setKey];
      else next[setKey] = open;
      return next;
    });
  }

  function openSet(setKey: string, focusField?: SetField) {
    // Render synchronously so the field can take focus inside the tap (iOS keyboard rule).
    flushSync(() => setOpenOverride(setKey, true));
    if (!focusField) return;
    setGridRef.current
      ?.querySelector<HTMLElement>(`[data-set-key="${setKey}"] [data-set-field="${focusField}"]`)
      ?.focus();
  }

  function completeSet(item: DraftSet) {
    onToggleSet(item);
    setOpenOverride(item.key, null);
  }

  /** The tick logs an open set and folds it away; on a folded logged set it unticks and opens it. */
  function checkSet(item: DraftSet, index: number) {
    const finishingEdit = item.completed && isSetOpen(item);
    if (item.completed) setOpenOverride(item.key, null);
    if (!finishingEdit) requestSetCompletion(item, index);
  }

  function requestSetCompletion(item: DraftSet, index: number) {
    if (item.completed) {
      onToggleSet(item);
      return;
    }

    const otherSets = [
      ...movement.sets.slice(0, index).reverse(),
      ...movement.sets.slice(index + 1),
    ];
    const sameTypeReference = otherSets.find(
      (candidate) =>
        candidate.weight_kg !== null &&
        candidate.set_type === item.set_type &&
        candidate.warmup === item.warmup,
    );
    const referenceWeightKg =
      sameTypeReference?.weight_kg ??
      otherSets.find((candidate) => candidate.weight_kg !== null)?.weight_kg ??
      null;
    const warning = unusualSetEntryWarning({
      reps: item.reps,
      weightKg: item.weight_kg,
      referenceWeightKg,
    });
    if (warning) {
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
      setPendingSetCompletion({ item, warning });
      return;
    }
    completeSet(item);
  }

  function beginSetDrag(event: ReactPointerEvent<HTMLButtonElement>, setKey: string) {
    if (!event.isPrimary || (event.pointerType === 'mouse' && event.button !== 0)) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    draggingSetKeyRef.current = setKey;
    dragTargetSetKeyRef.current = setKey;
    setDraggingSetKey(setKey);
    setDragTargetSetKey(setKey);
    setOpenSetActionsKey(null);
  }

  function moveSetDrag(event: ReactPointerEvent<HTMLButtonElement>) {
    if (!draggingSetKeyRef.current) return;
    event.preventDefault();
    event.stopPropagation();

    const target = document
      .elementFromPoint(event.clientX, event.clientY)
      ?.closest<HTMLElement>('.set-details[data-set-key]');
    const targetKey = target?.dataset.setKey;
    if (targetKey && movement.sets.some((item) => item.key === targetKey)) {
      dragTargetSetKeyRef.current = targetKey;
      setDragTargetSetKey(targetKey);
    }

    const scrollEdge = 64;
    if (event.clientY < scrollEdge) window.scrollBy({ top: -12, behavior: 'auto' });
    if (event.clientY > window.innerHeight - scrollEdge) {
      window.scrollBy({ top: 12, behavior: 'auto' });
    }
  }

  function finishSetDrag(event: ReactPointerEvent<HTMLButtonElement>) {
    if (!draggingSetKeyRef.current) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    const fromIndex = movement.sets.findIndex((item) => item.key === draggingSetKeyRef.current);
    const toIndex = movement.sets.findIndex((item) => item.key === dragTargetSetKeyRef.current);
    if (fromIndex >= 0 && toIndex >= 0 && fromIndex !== toIndex) onMoveSet(fromIndex, toIndex);
    clearSetDrag();
  }

  function cancelSetDrag(event: ReactPointerEvent<HTMLButtonElement>) {
    event.stopPropagation();
    clearSetDrag();
  }

  function renderSetDragHandle(item: DraftSet, index: number) {
    return (
      <SetDragHandle
        setNumber={index + 1}
        disabled={movement.sets.length < 2}
        onPointerDown={(event) => beginSetDrag(event, item.key)}
        onPointerMove={moveSetDrag}
        onPointerUp={finishSetDrag}
        onPointerCancel={cancelSetDrag}
        onMoveEarlier={() => {
          if (index > 0) onMoveSet(index, index - 1);
        }}
        onMoveLater={() => {
          if (index < movement.sets.length - 1) onMoveSet(index, index + 1);
        }}
      />
    );
  }

  function renderRowCompleteButton(item: DraftSet, index: number) {
    const open = isSetOpen(item);
    const label = !item.completed
      ? `Complete set ${index + 1}`
      : open
        ? `Done editing set ${index + 1}`
        : `Mark set ${index + 1} incomplete`;
    return (
      <button
        type="button"
        // A logged set opened for editing shows the blue editing tick until it is confirmed.
        className={`row-complete-button ${item.completed && !open ? 'done' : ''}`}
        aria-label={label}
        aria-pressed={item.completed}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          checkSet(item, index);
        }}
      >
        <Icon name="check" />
      </button>
    );
  }

  function renderCompletedSetActions(item: DraftSet, index: number) {
    return (
      <span
        className={`set-actions-menu completed-summary-actions ${openSetActionsKey === item.key ? 'is-open' : ''}`}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
        }}
      >
        {renderSetDragHandle(item, index)}
        <button
          type="button"
          className="completed-set-menu"
          aria-label={`Options for set ${index + 1}`}
          aria-expanded={openSetActionsKey === item.key}
          onClick={() => {
            setTypeMenuSetKey(null);
            setOpenSetActionsKey((current) => (current === item.key ? null : item.key));
          }}
        >
          ⋮
        </button>
        {openSetActionsKey === item.key && (
          <span className="set-actions-menu-popover">
            {!isSetOpen(item) && (
              <button
                type="button"
                onClick={() => {
                  setOpenSetActionsKey(null);
                  openSet(item.key);
                }}
              >
                <span aria-hidden="true">✎</span>
                Edit set
              </button>
            )}
            <button
              type="button"
              disabled={index === 0}
              onClick={() => {
                onMoveSet(index, index - 1);
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
                onMoveSet(index, index + 1);
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
          </span>
        )}
      </span>
    );
  }

  function renderSetTypeButton(item: DraftSet, index: number) {
    if (cardio) {
      return <span className="set-number-cell set-number-normal">{index + 1}</span>;
    }
    const kind = setKindOf(item);
    const menuOpen = typeMenuSetKey === item.key;
    const workingNumber =
      movement.sets.slice(0, index).filter((candidate) => setKindOf(candidate) === 'normal')
        .length + 1;
    return (
      <span className="set-type-picker" onClick={(event) => event.stopPropagation()}>
        <button
          type="button"
          className={`set-number-cell set-number-${kind}`}
          aria-label={`Set ${index + 1} type: ${setTypeTitle(item)}`}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          onClick={() => {
            setOpenSetActionsKey(null);
            setTypeMenuSetKey(menuOpen ? null : item.key);
          }}
        >
          {setNumbers[index]}
        </button>
        {menuOpen && (
          <span className="set-type-menu" role="menu" aria-label={`Type for set ${index + 1}`}>
            {SET_KINDS.map((option) => (
              <button
                key={option.kind}
                type="button"
                role="menuitemradio"
                aria-checked={option.kind === kind}
                onClick={() => {
                  if (option.kind !== kind) {
                    // Editing clears the suggestion flag; keep a folded row folded.
                    if (!isSetOpen(item)) setOpenOverride(item.key, false);
                    onUpdateSet(item.key, setKindUpdate(option.kind));
                  }
                  setTypeMenuSetKey(null);
                }}
              >
                <b className={`set-number-cell set-number-${option.kind}`} aria-hidden="true">
                  {option.letter ?? workingNumber}
                </b>
                {option.label}
              </button>
            ))}
          </span>
        )}
      </span>
    );
  }

  function renderSetSummary(item: DraftSet, index: number) {
    const valueButton = (field: SetField, label: string, className: string, value: ReactNode) => (
      <button
        type="button"
        className={`completed-set-value ${className}`}
        aria-label={`${label} for set ${index + 1}`}
        onClick={(event) => {
          event.stopPropagation();
          openSet(item.key, field);
        }}
      >
        {value}
      </button>
    );
    return (
      <>
        <div className="completed-set-summary" onClick={() => openSet(item.key)}>
          {renderSetTypeButton(item, index)}
          {cardio ? (
            valueButton(
              'duration',
              'Edit time and distance',
              'completed-set-cardio',
              completedSetPerformance(item, true),
            )
          ) : (
            <>
              {valueButton(
                'weight',
                'Edit weight',
                'completed-set-weight',
                <>
                  {item.weight_kg === null ? '–' : `${item.weight_kg} kg`}
                  {prBadges.has(item.key) && (
                    <b className="pr-badge" title={prBadges.get(item.key)?.join(', ')}>
                      PR
                    </b>
                  )}
                </>,
              )}
              {valueButton('reps', 'Edit repetitions', 'completed-set-reps', item.reps ?? '–')}
            </>
          )}
          {valueButton('rpe', 'Edit RPE', 'completed-set-rpe', item.rpe ?? '–')}
          {renderRowCompleteButton(item, index)}
          {renderCompletedSetActions(item, index)}
        </div>
        {item.notes && (
          <button
            type="button"
            className="completed-set-note"
            aria-label={`Edit note for set ${index + 1}`}
            onClick={() => openSet(item.key, 'notes')}
          >
            {item.notes}
          </button>
        )}
      </>
    );
  }

  function renderSetEditor(item: DraftSet, index: number) {
    const suggested = item.fromPrevious ? ', suggested from the last workout' : '';
    return (
      <div className={`set-editor ${item.completed ? 'completed' : ''}`}>
        {renderSetTypeButton(item, index)}
        {cardio ? (
          <>
            <input
              data-set-field="duration"
              inputMode="numeric"
              type="number"
              min="0"
              value={item.duration_seconds === null ? '' : Math.round(item.duration_seconds / 60)}
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
              data-set-field="distance"
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
              data-set-field="weight"
              inputMode="decimal"
              type="text"
              value={weightDrafts[item.key] ?? item.weight_kg ?? ''}
              onFocus={(event) => {
                // Read the value now: the updater can run after React has released the event.
                const { value } = event.currentTarget;
                setWeightDrafts((current) => ({ ...current, [item.key]: value }));
                if (item.weight_kg !== null) event.currentTarget.select();
              }}
              onClick={(event) => {
                if (item.weight_kg !== null) event.currentTarget.select();
              }}
              onChange={(event) => updateWeightDraft(item, event.target.value)}
              onBlur={() => commitWeightDraft(item)}
              aria-label={`Weight kilograms${suggested}`}
            />
            <input
              data-set-field="reps"
              inputMode="numeric"
              type="text"
              value={item.reps ?? ''}
              onFocus={(event) => {
                if (item.reps !== null) event.currentTarget.select();
              }}
              onClick={(event) => {
                if (item.reps !== null) event.currentTarget.select();
              }}
              onChange={(event) =>
                onUpdateSet(item.key, { reps: numberOrNull(event.target.value) })
              }
              aria-label={`Repetitions${suggested}`}
            />
          </>
        )}
        <select
          data-set-field="rpe"
          className={item.rpe === null ? 'is-empty' : ''}
          value={item.rpe ?? ''}
          onChange={(event) => onUpdateSet(item.key, { rpe: numberOrNull(event.target.value) })}
          aria-label="RPE"
        >
          <option value="">–</option>
          {RPE_OPTIONS.map((rpe) => (
            <option key={rpe} value={rpe}>
              {rpe}
            </option>
          ))}
        </select>
        {renderRowCompleteButton(item, index)}
        {renderCompletedSetActions(item, index)}
        <div className="set-editor-extras">
          {cardio && (
            <div className="set-editor-metrics">
              <label>
                kcal
                <input
                  inputMode="numeric"
                  type="number"
                  min="0"
                  value={item.calories_kcal ?? ''}
                  onChange={(event) =>
                    onUpdateSet(item.key, { calories_kcal: numberOrNull(event.target.value) })
                  }
                  aria-label="Active calories"
                />
              </label>
              <label>
                Avg bpm
                <input
                  inputMode="numeric"
                  type="number"
                  min="20"
                  max="250"
                  value={item.average_heart_rate_bpm ?? ''}
                  onChange={(event) =>
                    onUpdateSet(item.key, {
                      average_heart_rate_bpm: numberOrNull(event.target.value),
                    })
                  }
                  aria-label="Average heart rate"
                />
              </label>
              <label>
                km/h
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
                  aria-label="Average speed kilometres per hour"
                />
              </label>
              {treadmill && (
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
                      onUpdateSet(item.key, { incline_percent: numberOrNull(event.target.value) })
                    }
                    aria-label="Treadmill incline percentage"
                  />
                </label>
              )}
            </div>
          )}
          <input
            data-set-field="notes"
            className="set-editor-note"
            value={item.notes ?? ''}
            onChange={(event) => onUpdateSet(item.key, { notes: event.target.value || null })}
            placeholder="Add a note"
            aria-label={`Note for set ${index + 1}`}
          />
          {cardio && (
            <CardioSetScreenshotUpload
              onScan={(scan) => onUpdateSet(item.key, cardioSetUpdateFromScan(scan))}
            />
          )}
        </div>
        {prBadges.has(item.key) && (
          <div className="pr-callout" role="status">
            🏆 {prBadges.get(item.key)?.join(' · ')}
          </div>
        )}
      </div>
    );
  }

  function updateWeightDraft(item: DraftSet, rawValue: string) {
    const draft = rawValue.replace(',', '.');
    if (!/^\d*(?:\.\d*)?$/.test(draft)) return;
    setWeightDrafts((current) => ({ ...current, [item.key]: draft }));
    if (draft === '') {
      onUpdateSet(item.key, { weight_kg: null });
      return;
    }
    if (!draft.endsWith('.')) {
      onUpdateSet(item.key, { weight_kg: decimalNumberOrNull(draft) });
    }
  }

  function commitWeightDraft(item: DraftSet) {
    const draft = weightDrafts[item.key];
    if (draft === undefined) return;
    onUpdateSet(item.key, { weight_kg: decimalNumberOrNull(draft) });
    setWeightDrafts((current) => {
      const next = { ...current };
      delete next[item.key];
      return next;
    });
  }

  useFlipAnimation(setGridRef, movement.sets.map((item) => item.key).join('|'));
  useExpandAnimation(setGridRef);
  useCollapseAnimation(cardRef, expanded);

  return (
    <article
      ref={cardRef}
      className={`movement-card panel ${expanded ? '' : 'is-collapsed'} ${supersetLabel ? 'superset-card' : ''}`}
      data-flip-key={movement.key}
    >
      {supersetLabel && <div className="superset-ribbon">{supersetLabel}</div>}
      <header onClick={() => setExpanded((current) => !current)}>
        <ExerciseIcon exercise={movement.exercise} number={number} />
        <div>
          <h2>
            <button
              type="button"
              className="movement-history-link"
              onClick={(event) => {
                event.stopPropagation();
                onExerciseHistory();
              }}
              aria-label={`View full history for ${movement.exercise.name}`}
            >
              {movement.exercise.name}
            </button>
            <button
              type="button"
              className="movement-expand-toggle"
              aria-label={`${expanded ? 'Collapse' : 'Expand'} ${movement.exercise.name}`}
              aria-expanded={expanded}
              onClick={(event) => {
                event.stopPropagation();
                setExpanded((current) => !current);
              }}
            >
              <svg viewBox="0 0 20 20" aria-hidden="true">
                <path d="m4 7 6 6 6-6" />
              </svg>
            </button>
          </h2>
          <p>
            {[movement.exercise.muscle_group, movement.exercise.equipment]
              .filter(Boolean)
              .join(' · ')}
          </p>
          {lastSessionSummary && (
            <p className="movement-last-session">
              Last {shortDate(history[0].workoutDate)} · {lastSessionSummary}
            </p>
          )}
          {!expanded && (
            <span className="movement-completed-summary">
              {completedWorkingSetCount} completed working{' '}
              {completedWorkingSetCount === 1 ? 'set' : 'sets'}
            </span>
          )}
        </div>
        <div className="movement-header-actions" onClick={(event) => event.stopPropagation()}>
          <button
            type="button"
            className={`exercise-complete-button ${movement.isComplete ? 'active' : ''}`}
            aria-label={
              movement.isComplete
                ? `Mark ${movement.exercise.name} as not finished`
                : `Finish ${movement.exercise.name}`
            }
            aria-pressed={movement.isComplete}
            onClick={() => {
              const next = !movement.isComplete;
              onExerciseComplete(next);
              setExpanded(!next);
              closeMovementMenu();
            }}
          >
            ✓
          </button>
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
        </div>
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
                {entry.sets.length > 0 && <HistorySetFlow sets={entry.sets} personalRecords={[]} />}
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

      <div className={`set-grid set-grid-${cardio ? 'cardio' : 'strength'}`} ref={setGridRef}>
        <div className="set-grid-head">
          {cardio ? (
            <>
              <span>Set</span>
              <span>Min</span>
              <span>Km</span>
              <span>RPE</span>
              <span aria-hidden="true" />
              <span aria-hidden="true" />
            </>
          ) : (
            <>
              <span>Set</span>
              <span>Weight</span>
              <span>Reps</span>
              <span>RPE</span>
              <span aria-hidden="true" />
              <span aria-hidden="true" />
            </>
          )}
        </div>
        {movement.sets.map((item, index) => {
          const open = isSetOpen(item);
          return (
            <Fragment key={item.key}>
              <SwipeToDeleteSetRow
                flipKey={item.key}
                label={`set ${index + 1}`}
                disabled={movement.sets.length < 2}
                overlayOpen={openSetActionsKey === item.key || typeMenuSetKey === item.key}
                onDelete={() => onDeleteSet(index)}
              >
                <div
                  className={`set-details ${item.completed ? 'completed' : ''} ${item.fromPrevious ? 'previous-set-details' : ''} ${open ? 'is-open' : ''} ${draggingSetKey === item.key ? 'set-dragging' : ''} ${dragTargetSetKey === item.key && draggingSetKey !== item.key ? 'set-drop-target' : ''}`}
                  data-set-key={item.key}
                  data-expand-key={item.key}
                  data-expanded={open}
                >
                  {open ? renderSetEditor(item, index) : renderSetSummary(item, index)}
                </div>
              </SwipeToDeleteSetRow>
              {!cardio && (
                <div className="rest-between" data-flip-key={`${item.key}:rest`}>
                  <i />
                  <label>
                    <select
                      value={item.rest_seconds ?? DEFAULT_REST_SECONDS}
                      onChange={(event) =>
                        onUpdateSet(item.key, { rest_seconds: Number(event.target.value) })
                      }
                      aria-label={`Rest after set ${index + 1}`}
                    >
                      {restOptions.map((seconds) => (
                        <option key={seconds} value={seconds}>
                          {formatDuration(seconds)}
                        </option>
                      ))}
                    </select>
                    <span>rest</span>
                  </label>
                  <i />
                </div>
              )}
            </Fragment>
          );
        })}
      </div>
      {pendingSetCompletion && (
        <SetEntryConfirmationDialog
          warning={pendingSetCompletion.warning}
          confirmLabel="Add set"
          onCancel={() => setPendingSetCompletion(null)}
          onConfirm={() => {
            completeSet(pendingSetCompletion.item);
            setPendingSetCompletion(null);
          }}
        />
      )}
      <button type="button" className="add-set-button" onClick={onAddSet}>
        ＋ Add set
      </button>
      <input
        ref={movementNoteRef}
        className="movement-note"
        value={movement.notes}
        onChange={(event) => onMovementNotes(event.target.value)}
        placeholder="Exercise note for next time…"
      />
    </article>
  );
}

function SetEntryConfirmationDialog({
  warning,
  confirmLabel,
  onConfirm,
  onCancel,
}: {
  warning: SetEntryWarning;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const confirmButtonRef = useRef<HTMLButtonElement>(null);
  const onCancelRef = useRef(onCancel);
  onCancelRef.current = onCancel;

  useEffect(() => {
    window.requestAnimationFrame(() => confirmButtonRef.current?.focus());
    const cancelOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancelRef.current();
    };
    window.addEventListener('keydown', cancelOnEscape);
    return () => window.removeEventListener('keydown', cancelOnEscape);
  }, []);

  return createPortal(
    <div
      className="modal-backdrop set-entry-confirmation-backdrop"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <section
        className="set-entry-confirmation panel"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="set-entry-confirmation-title"
        aria-describedby="set-entry-confirmation-message"
      >
        <h3 id="set-entry-confirmation-title">{warning.title}</h3>
        <p id="set-entry-confirmation-message">{warning.message}</p>
        <footer>
          <button type="button" onClick={onCancel}>
            Go back
          </button>
          <button
            ref={confirmButtonRef}
            type="button"
            className="confirm-unusual-set"
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </footer>
      </section>
    </div>,
    document.body,
  );
}

function CardioSetScreenshotUpload({ onScan }: { onScan: (scan: CardioScreenshotScan) => void }) {
  const [scanning, setScanning] = useState(false);
  const [status, setStatus] = useState<{ message: string; warning: boolean } | null>(null);

  async function importScreenshot(file: File) {
    if (scanning) return;
    setScanning(true);
    setStatus(null);
    try {
      const scan = await api.scanCardioScreenshot(file);
      onScan(scan);
      setStatus({
        message: `Scanned ${scan.fields_found.join(', ')}.${scan.warning ? ` ${scan.warning}` : ''} Review the set before saving.`,
        warning: Boolean(scan.warning),
      });
    } catch (reason) {
      setStatus({
        message: reason instanceof Error ? reason.message : 'Could not scan that screenshot.',
        warning: true,
      });
    } finally {
      setScanning(false);
    }
  }

  return (
    <div className="cardio-set-screenshot-upload">
      <label className={scanning ? 'disabled' : ''}>
        {scanning ? 'Scanning…' : 'Upload screenshot'}
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
          disabled={scanning}
          aria-label="Upload cardio set screenshot"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (file) void importScreenshot(file);
          }}
        />
      </label>
      {status && (
        <small className={status.warning ? 'warning' : ''} role="status">
          {status.message}
        </small>
      )}
    </div>
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
      : 'Take or choose a photo';

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
          <strong>Equipment photo</strong>
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

function FuzzyHighlightedText({ value, query }: { value: string; query: string }) {
  const highlighted = new Set(fuzzyHighlightIndices(value, query));
  if (!highlighted.size) return value;

  return (
    <>
      {[...value].map((character, index) =>
        highlighted.has(index) ? (
          <b className="exercise-search-match" key={`${character}-${index}`}>
            {character}
          </b>
        ) : (
          <Fragment key={`${character}-${index}`}>{character}</Fragment>
        ),
      )}
    </>
  );
}

function ExercisePicker({
  exercises,
  excludedIds,
  recentExerciseIds,
  onFavoriteChange,
  onCreateExercise,
  singleSelect = false,
  onChoose,
  onCreateSuperset,
  onClose,
}: {
  exercises: Exercise[];
  excludedIds: string[];
  recentExerciseIds: string[];
  onFavoriteChange: (exerciseId: string, isFavorite: boolean) => Promise<void>;
  onCreateExercise: (input: ExerciseCreateInput) => Promise<Exercise>;
  singleSelect?: boolean;
  onChoose: (exercises: Exercise[]) => void;
  onCreateSuperset?: (exercises: Exercise[]) => void;
  onClose: () => void;
}) {
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<ExercisePickerFilter>('all');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [favoriteSavingIds, setFavoriteSavingIds] = useState<string[]>([]);
  const [createExerciseOpen, setCreateExerciseOpen] = useState(false);
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
  const query = search.trim();
  const available = exercises.filter((exercise) => !excludedIds.includes(exercise.id));
  const recent = recentExerciseIds
    .slice(0, 10)
    .map((id) => available.find((exercise) => exercise.id === id))
    .filter((exercise): exercise is Exercise => Boolean(exercise));
  const sections: Array<{ title: string; exercises: Exercise[] }> = [];

  if (query) {
    sections.push({
      title: 'Search results',
      exercises: rankExerciseSearchMatches(available, query, recentExerciseIds),
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
            <strong>
              <FuzzyHighlightedText value={exercise.name} query={query} />
            </strong>
            <small className="exercise-option-tags">
              <em>{exercise.muscle_group}</em>
              {exercise.equipment && <em>{exercise.equipment}</em>}
            </small>
          </span>
          {selected && <b className="exercise-option-selected">✓</b>}
        </button>
        <button
          type="button"
          className={`exercise-favorite-button ${exercise.is_favorite ? 'active' : ''}`}
          aria-label={`${exercise.is_favorite ? 'Remove' : 'Add'} ${exercise.name} ${exercise.is_favorite ? 'from' : 'to'} favorites`}
          aria-pressed={exercise.is_favorite}
          disabled={favoriteSavingIds.includes(exercise.id)}
          onClick={() => void toggleFavorite(exercise)}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path d="M6 3h12v18l-6-4-6 4V3Z" />
          </svg>
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
              [
                'push',
                'pull',
                'lower',
                'upper',
                'full_body',
                'cardio',
                'other',
              ] as WorkoutCategory[]
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
          <button
            type="button"
            className="create-exercise-trigger"
            aria-label="Create new exercise"
            aria-haspopup="dialog"
            onClick={() => setCreateExerciseOpen(true)}
          >
            +
          </button>
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
                ? 'Tap the bookmark beside an exercise to add a favorite.'
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
              onClick={() => onCreateSuperset?.(itemsInSelectionOrder(exercises, selectedIds))}
            >
              Create super set
            </button>
          )}
          <button
            className="add-selected-button"
            type="button"
            disabled={!selectedIds.length}
            onClick={() => onChoose(itemsInSelectionOrder(exercises, selectedIds))}
          >
            {singleSelect ? 'Switch exercise' : `Add selected exercises (${selectedIds.length})`}
          </button>
        </div>
      </section>
      {createExerciseOpen && (
        <CreateExerciseDialog
          exercises={exercises}
          categoryLabels={categoryNames}
          initialName={query}
          initialCategory={
            filter === 'all' || filter === 'favorites' || filter === 'recent' ? '' : filter
          }
          viewportHeight={viewport.height}
          viewportTop={viewport.top}
          onCreate={onCreateExercise}
          onCreated={(exercise) => {
            setCreateExerciseOpen(false);
            setPickerError(null);
            setFilter('all');
            setSearch(exercise.name);
            setSelectedIds((current) =>
              singleSelect ? [exercise.id] : [...new Set([...current, exercise.id])],
            );
          }}
          onClose={() => setCreateExerciseOpen(false)}
        />
      )}
    </div>,
    document.body,
  );
}

type LockableScreenOrientation = ScreenOrientation & {
  lock?: (orientation: 'landscape') => Promise<void>;
  unlock?: () => void;
};

/** Plot height for the full-screen viewer, which is rotated by CSS while the phone is upright. */
function expandedChartHeight(): number {
  const rotated = window.matchMedia('(orientation: portrait)').matches;
  return Math.max(200, (rotated ? window.innerWidth : window.innerHeight) - 96);
}

function LandscapeChartFrame({
  title,
  controls,
  children,
  onExpandedChange,
}: {
  title: string;
  controls: ReactNode;
  children: ReactNode;
  onExpandedChange?: (expanded: boolean) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const frameRef = useRef<HTMLDivElement>(null);

  async function enterLandscape() {
    setExpanded(true);
    try {
      if (frameRef.current?.requestFullscreen && !document.fullscreenElement) {
        await frameRef.current.requestFullscreen();
      }
    } catch {
      // The fixed landscape layout below is the fallback on browsers without fullscreen support.
    }
    try {
      await (screen.orientation as LockableScreenOrientation).lock?.('landscape');
    } catch {
      // Orientation locking is not supported on every mobile browser.
    }
  }

  async function exitLandscape() {
    try {
      (screen.orientation as LockableScreenOrientation).unlock?.();
    } catch {
      // The CSS layout can still close when orientation APIs are unavailable.
    }
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
    } catch {
      // Continue closing the fixed fallback if the browser has already left fullscreen.
    }
    setExpanded(false);
  }

  useEffect(() => {
    onExpandedChange?.(expanded);
  }, [expanded, onExpandedChange]);

  useEffect(() => {
    if (!expanded) return;
    document.body.classList.add('chart-fullscreen-open');
    const closeFallback = () => {
      try {
        (screen.orientation as LockableScreenOrientation).unlock?.();
      } catch {
        // Orientation locking is optional, so the visual fallback can still close.
      }
      setExpanded(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
      closeFallback();
    };
    const handleFullscreenChange = () => {
      if (!document.fullscreenElement) closeFallback();
    };
    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => {
      document.body.classList.remove('chart-fullscreen-open');
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
    };
  }, [expanded]);

  return (
    <div
      className={`landscape-chart-frame ${expanded ? 'landscape-chart-expanded' : ''}`}
      ref={frameRef}
    >
      <div className="landscape-chart-toolbar">
        <strong className="landscape-chart-title">{title}</strong>
        <div className="landscape-chart-options">{controls}</div>
        <button
          type="button"
          className="landscape-chart-toggle"
          aria-label={
            expanded ? `Exit full-screen ${title}` : `View ${title} full screen in landscape`
          }
          onClick={() => void (expanded ? exitLandscape() : enterLandscape())}
        >
          <span aria-hidden="true">
            <Icon name={expanded ? 'close' : 'expand'} />
          </span>
          {expanded ? 'Exit' : 'Landscape'}
        </button>
      </div>
      <div className="landscape-chart-content">{children}</div>
    </div>
  );
}

const PROGRESS_METRICS: Array<{ value: ProgressMetric; label: string; series: string }> = [
  { value: 'estimated_1rm', label: 'Est. 1RM', series: 'Est. 1RM' },
  { value: 'best_weight_kg', label: 'Top set', series: 'Top weight' },
  { value: 'volume_kg', label: 'Volume', series: 'Session volume' },
];

const RANGE_LABELS: Record<BodyTrendRange, string> = {
  '1m': '1M',
  '3m': '3M',
  '9m': '9M',
  '1y': '1Y',
  all: 'All',
};

function ProgressScreen({
  exercises,
  measurements,
  onOpenWorkout,
  embedded = false,
  initialExerciseId = null,
  defaultExerciseId = null,
}: {
  exercises: Exercise[];
  measurements: BodyMeasurement[];
  onOpenWorkout: (workoutId: string, exerciseId: string) => void;
  embedded?: boolean;
  initialExerciseId?: string | null;
  defaultExerciseId?: string | null;
}) {
  const strengthExercises = exercises.filter((exercise) => exercise.kind === 'strength');
  const [exerciseId, setExerciseId] = useState(() => {
    const preferred = [initialExerciseId, defaultExerciseId].find(
      (id) => id && strengthExercises.some((exercise) => exercise.id === id),
    );
    return preferred ?? strengthExercises[0]?.id ?? '';
  });
  const [metric, setMetric] = useState<ProgressMetric>('estimated_1rm');
  const [displayRange, setDisplayRange] = useState<BodyTrendRange>('3m');
  const [progress, setProgress] = useState<ExerciseProgress | null>(null);
  const [loading, setLoading] = useState(false);
  const [visibleSessions, setVisibleSessions] = useState(HISTORY_PAGE_SIZE);
  const [pickerRequest, setPickerRequest] = useState(0);
  const [chartExpanded, setChartExpanded] = useState(false);
  const metricIndicatorRef = useSlidingIndicator<HTMLDivElement>(metric);
  const rangeIndicatorRef = useSlidingIndicator<HTMLDivElement>(displayRange);
  const selectedExercise = strengthExercises.find((exercise) => exercise.id === exerciseId) ?? null;

  useEffect(() => {
    if (!exerciseId) return;
    let cancelled = false;
    setVisibleSessions(HISTORY_PAGE_SIZE);
    setLoading(true);
    void api
      .exerciseProgress(exerciseId)
      .then((nextProgress) => {
        if (!cancelled) setProgress(nextProgress);
      })
      .catch(() => {
        if (!cancelled) setProgress(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [exerciseId]);

  const metricInfo = PROGRESS_METRICS.find((item) => item.value === metric)!;
  const inRange = progress ? progressPointsForChart(progress.points, metric, displayRange) : [];
  const weekly = metric !== 'volume_kg' && displayRange !== '1m';
  const charted = weekly ? weeklyBestPoints(inRange, (point) => point[metric]) : inRange;
  const latestPoint = inRange.at(-1) ?? null;
  const firstPoint = inRange[0] ?? null;
  const change =
    latestPoint && firstPoint && latestPoint !== firstPoint
      ? latestPoint[metric] - firstPoint[metric]
      : null;
  const changePercent =
    change !== null && firstPoint && firstPoint[metric] > 0
      ? (change / firstPoint[metric]) * 100
      : null;
  const heaviestSetPoint = progress
    ? personalBestProgressPoint(progress.points, 'best_weight_kg')
    : null;
  const estimatedOneRepMaxPoint = progress
    ? personalBestProgressPoint(progress.points, 'estimated_1rm')
    : null;
  const volumePoint = progress ? personalBestProgressPoint(progress.points, 'volume_kg') : null;
  const bodyweight = measurements[0]?.weight_kg ?? null;
  const recordIds = useMemo(() => {
    const ids = new Set<string>();
    let best = 0;
    for (const point of progressPointsForChart(progress?.points ?? [], 'estimated_1rm', 'all')) {
      if (point.estimated_1rm > best) {
        best = point.estimated_1rm;
        ids.add(point.workout_id);
      }
    }
    return ids;
  }, [progress]);
  const sessionsNewestFirst = (progress?.points ?? []).slice().reverse();
  const formatMetric = (value: number) =>
    metric === 'volume_kg'
      ? Math.round(value).toLocaleString('en-GB')
      : Number(value.toFixed(1)).toLocaleString('en-GB');
  const chartPoints: TrendPoint[] = charted.map((point) => ({
    date: point.workout_date,
    value: point[metric],
    id: point.workout_id,
    detail: `${Number(point.best_weight_kg.toFixed(2))} kg × ${point.best_reps}${point.best_rpe === null ? '' : ` @ RPE ${point.best_rpe}`}`,
  }));

  return (
    <section className={`progress-screen ${embedded ? '' : 'content-page'}`}>
      <PageHeader
        eyebrow={
          selectedExercise
            ? [
                selectedExercise.muscle_group,
                selectedExercise.equipment,
                progress?.exercise.id === selectedExercise.id
                  ? `${progress.points.length} ${progress.points.length === 1 ? 'session' : 'sessions'}`
                  : null,
              ]
                .filter(Boolean)
                .join(' · ')
            : 'Exercise progress'
        }
        title={selectedExercise?.name ?? 'Progress'}
        actions={
          <button
            className="icon-button-pulse"
            type="button"
            aria-label="Select exercise"
            onClick={() => setPickerRequest((request) => request + 1)}
          >
            <Icon name="search" />
          </button>
        }
      />
      <section className="progress-controls">
        <ProgressExerciseSearch
          exercises={strengthExercises}
          exerciseId={exerciseId}
          onChange={setExerciseId}
          openRequest={pickerRequest}
        />
      </section>
      {!strengthExercises.length && (
        <EmptyState
          title="No exercises yet"
          body="Add a strength exercise to a workout to start tracking its progress."
        />
      )}
      {loading && !progress && <LoadingState />}
      {progress && (
        <div className={loading ? 'progress-refreshing' : ''}>
          <div
            ref={metricIndicatorRef}
            className="segmented-control slide-indicator"
            role="tablist"
            aria-label="Progress metric"
          >
            {PROGRESS_METRICS.map((item) => (
              <button
                type="button"
                role="tab"
                key={item.value}
                aria-selected={metric === item.value}
                className={metric === item.value ? 'active' : ''}
                onClick={() => setMetric(item.value)}
              >
                {item.label}
              </button>
            ))}
          </div>
          {progress.points.length ? (
            <>
              <div className="progress-hero">
                <strong className="progress-hero-value">
                  {latestPoint ? formatMetric(latestPoint[metric]) : '–'}
                  <small>kg</small>
                </strong>
                <p className="progress-hero-caption">
                  {latestPoint
                    ? `${metricInfo.series} · latest session ${shortDate(latestPoint.workout_date)}`
                    : 'No sessions in this range'}
                </p>
                {change !== null && firstPoint && (
                  <p className={`progress-delta ${change > 0 ? 'up' : change < 0 ? 'down' : ''}`}>
                    <Icon name={change >= 0 ? 'up' : 'down'} />
                    {change >= 0 ? '+' : '−'}
                    {formatMetric(Math.abs(change))} kg
                    {changePercent !== null &&
                      ` (${change >= 0 ? '+' : '−'}${Math.abs(changePercent).toFixed(1)}%)`}{' '}
                    since {dayMonth(firstPoint.workout_date)}
                  </p>
                )}
              </div>
              <div
                ref={rangeIndicatorRef}
                className="range-chips slide-indicator"
                role="tablist"
                aria-label="Exercise progress graph range"
              >
                {TIME_RANGE_OPTIONS.map((option) => (
                  <button
                    type="button"
                    role="tab"
                    key={option.value}
                    aria-selected={displayRange === option.value}
                    aria-label={option.label}
                    className={displayRange === option.value ? 'active' : ''}
                    onClick={() => setDisplayRange(option.value)}
                  >
                    {RANGE_LABELS[option.value]}
                  </button>
                ))}
              </div>
              <LandscapeChartFrame
                title={`${progress.exercise.name} · ${metricInfo.series}${weekly ? ' (best per week)' : ''}`}
                controls={null}
                onExpandedChange={setChartExpanded}
              >
                <TrendChart
                  points={chartPoints}
                  label={`${progress.exercise.name} ${metricInfo.series}${weekly ? ', best per week' : ''}`}
                  seriesLabel={
                    weekly
                      ? `Best ${metric === 'estimated_1rm' ? 'est. 1RM' : 'top weight'} that week`
                      : metricInfo.series
                  }
                  unit="kg"
                  height={chartExpanded ? expandedChartHeight() : 200}
                  markRecords={metric !== 'volume_kg'}
                  formatValue={formatMetric}
                  onSelect={(point) => point.id && onOpenWorkout(point.id, progress.exercise.id)}
                />
              </LandscapeChartFrame>
              <section className="stat-grid" aria-label="Personal bests">
                <div>
                  <span>Heaviest set</span>
                  <b className="num">
                    {heaviestSetPoint
                      ? `${Number(heaviestSetPoint.best_weight_kg.toFixed(2))} × ${heaviestSetPoint.best_reps}`
                      : '–'}
                  </b>
                  <small>
                    {heaviestSetPoint ? shortDate(heaviestSetPoint.workout_date) : 'No sets yet'}
                  </small>
                </div>
                <div>
                  <span>Best est. 1RM</span>
                  <b className="num">{formatKg(progress.personal_best_estimated_1rm)}</b>
                  <small>
                    {estimatedOneRepMaxPoint
                      ? shortDate(estimatedOneRepMaxPoint.workout_date)
                      : 'Epley'}
                  </small>
                </div>
                <div>
                  <span>Best session volume</span>
                  <b className="num">
                    {volumePoint
                      ? `${Math.round(volumePoint.volume_kg).toLocaleString('en-GB')} kg`
                      : '–'}
                  </b>
                  <small>
                    {volumePoint ? shortDate(volumePoint.workout_date) : 'Working sets'}
                  </small>
                </div>
                <div>
                  <span>Relative strength</span>
                  <b className="num">
                    {bodyweight && progress.personal_best_estimated_1rm
                      ? `${(progress.personal_best_estimated_1rm / bodyweight).toFixed(2)} × BW`
                      : '–'}
                  </b>
                  <small>
                    {bodyweight ? `Best e1RM at ${bodyweight} kg` : 'Log bodyweight to compare'}
                  </small>
                </div>
              </section>
              <section
                className="pulse-card progress-sessions"
                aria-label="Exercise session history"
              >
                <header className="pulse-card-header">
                  <h2>Sessions</h2>
                  <span>Best set · {metricInfo.label}</span>
                </header>
                <ul>
                  {sessionsNewestFirst.slice(0, visibleSessions).map((point) => (
                    <li key={point.workout_id}>
                      <button
                        type="button"
                        aria-label={`View ${progress.exercise.name} in workout from ${prettyDate(point.workout_date)}`}
                        onClick={() => onOpenWorkout(point.workout_id, progress.exercise.id)}
                      >
                        <span className="session-date">
                          {shortDate(point.workout_date)}
                          {recordIds.has(point.workout_id) && <em className="pr-chip">PR</em>}
                        </span>
                        <span className="session-set num">
                          {Number(point.best_weight_kg.toFixed(2))} × {point.best_reps}
                          {point.best_rpe !== null && <small> @{point.best_rpe}</small>}
                        </span>
                        <b className="num">{formatMetric(point[metric])}</b>
                        <Icon name="chevron-right" />
                      </button>
                    </li>
                  ))}
                </ul>
                {visibleSessions < sessionsNewestFirst.length && (
                  <button
                    type="button"
                    className="show-more-button"
                    onClick={() => setVisibleSessions((count) => count + HISTORY_PAGE_SIZE * 2)}
                  >
                    Show more · {sessionsNewestFirst.length - visibleSessions} older
                  </button>
                )}
              </section>
            </>
          ) : (
            <EmptyState
              title="No data yet"
              body="Complete this exercise in a workout to start its progress graph."
            />
          )}
        </div>
      )}
    </section>
  );
}

function ExportTimeFrame({
  label,
  value,
  dates,
  disabled,
  onChange,
}: {
  label: string;
  value: TimeRange;
  dates: string[];
  disabled: boolean;
  onChange: (range: TimeRange) => void;
}) {
  const range = dateRangeForDates(dates, value);
  return (
    <div className="export-time-frame">
      <label className="chart-option-field">
        <span>Export time frame</span>
        <select
          aria-label={label}
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value as TimeRange)}
        >
          {TIME_RANGE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <small>
        {range.start_date && range.end_date
          ? `${prettyDate(range.start_date)} – ${prettyDate(range.end_date)} · ends at your latest entry`
          : dates.length
            ? 'All saved entries'
            : 'No saved entries — exports an empty CSV template'}
      </small>
    </div>
  );
}

function SettingsScreen({
  workouts,
  measurements,
  workoutTypeColors,
  onWorkoutTypeColorsChange,
  restTimerEnabled,
  onRestTimerEnabledChange,
  reduceMotion,
  onReduceMotionChange,
  bodyTrendPreference,
  onBodyTrendPreferenceChange,
  onImportWorkouts,
  onExportWorkouts,
  onDeleteSamples,
  onDataChange,
  account,
  onOpenProfile,
  onOpenAdmin,
}: {
  account: User | null;
  onOpenProfile: () => void;
  /** Present only for administrators. */
  onOpenAdmin?: () => void;
  workouts: TrackedWorkout[];
  measurements: BodyMeasurement[];
  workoutTypeColors: WorkoutTypeColors;
  onWorkoutTypeColorsChange: (colors: WorkoutTypeColors) => void;
  restTimerEnabled: boolean;
  onRestTimerEnabledChange: (enabled: boolean) => void;
  reduceMotion: boolean;
  onReduceMotionChange: (reduced: boolean) => void;
  bodyTrendPreference: BodyTrendPreference;
  onBodyTrendPreferenceChange: (preference: BodyTrendPreference) => void;
  onImportWorkouts: (file: File) => Promise<void>;
  onExportWorkouts: (range: DateRange) => Promise<void>;
  onDeleteSamples: () => Promise<void>;
  onDataChange: () => Promise<void>;
}) {
  const workoutCsvInput = useRef<HTMLInputElement>(null);
  const bodyCsvInput = useRef<HTMLInputElement>(null);
  const [importingWorkouts, setImportingWorkouts] = useState(false);
  const [exportingWorkouts, setExportingWorkouts] = useState(false);
  const [workoutExportRange, setWorkoutExportRange] = useState<TimeRange>('all');
  const [bodyExportRange, setBodyExportRange] = useState<TimeRange>('all');
  const [importingBodyCsv, setImportingBodyCsv] = useState(false);
  const [exportingBodyCsv, setExportingBodyCsv] = useState(false);
  const [bodyCsvMessage, setBodyCsvMessage] = useState<string | null>(null);
  const [bodyCsvError, setBodyCsvError] = useState<string | null>(null);
  const [notificationStatus, setNotificationStatus] = useState<RestAlertStatus>(() =>
    pushNotificationsSupported() ? 'checking' : 'unsupported',
  );
  const [notificationMessage, setNotificationMessage] = useState<string | null>(null);
  const [notificationError, setNotificationError] = useState<string | null>(null);
  const [trainingPreferences, setTrainingPreferences] = useState<TrainingPreferences | null>(null);
  const [trainingPreferencesStatus, setTrainingPreferencesStatus] = useState<string | null>(null);
  const [trainingPreferencesError, setTrainingPreferencesError] = useState<string | null>(null);
  const [savingTrainingPreferences, setSavingTrainingPreferences] = useState(false);
  const [colorDraft, setColorDraft] = useState<WorkoutTypeColors>(workoutTypeColors);
  const [colorsDirty, setColorsDirty] = useState(false);
  const [savingColors, setSavingColors] = useState(false);
  const [colorsStatus, setColorsStatus] = useState<string | null>(null);
  const [colorsError, setColorsError] = useState<string | null>(null);

  useEffect(() => {
    if (!colorsDirty) setColorDraft(workoutTypeColors);
  }, [colorsDirty, workoutTypeColors]);

  useEffect(() => {
    void api
      .getTrainingPreferences()
      .then(setTrainingPreferences)
      .catch((reason) =>
        setTrainingPreferencesError(
          reason instanceof Error ? reason.message : 'Could not load training preferences.',
        ),
      );
  }, []);

  useEffect(() => {
    if (!pushNotificationsSupported()) return;
    let active = true;
    const syncPushState = () => {
      void existingPhonePushSubscription()
        .then((subscription) => {
          if (!active) return;
          setNotificationStatus(
            subscription
              ? 'enabled'
              : Notification.permission === 'denied'
                ? 'blocked'
                : 'available',
          );
        })
        .catch(() => {
          if (active) setNotificationStatus('available');
        });
    };
    syncPushState();
    window.addEventListener(PHONE_PUSH_PREFERENCE_EVENT, syncPushState);
    return () => {
      active = false;
      window.removeEventListener(PHONE_PUSH_PREFERENCE_EVENT, syncPushState);
    };
  }, []);

  async function togglePhoneNotifications() {
    if (notificationStatus === 'checking' || notificationStatus === 'enabling') return;
    setNotificationMessage(null);
    setNotificationError(null);
    if (notificationStatus === 'enabled') {
      setNotificationStatus('enabling');
      await disablePhonePushNotifications();
      setNotificationStatus('available');
      setNotificationMessage('Phone notifications are off.');
      return;
    }

    setNotificationStatus('enabling');
    try {
      await enablePhonePushNotifications();
      setNotificationStatus('enabled');
      setNotificationMessage('Phone notifications are on.');
    } catch (reason) {
      setNotificationStatus(Notification.permission === 'denied' ? 'blocked' : 'available');
      setNotificationError(
        reason instanceof Error ? reason.message : 'Could not enable phone notifications.',
      );
    }
  }

  async function saveTrainingPreferences() {
    if (!trainingPreferences || savingTrainingPreferences) return;
    setSavingTrainingPreferences(true);
    setTrainingPreferencesStatus(null);
    setTrainingPreferencesError(null);
    try {
      const saved = await api.updateTrainingPreferences(trainingPreferences);
      setTrainingPreferences(saved);
      await onDataChange();
      window.dispatchEvent(new Event('training-preferences-updated'));
      setTrainingPreferencesStatus('Training preferences saved.');
    } catch (reason) {
      setTrainingPreferencesError(
        reason instanceof Error ? reason.message : 'Could not save training preferences.',
      );
    } finally {
      setSavingTrainingPreferences(false);
    }
  }

  async function saveWorkoutTypeColors() {
    if (savingColors || !colorsDirty) return;
    setSavingColors(true);
    setColorsStatus(null);
    setColorsError(null);
    try {
      const saved = await api.updateWorkoutTypeColors(colorDraft);
      onWorkoutTypeColorsChange(saved);
      setColorsDirty(false);
      setColorsStatus('Workout type colours saved.');
    } catch (reason) {
      setColorsError(
        reason instanceof Error ? reason.message : 'Could not save workout type colours.',
      );
    } finally {
      setSavingColors(false);
    }
  }

  async function exportWorkouts() {
    if (exportingWorkouts) return;
    setExportingWorkouts(true);
    try {
      await onExportWorkouts(
        dateRangeForDates(
          workouts.map((workout) => workout.workout_date),
          workoutExportRange,
        ),
      );
    } finally {
      setExportingWorkouts(false);
    }
  }

  async function exportBodyCsv() {
    if (exportingBodyCsv) return;
    setExportingBodyCsv(true);
    setBodyCsvError(null);
    setBodyCsvMessage(null);
    try {
      const range = dateRangeForDates(
        measurements.map((measurement) => measurement.measurement_date),
        bodyExportRange,
      );
      const count = filterMeasurementsByRange(measurements, bodyExportRange).length;
      const blob = await api.exportBodyMeasurements(range);
      const href = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = href;
      link.download = `body-weight-${range.start_date ? `${range.start_date}-to-${range.end_date}` : localDate()}.csv`;
      document.body.append(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(href);
      setBodyCsvMessage(
        count
          ? `Exported ${count} body-weight ${count === 1 ? 'entry' : 'entries'}.`
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
    <section className="settings-screen content-page">
      {account && (
        <section className="settings-panel panel" aria-labelledby="account-settings-title">
          <header>
            <div>
              <p className="section-kicker">ACCOUNT</p>
              <h2 id="account-settings-title">{account.display_name}</h2>
            </div>
          </header>
          <p>{account.email}</p>
          <button type="button" className="profile-secondary" onClick={onOpenProfile}>
            Manage profile
          </button>
        </section>
      )}
      {onOpenAdmin && (
        <section className="settings-panel panel" aria-labelledby="admin-settings-title">
          <header>
            <div>
              <p className="section-kicker">ADMIN</p>
              <h2 id="admin-settings-title">Admin console</h2>
            </div>
          </header>
          <p>Manage accounts, turn video uploads and sign-ups on or off, and check the server.</p>
          <button type="button" className="profile-secondary" onClick={onOpenAdmin}>
            Open admin console
          </button>
        </section>
      )}
      <section className="settings-panel panel" aria-labelledby="notification-settings-title">
        <header>
          <div>
            <p className="section-kicker">ALERTS</p>
            <h2 id="notification-settings-title">Timers &amp; notifications</h2>
          </div>
        </header>
        <p>Control workout timers and alerts from the installed PWA.</p>
        <div className="notification-setting-row">
          <div>
            <strong>Rest timer</strong>
            <small>
              {restTimerEnabled
                ? 'Starts automatically after a completed set'
                : 'Automatic rest countdowns are disabled'}
            </small>
          </div>
          <button
            type="button"
            role="switch"
            aria-label="Rest timer"
            aria-checked={restTimerEnabled}
            className={restTimerEnabled ? 'is-on' : ''}
            onClick={() => onRestTimerEnabledChange(!restTimerEnabled)}
          >
            <span />
            {restTimerEnabled ? 'On' : 'Off'}
          </button>
        </div>
        <div className="notification-setting-row">
          <div>
            <strong>Phone alerts</strong>
            <small>
              {notificationStatus === 'enabled'
                ? 'Rest timers, 2-hour workout reminders, and completed-video alerts are enabled'
                : notificationStatus === 'unsupported'
                  ? 'Install the PWA to enable notifications'
                  : notificationStatus === 'blocked'
                    ? 'Blocked in phone settings'
                    : 'Rest timers, 2-hour workout reminders, and completed-video alerts are disabled'}
            </small>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={notificationStatus === 'enabled'}
            className={notificationStatus === 'enabled' ? 'is-on' : ''}
            disabled={
              notificationStatus === 'checking' ||
              notificationStatus === 'enabling' ||
              notificationStatus === 'unsupported'
            }
            onClick={() => void togglePhoneNotifications()}
          >
            <span />
            {notificationStatus === 'enabled' ? 'On' : 'Off'}
          </button>
        </div>
        {notificationMessage && (
          <p className="notification-setting-status" role="status">
            {notificationMessage}
          </p>
        )}
        {notificationError && (
          <p className="inline-error" role="alert">
            {notificationError}
          </p>
        )}
      </section>

      <section className="settings-panel panel" aria-labelledby="training-preferences-title">
        <header>
          <div>
            <p className="section-kicker">TRAINING</p>
            <h2 id="training-preferences-title">Training preferences</h2>
          </div>
        </header>
        <p>Choose the units and weekly schedule used throughout the app.</p>
        {trainingPreferences && (
          <div className="training-preferences-grid">
            <label>
              Weight unit
              <select
                value={trainingPreferences.preferred_weight_unit}
                onChange={(event) => {
                  setTrainingPreferences({
                    ...trainingPreferences,
                    preferred_weight_unit: event.target.value as 'kg' | 'lb',
                  });
                  setTrainingPreferencesStatus(null);
                }}
              >
                <option value="kg">Kilograms</option>
                <option value="lb">Pounds</option>
              </select>
            </label>
            <label>
              Week starts
              <select
                value={trainingPreferences.week_start}
                onChange={(event) => {
                  setTrainingPreferences({
                    ...trainingPreferences,
                    week_start: event.target.value as 'monday' | 'sunday' | 'saturday',
                  });
                  setTrainingPreferencesStatus(null);
                }}
              >
                <option value="monday">Monday</option>
                <option value="sunday">Sunday</option>
                <option value="saturday">Saturday</option>
              </select>
            </label>
            <button
              type="button"
              disabled={savingTrainingPreferences}
              onClick={() => void saveTrainingPreferences()}
            >
              {savingTrainingPreferences ? 'Saving…' : 'Save preferences'}
            </button>
          </div>
        )}
        {trainingPreferencesStatus && (
          <p className="training-preference-status" role="status">
            {trainingPreferencesStatus}
          </p>
        )}
        {trainingPreferencesError && (
          <p className="inline-error" role="alert">
            {trainingPreferencesError}
          </p>
        )}
      </section>

      <section className="settings-panel panel" aria-labelledby="motion-settings-title">
        <header>
          <div>
            <p className="section-kicker">MOTION</p>
            <h2 id="motion-settings-title">Animations</h2>
          </div>
        </header>
        <div className="notification-setting-row">
          <div>
            <strong>Reduce animations</strong>
            <small>
              {reduceMotion
                ? 'Screens, sheets and charts change without sliding or fading'
                : systemPrefersReducedMotion()
                  ? 'Your phone already asks for reduced motion, so the app follows it'
                  : 'Screens slide, sheets glide and charts draw in'}
            </small>
          </div>
          <button
            type="button"
            role="switch"
            aria-label="Reduce animations"
            aria-checked={reduceMotion}
            className={reduceMotion ? 'is-on' : ''}
            onClick={() => onReduceMotionChange(!reduceMotion)}
          >
            <span />
            {reduceMotion ? 'On' : 'Off'}
          </button>
        </div>
      </section>

      <section className="settings-panel panel" aria-labelledby="workout-type-colors-title">
        <header>
          <div>
            <p className="section-kicker">APPEARANCE</p>
            <h2 id="workout-type-colors-title">Workout type colours</h2>
          </div>
        </header>
        <p>Choose the colours shown in the workout calendar and history.</p>
        <div className="workout-type-color-grid">
          {(Object.entries(categoryNames) as [WorkoutCategory, string][]).map(
            ([category, label]) => (
              <label className="workout-type-color-row" key={category}>
                <span>{label}</span>
                <input
                  type="color"
                  aria-label={`${label} workout colour`}
                  value={colorDraft[category]}
                  disabled={savingColors}
                  onChange={(event) => {
                    setColorDraft((current) => ({ ...current, [category]: event.target.value }));
                    setColorsDirty(true);
                    setColorsStatus(null);
                    setColorsError(null);
                  }}
                />
                <code>{colorDraft[category].toUpperCase()}</code>
              </label>
            ),
          )}
        </div>
        <div className="workout-type-color-actions">
          <button
            type="button"
            className="color-reset-button"
            disabled={savingColors}
            onClick={() => {
              setColorDraft(defaultCategoryColors);
              setColorsDirty(true);
              setColorsStatus(null);
              setColorsError(null);
            }}
          >
            Reset defaults
          </button>
          <button
            type="button"
            disabled={savingColors || !colorsDirty}
            onClick={() => void saveWorkoutTypeColors()}
          >
            {savingColors ? 'Saving…' : 'Save colours'}
          </button>
        </div>
        {colorsStatus && (
          <p className="training-preference-status" role="status">
            {colorsStatus}
          </p>
        )}
        {colorsError && (
          <p className="inline-error" role="alert">
            {colorsError}
          </p>
        )}
      </section>

      <section className="settings-panel panel" aria-labelledby="bodyweight-trend-title">
        <header>
          <div>
            <p className="section-kicker">BODYWEIGHT</p>
            <h2 id="bodyweight-trend-title">Trend defaults</h2>
          </div>
        </header>
        <p>Choose the bodyweight trend shown when you open Measurements.</p>
        <div className="body-trend-default-fields">
          <label>
            Default statistic
            <select
              aria-label="Default bodyweight trend statistic"
              value={bodyTrendPreference.statistic}
              onChange={(event) =>
                onBodyTrendPreferenceChange({
                  ...bodyTrendPreference,
                  statistic: event.target.value as BodyTrendStatistic,
                })
              }
            >
              <option value="average">Average</option>
              <option value="median">Median</option>
            </select>
          </label>
          <label>
            Default duration
            <select
              aria-label="Default bodyweight trend duration"
              value={bodyTrendPreference.duration}
              onChange={(event) =>
                onBodyTrendPreferenceChange({
                  ...bodyTrendPreference,
                  duration: event.target.value as BodyTrendDuration,
                })
              }
            >
              {BODY_TREND_DURATION_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      </section>

      <section className="settings-panel panel" aria-labelledby="workout-data-title">
        <header>
          <div>
            <p className="section-kicker">WORKOUTS</p>
            <h2 id="workout-data-title">Workout data</h2>
          </div>
        </header>
        <p>
          Import a workout CSV or export your chosen time frame. All time creates a full backup.
        </p>
        <ExportTimeFrame
          label="Workout export time frame"
          value={workoutExportRange}
          dates={workouts.map((workout) => workout.workout_date)}
          disabled={exportingWorkouts}
          onChange={setWorkoutExportRange}
        />
        <input
          ref={workoutCsvInput}
          className="sr-only"
          type="file"
          accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (!file) return;
            setImportingWorkouts(true);
            void onImportWorkouts(file).finally(() => {
              setImportingWorkouts(false);
              event.target.value = '';
            });
          }}
        />
        <div className="settings-actions">
          <button
            type="button"
            disabled={importingWorkouts}
            onClick={() => workoutCsvInput.current?.click()}
          >
            {importingWorkouts ? 'Importing…' : '↑ Import workout CSV'}
          </button>
          <button type="button" disabled={exportingWorkouts} onClick={() => void exportWorkouts()}>
            {exportingWorkouts ? 'Exporting…' : '↓ Export workout CSV'}
          </button>
          {workouts.some((workout) => workout.is_sample) && (
            <InlineConfirmButton
              className="sample-clear"
              label="Remove sample workouts"
              confirmLabel="Confirm removal"
              onConfirm={onDeleteSamples}
            />
          )}
        </div>
      </section>

      <section className="settings-panel panel" aria-labelledby="bodyweight-data-title">
        <header>
          <div>
            <p className="section-kicker">BODYWEIGHT</p>
            <h2 id="bodyweight-data-title">Bodyweight data</h2>
          </div>
        </header>
        <p>Date and Weight (kg) are required; Body Fat (%) and Notes are optional.</p>
        <ExportTimeFrame
          label="Bodyweight export time frame"
          value={bodyExportRange}
          dates={measurements.map((measurement) => measurement.measurement_date)}
          disabled={exportingBodyCsv}
          onChange={setBodyExportRange}
        />
        <input
          ref={bodyCsvInput}
          className="sr-only"
          type="file"
          accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values"
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = '';
            if (file) void importBodyCsv(file);
          }}
        />
        <div className="settings-actions">
          <button
            type="button"
            disabled={importingBodyCsv}
            onClick={() => bodyCsvInput.current?.click()}
          >
            {importingBodyCsv ? 'Importing…' : '↑ Import bodyweight CSV'}
          </button>
          <button type="button" disabled={exportingBodyCsv} onClick={() => void exportBodyCsv()}>
            {exportingBodyCsv ? 'Exporting…' : '↓ Export bodyweight CSV'}
          </button>
        </div>
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
      </section>
    </section>
  );
}

export function BodyCompositionScreen({
  measurements,
  onSave,
  onDelete,
  onDataChange,
  entryRequest = 0,
  trendPreference = DEFAULT_BODY_TREND_PREFERENCE,
}: {
  measurements: BodyMeasurement[];
  onSave: (payload: {
    measurement_date: string;
    weight_kg: number;
    body_fat_pct: number | null;
    notes: string | null;
  }) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onDataChange: () => Promise<void>;
  entryRequest?: number;
  trendPreference?: BodyTrendPreference;
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
  const [goalTarget, setGoalTarget] = useState('');
  const [goalDate, setGoalDate] = useState('');
  const [savingGoal, setSavingGoal] = useState(false);
  const [editingMeasurement, setEditingMeasurement] = useState<BodyMeasurement | null>(null);
  const [editWeight, setEditWeight] = useState('');
  const [editBodyFat, setEditBodyFat] = useState('');
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [checkInPage, setCheckInPage] = useState(1);
  const [historyView, setHistoryView] = useState<'daily' | BodyHistoryPeriod>('daily');
  const historyViewIndicatorRef = useSlidingIndicator<HTMLDivElement>(historyView);
  const [trendDuration, setTrendDuration] = useState<BodyTrendDuration>(trendPreference.duration);
  const [trendStatistic, setTrendStatistic] = useState<BodyTrendStatistic>(
    trendPreference.statistic,
  );
  const historySummaries =
    historyView === 'daily' ? [] : summarizeBodyHistory(measurements, historyView, trendStatistic);
  const historyCount = historyView === 'daily' ? measurements.length : historySummaries.length;
  const checkInPageCount = Math.max(1, Math.ceil(historyCount / HISTORY_PAGE_SIZE));
  const pagedMeasurements = measurements.slice(
    (checkInPage - 1) * HISTORY_PAGE_SIZE,
    checkInPage * HISTORY_PAGE_SIZE,
  );
  const pagedSummaries = historySummaries.slice(
    (checkInPage - 1) * HISTORY_PAGE_SIZE,
    checkInPage * HISTORY_PAGE_SIZE,
  );
  const latest = measurements[0];
  const activeGoal = goals.find((goal) => goal.active) ?? null;
  const targetWeight = Number(goalTarget);
  const hasValidTarget =
    goalTarget.trim() !== '' && Number.isFinite(targetWeight) && targetWeight > 0;
  const trendSummary = summarizeBodyWeightTrend(measurements, trendDuration);
  const trendValue = trendSummary[trendStatistic];

  useEffect(() => {
    setCheckInPage((page) => Math.min(page, checkInPageCount));
  }, [checkInPageCount]);

  useEffect(() => {
    if (entryRequest === 0) return;
    setEntryOpen(true);
    setGoalOpen(false);
  }, [entryRequest]);

  useEffect(() => {
    setTrendDuration(trendPreference.duration);
    setTrendStatistic(trendPreference.statistic);
  }, [trendPreference]);
  useEffect(() => {
    void api
      .listBodyWeightGoals()
      .then(setGoals)
      .catch((reason) =>
        setError(reason instanceof Error ? reason.message : 'Could not load body-weight goals.'),
      );
  }, []);

  async function saveGoal() {
    if (!latest || !hasValidTarget || !goalDate) {
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
        active: true,
      });
      setGoals((current) => [goal, ...current.map((item) => ({ ...item, active: false }))]);
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
        notes:
          editingMeasurement.notes === IMPORTED_BODYWEIGHT_NOTE ? null : editingMeasurement.notes,
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

  return (
    <section className="body-screen content-page">
      <PageHeader
        eyebrow={`${measurements.length} ${measurements.length === 1 ? 'check-in' : 'check-ins'}${latest ? ` · latest ${shortDate(latest.measurement_date)}` : ''}`}
        title="Body"
        actions={
          <button
            className="icon-button-pulse accent"
            type="button"
            aria-label="Add bodyweight"
            onClick={() => {
              setError(null);
              setEntryOpen(true);
              setGoalOpen(false);
            }}
          >
            <Icon name="plus" />
          </button>
        }
      />
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
        <div className="body-trend-stat">
          <div className="body-trend-stat-controls">
            <label>
              <span className="sr-only">Bodyweight trend statistic</span>
              <select
                aria-label="Bodyweight trend statistic"
                value={trendStatistic}
                onChange={(event) => setTrendStatistic(event.target.value as BodyTrendStatistic)}
              >
                <option value="average">Average</option>
                <option value="median">Median</option>
              </select>
            </label>
            <label>
              <span className="sr-only">Bodyweight trend duration</span>
              <select
                aria-label="Bodyweight trend duration"
                value={trendDuration}
                onChange={(event) => setTrendDuration(event.target.value as BodyTrendDuration)}
              >
                {BODY_TREND_DURATION_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <strong>{trendValue === null ? '–' : `${trendValue.toFixed(1)} kg`}</strong>
          <small>
            {trendSummary.count} {trendSummary.count === 1 ? 'check-in' : 'check-ins'}
          </small>
        </div>
      </div>

      {measurements.length > 1 && (
        <section className="pulse-card body-trend-panel">
          <header className="pulse-card-header">
            <h2>Trend</h2>
            <span>Tap or drag the chart to read a check-in</span>
          </header>
          <BodyTrendChart measurements={measurements} goals={goals} />
        </section>
      )}

      <div className="body-reference-actions">
        <button
          className={entryOpen ? 'active' : ''}
          type="button"
          onClick={() => {
            setError(null);
            setEntryOpen(true);
            setGoalOpen(false);
          }}
        >
          Log weigh-in
        </button>
        <button
          className={goalOpen ? 'active' : ''}
          type="button"
          onClick={() => {
            setError(null);
            setGoalOpen(true);
            setEntryOpen(false);
          }}
        >
          {activeGoal ? 'New goal' : 'Set a goal'}
        </button>
      </div>

      {goalOpen && (
        <PopupDialog
          title="Add bodyweight goal"
          kicker="GOAL"
          className="body-goal-popup"
          onClose={() => setGoalOpen(false)}
        >
          <form
            className="body-goal-form"
            onSubmit={(event) => {
              event.preventDefault();
              void saveGoal();
            }}
          >
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
            <div className="goal-entry-fields">
              <label>
                Target kg
                <input
                  type="number"
                  min="1"
                  max="500"
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
            </div>
            {error && <p className="inline-error">{error}</p>}
            <footer className="popup-dialog-actions">
              <button type="button" disabled={savingGoal} onClick={() => setGoalOpen(false)}>
                Cancel
              </button>
              <button type="submit" className="popup-primary-action" disabled={savingGoal}>
                {savingGoal ? 'Saving…' : 'Set goal'}
              </button>
            </footer>
          </form>
        </PopupDialog>
      )}

      {entryOpen && (
        <PopupDialog
          title="Log measurement"
          kicker="CHECK-IN"
          className="body-entry-popup"
          onClose={() => setEntryOpen(false)}
        >
          <form
            className="body-entry-form"
            onSubmit={(event) => {
              event.preventDefault();
              void submitMeasurement();
            }}
          >
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
                  autoFocus
                  inputMode="decimal"
                  type="number"
                  min="1"
                  max="500"
                  step="0.1"
                  value={weight}
                  onChange={(event) => setWeight(event.target.value)}
                  placeholder={bodyweightEntryPlaceholder(measurements)}
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
              placeholder="Conditions or anything worth remembering…"
              rows={2}
            />
            {error && <p className="inline-error">{error}</p>}
            <footer className="popup-dialog-actions">
              <button type="button" disabled={saving} onClick={() => setEntryOpen(false)}>
                Cancel
              </button>
              <button type="submit" className="popup-primary-action" disabled={saving}>
                {saving ? 'Saving…' : 'Save check-in'}
              </button>
            </footer>
          </form>
        </PopupDialog>
      )}

      <div
        ref={historyViewIndicatorRef}
        className="body-log-tabs slide-indicator"
        role="tablist"
        aria-label="Bodyweight records"
      >
        {(
          [
            ['daily', 'Daily'],
            ['week', `${trendStatistic === 'average' ? 'Avg' : 'Median'} Week`],
            ['month', `${trendStatistic === 'average' ? 'Avg' : 'Median'} Monthly`],
          ] as const
        ).map(([view, label]) => (
          <button
            key={view}
            className={historyView === view ? 'active' : ''}
            type="button"
            role="tab"
            aria-selected={historyView === view}
            onClick={() => {
              setHistoryView(view);
              setCheckInPage(1);
              setEditingMeasurement(null);
            }}
          >
            {label}
          </button>
        ))}
      </div>

      <section className="panel body-history-panel" role="tabpanel">
        <div className="panel-heading">
          <div>
            <p className="section-kicker">HISTORY</p>
            <h2>Check-ins</h2>
          </div>
        </div>
        {!historyCount && <p className="body-empty">Your first check-in will appear here.</p>}
        {historyCount > 0 && (
          <div
            className={`body-history-table-head${historyView === 'daily' ? '' : ' body-history-summary-grid'}`}
            aria-hidden="true"
          >
            <span>
              {historyView === 'daily' ? 'Date' : historyView === 'week' ? 'Week' : 'Month'}
            </span>
            <span>Bodyweight</span>
            <span>Body Fat</span>
            {historyView === 'daily' && <span />}
          </div>
        )}
        {historyView === 'daily' &&
          pagedMeasurements.map((measurement) => (
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
        {historyView !== 'daily' &&
          pagedSummaries.map((summary) => (
            <article className="body-history-summary-grid" key={summary.start_date}>
              <div className="body-history-date">
                <strong>
                  {historyView === 'week'
                    ? `${new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' }).format(new Date(`${summary.start_date}T12:00:00`))} – ${new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' }).format(new Date(`${summary.end_date}T12:00:00`))}`
                    : new Intl.DateTimeFormat(undefined, { month: 'long' }).format(
                        new Date(`${summary.start_date}T12:00:00`),
                      )}
                </strong>
                <small>
                  {summary.start_date.slice(0, 4)}
                  {summary.start_date.slice(0, 4) !== summary.end_date.slice(0, 4)
                    ? `–${summary.end_date.slice(0, 4)}`
                    : ''}
                </small>
              </div>
              <div className="body-history-weight">
                <strong>{summary.weight_kg.toFixed(1)} kg</strong>
                <small>
                  {summary.count} {summary.count === 1 ? 'check-in' : 'check-ins'}
                </small>
              </div>
              <div className="body-history-fat">
                <strong>
                  {summary.body_fat_pct === null ? '–' : `${summary.body_fat_pct.toFixed(1)}%`}
                </strong>
              </div>
            </article>
          ))}
        <PaginationControls
          currentPage={checkInPage}
          totalPages={checkInPageCount}
          onPageChange={setCheckInPage}
          label={`${historyView} bodyweight history`}
        />
      </section>
    </section>
  );
}

function BodyTrendChart({
  measurements,
  goals,
}: {
  measurements: BodyMeasurement[];
  goals: BodyWeightGoal[];
}) {
  const [displayRange, setDisplayRange] = useState<BodyTrendRange>('3m');
  // Weight and body fat use different units, so they are separate views rather than two y-axes.
  const [series, setSeries] = useState<'weight' | 'fat'>('weight');
  const [chartExpanded, setChartExpanded] = useState(false);
  const ordered = filterMeasurementsByRange(measurements, displayRange).slice().reverse();
  const hasBodyFat = measurements.some((item) => item.body_fat_pct !== null);
  const selectedDateRange = dateRangeForDates(
    measurements.map((item) => item.measurement_date),
    displayRange,
  );
  const activeGoal = goals.find((goal) => goal.active) ?? null;
  const clippedGoal = activeGoal
    ? clipBodyWeightGoalPath(activeGoal, selectedDateRange.start_date, selectedDateRange.end_date)
    : null;
  const weekMs = 7 * 86_400_000;
  const averagePoints = useMemo<TrendPoint[]>(
    () =>
      ordered.map((item) => {
        const end = new Date(`${item.measurement_date}T12:00:00`).getTime();
        const window = measurements.filter((candidate) => {
          const time = new Date(`${candidate.measurement_date}T12:00:00`).getTime();
          return time <= end && time > end - weekMs;
        });
        const average =
          window.reduce((total, candidate) => total + candidate.weight_kg, 0) / window.length;
        return {
          date: item.measurement_date,
          value: Number(average.toFixed(2)),
          detail: `weighed ${item.weight_kg} kg`,
        };
      }),
    // ordered is derived from measurements and the range.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [measurements, displayRange],
  );
  const dailyPoints = useMemo<TrendPoint[]>(
    () => ordered.map((item) => ({ date: item.measurement_date, value: item.weight_kg })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [measurements, displayRange],
  );
  const fatPoints = useMemo<TrendPoint[]>(
    () =>
      ordered
        .filter((item) => item.body_fat_pct !== null)
        .map((item) => ({ date: item.measurement_date, value: item.body_fat_pct! })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [measurements, displayRange],
  );
  const goalPath = useMemo<GoalPath | null>(
    () =>
      clippedGoal && series === 'weight'
        ? {
            startDate: clippedGoal.start_date,
            startValue: clippedGoal.start_weight_kg,
            endDate: clippedGoal.target_date,
            endValue: clippedGoal.target_weight_kg,
            label: `Goal ${activeGoal!.target_weight_kg} kg`,
          }
        : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      clippedGoal?.start_date,
      clippedGoal?.target_date,
      clippedGoal?.start_weight_kg,
      clippedGoal?.target_weight_kg,
      series,
    ],
  );
  const showFat = series === 'fat' && hasBodyFat;
  const bodyRangeIndicatorRef = useSlidingIndicator<HTMLDivElement>(displayRange);
  const bodySeriesIndicatorRef = useSlidingIndicator<HTMLDivElement>(showFat);
  const chartHeight = chartExpanded ? expandedChartHeight() : 200;

  return (
    <div className="body-trend-chart">
      <div className="body-trend-chart-controls">
        <div
          ref={bodyRangeIndicatorRef}
          className="range-chips slide-indicator"
          role="tablist"
          aria-label="Body composition range"
        >
          {TIME_RANGE_OPTIONS.map((option) => (
            <button
              type="button"
              role="tab"
              key={option.value}
              aria-selected={displayRange === option.value}
              aria-label={option.label}
              className={displayRange === option.value ? 'active' : ''}
              onClick={() => setDisplayRange(option.value)}
            >
              {RANGE_LABELS[option.value]}
            </button>
          ))}
        </div>
        {hasBodyFat && (
          <div
            ref={bodySeriesIndicatorRef}
            className="segmented-control compact slide-indicator"
            role="tablist"
            aria-label="Body measure"
          >
            <button
              type="button"
              role="tab"
              aria-selected={!showFat}
              className={!showFat ? 'active' : ''}
              onClick={() => setSeries('weight')}
            >
              Weight
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={showFat}
              className={showFat ? 'active' : ''}
              onClick={() => setSeries('fat')}
            >
              Body fat
            </button>
          </div>
        )}
      </div>
      <LandscapeChartFrame
        title={showFat ? 'Body fat trend' : 'Bodyweight trend'}
        controls={null}
        onExpandedChange={setChartExpanded}
      >
        {showFat ? (
          <TrendChart
            points={fatPoints}
            label="Body fat percentage"
            seriesLabel="Body fat"
            unit="%"
            height={chartHeight}
          />
        ) : (
          <TrendChart
            points={averagePoints}
            backgroundPoints={dailyPoints}
            label="Bodyweight, 7-day average over daily weigh-ins"
            seriesLabel="7-day average"
            unit="kg"
            area={false}
            goalPath={goalPath}
            height={chartHeight}
          />
        )}
      </LandscapeChartFrame>
      <ul className="chart-legend" aria-label="Chart legend">
        {showFat ? (
          <li>
            <i className="legend-line" aria-hidden="true" />
            Body fat · {fatPoints.length} {fatPoints.length === 1 ? 'reading' : 'readings'}
          </li>
        ) : (
          <>
            <li>
              <i className="legend-dot" aria-hidden="true" />
              Daily weigh-in
            </li>
            <li>
              <i className="legend-line" aria-hidden="true" />
              7-day average
            </li>
            {goalPath && (
              <li>
                <i className="legend-goal" aria-hidden="true" />
                Goal
              </li>
            )}
          </>
        )}
      </ul>
    </div>
  );
}

function CardioScreen({
  exercises,
  onDataChange,
  onOpenWorkout,
}: {
  exercises: Exercise[];
  onDataChange: () => Promise<void>;
  onOpenWorkout: (workoutId: string) => void;
}) {
  const cardioExercises = exercises.filter((exercise) => exercise.kind === 'cardio');
  const defaultExercise =
    cardioExercises.find(
      (exercise) => exercise.name.toLocaleLowerCase() === 'incline treadmill walking',
    ) ??
    cardioExercises[0] ??
    null;
  const empty: CardioSessionInput = {
    session_date: localDate(),
    exercise_id: defaultExercise?.id ?? null,
    activity_type: defaultExercise?.name ?? '',
    duration_minutes: 30,
    calories_kcal: null,
    average_heart_rate_bpm: null,
    distance_km: null,
    average_speed_kph: null,
    incline_percent: null,
    average_power_watts: null,
    average_mets: null,
    intensity: null,
    zone: 'Zone 2',
    qualifies_zone2: true,
    notes: null,
  };
  const [overview, setOverview] = useState<CardioOverview | null>(null);
  const [draft, setDraft] = useState<CardioSessionInput>(empty);
  const [metricSession, setMetricSession] = useState<CardioSession | null>(null);
  const [saving, setSaving] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [scanStatus, setScanStatus] = useState<{ message: string; warning: boolean } | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [historyFilter, setHistoryFilter] = useState<'all' | 'pure_cardio' | 'workout_plus_cardio'>(
    'all',
  );
  const [historyPage, setHistoryPage] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const cardioFormRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!editingId) return;
    const frame = window.requestAnimationFrame(() =>
      cardioFormRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
    );
    return () => window.cancelAnimationFrame(frame);
  }, [editingId]);
  const load = () =>
    api
      .cardioOverview()
      .then(setOverview)
      .catch((reason) =>
        setError(reason instanceof Error ? reason.message : 'Could not load cardio.'),
      );
  useEffect(() => {
    void load();
    const reloadPreferences = () => void load();
    window.addEventListener('training-preferences-updated', reloadPreferences);
    return () => window.removeEventListener('training-preferences-updated', reloadPreferences);
  }, []);
  const filteredSessions =
    overview?.sessions.filter(
      (session) =>
        historyFilter === 'all' ||
        (session.workout_context === 'workout_plus_cardio'
          ? 'workout_plus_cardio'
          : 'pure_cardio') === historyFilter,
    ) ?? [];
  const historyPageCount = Math.max(
    1,
    Math.ceil(filteredSessions.length / CARDIO_HISTORY_PAGE_SIZE),
  );
  const currentHistoryPage = Math.min(historyPage, historyPageCount);
  const pagedSessions = filteredSessions.slice(
    (currentHistoryPage - 1) * CARDIO_HISTORY_PAGE_SIZE,
    currentHistoryPage * CARDIO_HISTORY_PAGE_SIZE,
  );

  useEffect(() => {
    setHistoryPage((page) => Math.min(page, historyPageCount));
  }, [historyPageCount]);
  async function importScreenshot(file: File) {
    if (scanning) return;
    setError(null);
    setScanStatus(null);
    setScanning(true);
    try {
      const scan = await api.scanCardioScreenshot(file);
      const scannedExercise = scan.activity_type
        ? cardioExercises.find(
            (exercise) =>
              exercise.name.toLocaleLowerCase() === scan.activity_type?.toLocaleLowerCase(),
          )
        : null;
      setDraft((current) => ({
        ...current,
        session_date: scan.session_date ?? current.session_date,
        exercise_id: scannedExercise?.id ?? current.exercise_id,
        activity_type: scannedExercise?.name ?? current.activity_type,
        duration_minutes: scan.duration_minutes ?? current.duration_minutes,
        calories_kcal: scan.calories_kcal,
        average_heart_rate_bpm: scan.average_heart_rate_bpm,
        distance_km: scan.distance_km,
        average_speed_kph: scan.average_speed_kph,
        incline_percent: null,
        average_power_watts: null,
        average_mets: null,
      }));
      const scanned = scan.fields_found.join(', ');
      const activityWarning =
        scan.activity_type && !scannedExercise
          ? ` ${scan.activity_type} is not in the activity list, so the current activity was kept.`
          : '';
      setScanStatus({
        message: `Scanned ${scanned}.${activityWarning}${scan.warning ? ` ${scan.warning}` : ''} Review the fields below, then add the session.`,
        warning: Boolean(scan.warning || activityWarning),
      });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not scan that screenshot.');
    } finally {
      setScanning(false);
    }
  }
  async function save() {
    if (saving) return;
    setError(null);
    try {
      if (!editingId && !draft.exercise_id) {
        setError('Choose a cardio exercise.');
        return;
      }
      const payload = {
        ...draft,
        intensity: null,
        qualifies_zone2: draft.zone === 'Zone 2',
      };
      setSaving(true);
      if (editingId) await api.updateCardio(editingId, payload);
      else await api.createCardio(payload);
      setDraft(empty);
      setScanStatus(null);
      setEditingId(null);
      setFormOpen(false);
      await onDataChange();
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not save cardio.');
    } finally {
      setSaving(false);
    }
  }
  async function remove(id: string) {
    try {
      await api.deleteCardio(id);
      await onDataChange();
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not delete cardio.');
    }
  }
  if (!overview) return <LoadingState />;
  const week = overview.current_week;
  const today = localDate();
  const currentWeekSessions = overview.sessions.filter(
    (session) =>
      week.week_start <= session.session_date &&
      session.session_date <= week.week_end &&
      session.session_date <= today,
  );
  const currentWeekMinutes = currentWeekSessions.reduce(
    (total, session) => total + session.duration_minutes,
    0,
  );
  const previousWeekTotals = overview.previous_weeks.map((item) => ({
    ...item,
    completed_minutes: overview.sessions.reduce(
      (total, session) =>
        item.week_start <= session.session_date && session.session_date <= item.week_end
          ? total + session.duration_minutes
          : total,
      0,
    ),
  }));
  return (
    <div className="cardio-screen">
      {error && <p className="inline-error">{error}</p>}
      <CardioEnergyCard summaries={overview.energy_periods} />
      {metricSession && (
        <CardioMetricsEditor
          key={metricSession.id}
          session={metricSession}
          onClose={() => setMetricSession(null)}
          onSave={async (metrics) => {
            await api.updateCardioMetrics(metricSession.id, metrics);
            await onDataChange();
            await load();
          }}
        />
      )}
      <section className="panel total-cardio-card">
        <div className="panel-heading">
          <div>
            <h2>Total cardio time</h2>
            <small>
              {prettyDate(week.week_start)} – {prettyDate(week.week_end)}
            </small>
          </div>
          <strong>{currentWeekMinutes} min</strong>
        </div>
        <p>
          {currentWeekSessions.length} {currentWeekSessions.length === 1 ? 'session' : 'sessions'}{' '}
          logged.
        </p>
      </section>
      {!formOpen && !editingId ? (
        <button
          type="button"
          className="pulse-button primary cardio-log-button"
          onClick={() => {
            setError(null);
            setFormOpen(true);
          }}
        >
          <Icon name="plus" />
          Log cardio session
        </button>
      ) : (
        <section className="panel cardio-form" ref={cardioFormRef}>
          <h2>{editingId ? 'Edit cardio session' : 'Log cardio session'}</h2>
          <div className="cardio-screenshot-import">
            <div className="cardio-screenshot-copy">
              <strong>Import workout screenshot</strong>
              <small>
                OCR fills the form for review. Calories always come from Active Calories; Total
                Calories are ignored.
              </small>
            </div>
            <label className={scanning ? 'disabled' : ''}>
              {scanning ? 'Scanning…' : 'Choose screenshot'}
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
                disabled={scanning}
                aria-label="Upload workout screenshot"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = '';
                  if (file) void importScreenshot(file);
                }}
              />
            </label>
          </div>
          {scanStatus && (
            <p
              className={`cardio-scan-status${scanStatus.warning ? ' warning' : ''}`}
              role="status"
            >
              {scanStatus.message}
            </p>
          )}
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
              <select
                value={draft.exercise_id ?? ''}
                disabled={cardioExercises.length === 0}
                onChange={(event) => {
                  const exercise = cardioExercises.find((item) => item.id === event.target.value);
                  setDraft({
                    ...draft,
                    exercise_id: exercise?.id ?? null,
                    activity_type: exercise?.name ?? '',
                  });
                }}
              >
                {cardioExercises.length === 0 && <option value="">No cardio exercises</option>}
                {cardioExercises.map((exercise) => (
                  <option key={exercise.id} value={exercise.id}>
                    {exercise.name}
                  </option>
                ))}
              </select>
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
              Zone
              <select
                value={draft.zone ?? ''}
                onChange={(event) => {
                  const zone = event.target.value || null;
                  setDraft({ ...draft, zone, qualifies_zone2: zone === 'Zone 2' });
                }}
              >
                <option value="">Not set</option>
                {[1, 2, 3, 4, 5].map((zone) => (
                  <option key={zone} value={`Zone ${zone}`}>
                    Zone {zone}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Calories burned (kcal)
              <input
                type="number"
                min="0"
                max="100000"
                step="1"
                inputMode="numeric"
                value={draft.calories_kcal ?? ''}
                onChange={(event) =>
                  setDraft({ ...draft, calories_kcal: numberOrNull(event.target.value) })
                }
                placeholder="e.g. 350"
              />
            </label>
            <label>
              Average HR (bpm)
              <input
                type="number"
                min="20"
                max="250"
                step="1"
                inputMode="numeric"
                value={draft.average_heart_rate_bpm ?? ''}
                onChange={(event) =>
                  setDraft({ ...draft, average_heart_rate_bpm: numberOrNull(event.target.value) })
                }
                placeholder="e.g. 142"
              />
            </label>
            <label>
              Distance (km)
              <input
                type="number"
                min="0"
                max="10000"
                step="0.01"
                inputMode="decimal"
                value={draft.distance_km ?? ''}
                onChange={(event) =>
                  setDraft({ ...draft, distance_km: numberOrNull(event.target.value) })
                }
                placeholder="Optional"
              />
            </label>
            <label>
              Average speed (km/h)
              <input
                type="number"
                min="0"
                max="100"
                step="0.1"
                inputMode="decimal"
                value={draft.average_speed_kph ?? ''}
                onChange={(event) =>
                  setDraft({ ...draft, average_speed_kph: numberOrNull(event.target.value) })
                }
                placeholder="Optional"
              />
            </label>
            <label>
              Incline (%)
              <input
                type="number"
                min="0"
                max="100"
                step="0.1"
                inputMode="decimal"
                value={draft.incline_percent ?? ''}
                onChange={(event) =>
                  setDraft({ ...draft, incline_percent: numberOrNull(event.target.value) })
                }
                placeholder="Optional"
              />
            </label>
            {(draft.activity_type.toLocaleLowerCase().includes('cycl') ||
              draft.activity_type.toLocaleLowerCase().includes('bike')) && (
              <label>
                Average power (watts)
                <input
                  type="number"
                  min="1"
                  max="3000"
                  step="1"
                  inputMode="numeric"
                  value={draft.average_power_watts ?? ''}
                  onChange={(event) =>
                    setDraft({ ...draft, average_power_watts: numberOrNull(event.target.value) })
                  }
                  placeholder="Optional"
                />
              </label>
            )}
            <label>
              Average METs
              <input
                type="number"
                min="0.1"
                max="50"
                step="0.1"
                inputMode="decimal"
                value={draft.average_mets ?? ''}
                onChange={(event) =>
                  setDraft({ ...draft, average_mets: numberOrNull(event.target.value) })
                }
                placeholder="e.g. 7.5"
              />
            </label>
          </div>
          <p className="cardio-calorie-hint">
            Performance metrics are optional. For calories, prefer your watch or machine’s active
            calorie estimate. MET-minutes are calculated as average METs × session minutes.
          </p>
          <textarea
            value={draft.notes ?? ''}
            onChange={(event) => setDraft({ ...draft, notes: event.target.value || null })}
            placeholder="Notes"
          />
          <button className="primary-action" disabled={saving} onClick={() => void save()}>
            {saving ? 'Saving…' : editingId ? 'Save changes' : 'Add cardio session'}
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={() => {
              setEditingId(null);
              setFormOpen(false);
              setDraft(empty);
              setError(null);
              setScanStatus(null);
            }}
          >
            {editingId ? 'Cancel edit' : 'Cancel'}
          </button>
        </section>
      )}
      <section className="panel cardio-history">
        <div className="cardio-history-header">
          <h2>Cardio history</h2>
          <div className="cardio-history-filters" role="group" aria-label="Filter cardio history">
            {[
              ['all', 'All'],
              ['pure_cardio', 'Cardio only'],
              ['workout_plus_cardio', 'After workout'],
            ].map(([value, label]) => (
              <button
                key={value}
                type="button"
                aria-pressed={historyFilter === value}
                onClick={() => {
                  setHistoryFilter(value as 'all' | 'pure_cardio' | 'workout_plus_cardio');
                  setHistoryPage(1);
                }}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        {filteredSessions.length === 0 && (
          <p className="cardio-history-empty">No cardio sessions match this filter.</p>
        )}
        {pagedSessions.map((session) => {
          const workoutContext =
            session.workout_context === 'workout_plus_cardio'
              ? 'workout_plus_cardio'
              : 'pure_cardio';
          const workoutName = session.source_workout_name?.replace(/\s+workout$/i, '');
          return (
            <article key={session.id}>
              <div>
                <div className="cardio-session-title-row">
                  {workoutContext === 'workout_plus_cardio' && (
                    <span className="cardio-context-badge workout-plus-cardio">After workout</span>
                  )}
                  {session.source_workout_id ? (
                    <button
                      type="button"
                      className="cardio-history-workout-link"
                      onClick={() => onOpenWorkout(session.source_workout_id!)}
                    >
                      <strong>{session.activity_type}</strong>
                    </button>
                  ) : (
                    <strong>{session.activity_type}</strong>
                  )}
                </div>
                <small className="cardio-session-date">{prettyDate(session.session_date)}</small>
                <small className="cardio-session-summary">
                  {session.duration_minutes} min ·{' '}
                  {session.zone ?? session.intensity ?? 'Unspecified'}
                  {workoutName ? ` · ${workoutName}` : ''}
                </small>
                <small className="cardio-session-energy">
                  {session.calories_kcal == null
                    ? 'Calories not logged'
                    : `${session.calories_kcal.toLocaleString()} kcal · ≈ ${fatEnergyEquivalent(session.calories_kcal)} fat burnt`}
                </small>
                <small className="cardio-session-performance">
                  {[
                    session.average_heart_rate_bpm == null
                      ? null
                      : `${session.average_heart_rate_bpm} bpm avg`,
                    session.distance_km == null ? null : `${session.distance_km} km`,
                    session.average_speed_kph == null
                      ? null
                      : `${session.average_speed_kph} km/h avg`,
                    session.incline_percent == null ? null : `${session.incline_percent}% incline`,
                    session.average_power_watts == null
                      ? null
                      : `${session.average_power_watts} W avg`,
                    session.average_mets == null ? null : `${session.average_mets} METs avg`,
                    session.average_mets == null
                      ? null
                      : `${(session.average_mets * session.duration_minutes).toLocaleString(
                          undefined,
                          { maximumFractionDigits: 1 },
                        )} MET-min`,
                  ]
                    .filter((value): value is string => value !== null)
                    .join(' · ') || 'Performance metrics not logged'}
                </small>
              </div>
              <div className="cardio-session-actions">
                <button
                  type="button"
                  onClick={() => setMetricSession(session)}
                  aria-label={`Edit performance metrics for ${session.activity_type} on ${session.session_date}`}
                >
                  {[
                    session.calories_kcal,
                    session.average_heart_rate_bpm,
                    session.distance_km,
                    session.average_speed_kph,
                    session.incline_percent,
                    session.average_power_watts,
                    session.average_mets,
                  ].some((value) => value != null)
                    ? 'Edit metrics'
                    : 'Log metrics'}
                </button>
                {!session.source_workout_id && (
                  <>
                    <button
                      onClick={() => {
                        setEditingId(session.id);
                        setDraft({
                          ...session,
                          exercise_id:
                            cardioExercises.find((item) => item.name === session.activity_type)
                              ?.id ?? null,
                        });
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
              </div>
            </article>
          );
        })}
        <PaginationControls
          currentPage={currentHistoryPage}
          totalPages={historyPageCount}
          onPageChange={setHistoryPage}
          label="cardio history"
        />
      </section>
      <section className="panel previous-zone2">
        <h2>Previous weeks</h2>
        {previousWeekTotals.map((item) => (
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
  categoryColors,
  measurements,
  exercises,
  onEdit,
  onResume,
  onDelete,
  personalRecords,
  onDataChange,
  initialOpenId,
  section,
  onSectionChange,
  onOpenExercise,
  onOpenWorkout,
  initialExerciseId,
  weekStartDay,
  heatmap,
  activeWorkout,
  activeWorkoutDate,
  onResumeWorkout,
  onStartWorkout,
  onReplaceActiveWorkout,
}: {
  workouts: TrackedWorkout[];
  categoryColors: WorkoutTypeColors;
  measurements: BodyMeasurement[];
  exercises: Exercise[];
  onEdit: (workout: TrackedWorkout) => void;
  onResume: (workout: TrackedWorkout) => void;
  onDelete: (workout: TrackedWorkout) => void;
  personalRecords: PersonalRecord[];
  onDataChange: () => Promise<void>;
  initialOpenId: string | null;
  section: HistorySection;
  onSectionChange: (section: HistorySection) => void;
  onOpenExercise: (exerciseId: string) => void;
  onOpenWorkout: (workoutId: string, exerciseId: string | null) => void;
  initialExerciseId: string | null;
  weekStartDay: number;
  heatmap: DashboardData['heatmap'];
  activeWorkout: boolean;
  activeWorkoutDate: string | null;
  onResumeWorkout: () => void;
  onStartWorkout: (workoutDate?: string) => void;
  onReplaceActiveWorkout: (workoutDate: string) => void;
}) {
  const [openId, setOpenId] = useState<string | null>(initialOpenId);
  const [visibleCount, setVisibleCount] = useState(() => {
    const index = initialOpenId ? workouts.findIndex((item) => item.id === initialOpenId) : -1;
    return Math.max(HISTORY_PAGE_SIZE * 2, index + 1);
  });
  const [targetExerciseId, setTargetExerciseId] = useState<string | null>(
    initialOpenId ? initialExerciseId : null,
  );
  const [expandedPhoto, setExpandedPhoto] = useState<MachinePhoto | null>(null);
  const openWorkoutSummaryRef = useRef<HTMLButtonElement>(null);
  const targetExerciseRef = useRef<HTMLDivElement>(null);
  const revealWorkoutRef = useRef(initialOpenId !== null);
  const today = localDate();
  const weekGroups = useMemo(
    () => groupWorkoutsByWeek(workouts.slice(0, visibleCount), weekStartDay),
    [visibleCount, weekStartDay, workouts],
  );
  const recordCounts = useMemo(() => recordCountsByWorkout(personalRecords), [personalRecords]);
  const sectionIndicatorRef = useSlidingIndicator<HTMLDivElement>(section);
  const defaultExerciseId = useMemo(
    () => mostTrainedExerciseId(workouts, today),
    [today, workouts],
  );

  useEffect(() => {
    if (section !== 'history' || !revealWorkoutRef.current) return;
    const summary = openWorkoutSummaryRef.current;
    const exercise = targetExerciseId ? targetExerciseRef.current : null;
    const target = exercise ?? summary;
    if (!target) return;
    revealWorkoutRef.current = false;
    const frame = window.requestAnimationFrame(() => {
      target.focus({ preventScroll: true });
      target.scrollIntoView({
        behavior: 'smooth',
        block: exercise ? 'center' : 'start',
      });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [section, openId, visibleCount, targetExerciseId]);

  return (
    <section className="history-screen content-page">
      {section !== 'progress' && (
        <>
          <PageHeader
            eyebrow={
              section === 'cardio'
                ? 'Zone 2 · energy · sessions'
                : `${workouts.length} ${workouts.length === 1 ? 'workout' : 'workouts'} logged`
            }
            title={section === 'cardio' ? 'Cardio' : 'History'}
            actions={
              section === 'history' ? (
                <button
                  className="icon-button-pulse accent"
                  type="button"
                  onClick={() => onStartWorkout()}
                  aria-label="Add workout"
                >
                  <Icon name="plus" />
                </button>
              ) : undefined
            }
          />
          <div
            ref={sectionIndicatorRef}
            className="segmented-control slide-indicator"
            role="tablist"
            aria-label="History sections"
          >
            <button
              type="button"
              role="tab"
              aria-selected={section === 'history'}
              className={section === 'history' ? 'active' : ''}
              onClick={() => onSectionChange('history')}
            >
              Workouts
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={section === 'cardio'}
              className={section === 'cardio' ? 'active' : ''}
              onClick={() => onSectionChange('cardio')}
            >
              Cardio
            </button>
          </div>
        </>
      )}
      {section === 'progress' ? (
        <ProgressScreen
          exercises={exercises}
          measurements={measurements}
          onOpenWorkout={(workoutId, exerciseId) => onOpenWorkout(workoutId, exerciseId)}
          embedded
          initialExerciseId={initialExerciseId}
          defaultExerciseId={defaultExerciseId}
        />
      ) : section === 'cardio' ? (
        <CardioScreen
          exercises={exercises}
          onDataChange={onDataChange}
          onOpenWorkout={(workoutId) => onOpenWorkout(workoutId, null)}
        />
      ) : (
        <>
          <section
            className="history-calendar-panel calendar-panel pulse-card"
            aria-label="Workout calendar"
          >
            <header className="pulse-card-header">
              <h2>Calendar</h2>
              <span>Sets per week · swipe for earlier months</span>
            </header>
            <InteractiveWorkoutCalendar
              entries={heatmap}
              workouts={workouts}
              categoryColors={categoryColors}
              activeWorkout={activeWorkout}
              activeWorkoutDate={activeWorkoutDate}
              onResumeWorkout={onResumeWorkout}
              onEditWorkout={onEdit}
              onStartWorkout={onStartWorkout}
              onReplaceActiveWorkout={onReplaceActiveWorkout}
            />
          </section>
          {!workouts.length && (
            <EmptyState
              title="Your log is empty"
              body="Your completed workouts will show up here."
              action="Start a workout"
              onAction={() => onStartWorkout()}
            />
          )}
          {weekGroups.map((group) => {
            const label = weekGroupLabel(group.weekStart, today, weekStartDay);
            return (
              <section className="history-week" key={group.weekStart} aria-label={label}>
                <header className="history-week-header">
                  <h2>{label}</h2>
                  <span className="num">
                    {group.workouts.length} {group.workouts.length === 1 ? 'workout' : 'workouts'} ·{' '}
                    {group.sets} sets
                    {group.volumeKg > 0 ? ` · ${formatVolume(group.volumeKg)}` : ''}
                  </span>
                </header>
                <div className="history-week-list">
                  {group.workouts.map((workout) => (
                    <HistoryWorkoutCard
                      key={workout.id}
                      workout={workout}
                      open={openId === workout.id}
                      summaryRef={openId === workout.id ? openWorkoutSummaryRef : null}
                      targetExerciseId={targetExerciseId}
                      targetExerciseRef={targetExerciseRef}
                      categoryColor={categoryColors[workout.category]}
                      records={recordCounts.get(workout.id) ?? 0}
                      personalRecords={personalRecords}
                      activeWorkout={activeWorkout}
                      expandedPhoto={expandedPhoto}
                      onExpandPhoto={setExpandedPhoto}
                      onToggle={() => {
                        setTargetExerciseId(null);
                        setOpenId((current) => (current === workout.id ? null : workout.id));
                      }}
                      onOpenExercise={onOpenExercise}
                      onResume={() => onResume(workout)}
                      onEdit={() => onEdit(workout)}
                      onDelete={() => onDelete(workout)}
                    />
                  ))}
                </div>
              </section>
            );
          })}
          {visibleCount < workouts.length && (
            <button
              type="button"
              className="show-more-button"
              onClick={() => setVisibleCount((count) => count + HISTORY_PAGE_SIZE * 2)}
            >
              Show more · {workouts.length - visibleCount} older
            </button>
          )}
        </>
      )}
    </section>
  );
}

function HistoryWorkoutCard({
  workout,
  open,
  summaryRef,
  targetExerciseId,
  targetExerciseRef,
  categoryColor,
  records,
  personalRecords,
  activeWorkout,
  expandedPhoto,
  onExpandPhoto,
  onToggle,
  onOpenExercise,
  onResume,
  onEdit,
  onDelete,
}: {
  workout: TrackedWorkout;
  open: boolean;
  summaryRef: RefObject<HTMLButtonElement | null> | null;
  targetExerciseId: string | null;
  targetExerciseRef: RefObject<HTMLDivElement | null>;
  categoryColor: string;
  records: number;
  personalRecords: PersonalRecord[];
  activeWorkout: boolean;
  expandedPhoto: MachinePhoto | null;
  onExpandPhoto: (photo: MachinePhoto | null) => void;
  onToggle: () => void;
  onOpenExercise: (exerciseId: string) => void;
  onResume: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const completedWorkoutSets = workout.movements
    .flatMap((movement) => movement.sets)
    .filter((item) => item.completed);
  const workingSetCount = workingSets(workout).length;
  const totalReps = completedWorkoutSets.reduce((total, item) => total + (item.reps ?? 0), 0);
  const totalVolume = workoutVolumeKg(workout);
  const totalDistance = completedWorkoutSets.reduce(
    (total, item) => total + (item.distance_km ?? 0),
    0,
  );
  const meta = [
    shortDate(workout.workout_date),
    workout.duration_minutes ? formatMinutesDuration(workout.duration_minutes) : null,
    workingSetCount ? `${workingSetCount} sets` : null,
  ].filter(Boolean);

  return (
    <article className={`history-card ${open ? 'open' : ''}`}>
      <button
        ref={summaryRef}
        className="history-card-summary"
        aria-expanded={open}
        onClick={onToggle}
      >
        <i style={{ background: categoryColor }} aria-hidden="true" />
        <span className="history-card-copy">
          <strong>
            {workoutDisplayName(workout)}
            {workout.is_sample && <em className="sample-tag">Sample</em>}
          </strong>
          <small>{meta.join(' · ')}</small>
        </span>
        <span className="history-card-metric num">
          {totalVolume > 0
            ? formatVolume(totalVolume)
            : totalDistance > 0
              ? `${Number(totalDistance.toFixed(1))} km`
              : formatMinutesDuration(workout.duration_minutes)}
          {records > 0 && (
            <small>
              {records} {records === 1 ? 'PR' : 'PRs'}
            </small>
          )}
        </span>
        <span className="history-card-chevron" aria-hidden="true">
          <Icon name="chevron-down" />
        </span>
      </button>
      {open && (
        <div className="history-detail">
          <div className="history-workout-stats" aria-label="Workout totals">
            {workout.start_time && workout.end_time && (
              <span>
                <small>When</small>
                <strong>{formatWorkoutTimeRange(workout.start_time, workout.end_time)}</strong>
              </span>
            )}
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
          {workout.movements.map((movement) => {
            const targeted = targetExerciseId === movement.exercise.id;
            const best = topWorkingSet(movement.sets);
            return (
              <div
                ref={targeted ? targetExerciseRef : null}
                className={`history-movement ${targeted ? 'targeted-exercise' : ''}`}
                key={movement.id}
                tabIndex={targeted ? -1 : undefined}
              >
                <div className="history-movement-header">
                  <button
                    type="button"
                    className="history-exercise-link"
                    onClick={() => onOpenExercise(movement.exercise.id)}
                  >
                    {movement.exercise.name}
                    <Icon name="chevron-right" />
                  </button>
                  {best && <span className="num">Top {setLabel(best)}</span>}
                </div>
                {movement.machine_photos.length > 0 && (
                  <>
                    <div className="history-machine-photos">
                      {movement.machine_photos.map((photo) => (
                        <button
                          type="button"
                          key={photo.id}
                          onClick={() =>
                            onExpandPhoto(expandedPhoto?.id === photo.id ? null : photo)
                          }
                          aria-label={`${expandedPhoto?.id === photo.id ? 'Collapse' : 'Expand'} ${photo.caption}`}
                          aria-expanded={expandedPhoto?.id === photo.id}
                        >
                          <span className="history-photo-image">
                            <img src={photo.thumbnail_url} alt={photo.caption} loading="lazy" />
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
                      movement.machine_photos.some((photo) => photo.id === expandedPhoto.id) && (
                        <MachinePhotoDetail
                          photo={expandedPhoto}
                          onClose={() => onExpandPhoto(null)}
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
            );
          })}
          {workout.notes && <p className="history-workout-notes">{workout.notes}</p>}
          <div className="workout-actions">
            {!activeWorkout && (
              <button className="resume-workout-button" type="button" onClick={onResume}>
                Resume from now
              </button>
            )}
            <button type="button" onClick={onEdit}>
              Edit
            </button>
            <InlineConfirmButton
              className="delete-workout"
              label="Delete"
              confirmLabel="Confirm delete"
              onConfirm={onDelete}
            />
          </div>
        </div>
      )}
    </article>
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

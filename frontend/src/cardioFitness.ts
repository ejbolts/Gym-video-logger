import type { CardioSession } from './types';

export type CardioFitnessConfidence = 'Low' | 'Medium' | 'High';
export type CardioWorkoutContext = 'pure_cardio' | 'workout_plus_cardio';

interface CardioFitnessComponents {
  efficiency: number;
  workload: number;
  endurance: number;
}

export interface CardioFitnessActivityScore {
  family: 'treadmill-walking' | 'indoor-cycling';
  activityLabel: string;
  context: CardioWorkoutContext;
  contextLabel: string;
  score: number;
  changeFromBaseline: number;
  confidence: CardioFitnessConfidence;
  eligibleSessions: number;
  totalSessions: number;
  baselineStart: string;
  baselineEnd: string;
  currentStart: string;
  currentEnd: string;
  workload: number;
  workloadUnit: 'METs' | 'W';
  components: CardioFitnessComponents;
}

export interface CardioFitnessSessionScore {
  sessionId: string;
  sessionDate: string;
  activityLabel: string;
  context: CardioWorkoutContext;
  contextLabel: string;
  score: number;
  changeFromBaseline: number;
  confidence: CardioFitnessConfidence;
  isBaselineSession: boolean;
  workload: number;
  workloadUnit: CardioFitnessActivityScore['workloadUnit'];
  components: CardioFitnessComponents;
}

export interface CardioFitnessSummary {
  status: 'ready' | 'building';
  score: number | null;
  changeFromBaseline: number | null;
  confidence: CardioFitnessConfidence;
  activityLabel: string;
  eligibleSessions: number;
  totalSessions: number;
  sessionsNeeded: number;
  activities: CardioFitnessActivityScore[];
  primaryActivity: CardioFitnessActivityScore | null;
}

interface ScoredSession {
  id: string;
  sessionDate: string;
  durationMinutes: number;
  heartRate: number;
  workload: number;
}

interface ActivityGroup {
  family: CardioFitnessActivityScore['family'];
  label: string;
  context: CardioWorkoutContext;
  contextLabel: string;
  workloadUnit: CardioFitnessActivityScore['workloadUnit'];
  sessions: ScoredSession[];
  totalSessions: number;
}

const BASELINE_SESSION_COUNT = 3;
const CURRENT_SESSION_COUNT = 1;
const MAX_CURRENT_WINDOW = 5;
const MIN_SESSION_MINUTES = 20;

function localDate(): string {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60_000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 10);
}

function median(values: number[]): number {
  const ordered = [...values].sort((left, right) => left - right);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 === 0 ? (ordered[middle - 1] + ordered[middle]) / 2 : ordered[middle];
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function relativeScore(current: number, baseline: number): number {
  if (current <= 0 || baseline <= 0) return 50;
  const change = Math.tanh(Math.log(current / baseline) / Math.log(2));
  return Math.round(clamp(50 + change * 50, 0, 100));
}

export function cardioWorkoutContext(session: CardioSession): CardioWorkoutContext {
  return session.workout_context === 'workout_plus_cardio' ? 'workout_plus_cardio' : 'pure_cardio';
}

function contextLabel(context: CardioWorkoutContext): string {
  return context === 'workout_plus_cardio' ? 'Workout + cardio' : 'Pure cardio';
}

function activityFamily(
  session: CardioSession,
): Pick<ActivityGroup, 'family' | 'label' | 'workloadUnit'> | null {
  const activity = session.activity_type.toLocaleLowerCase();
  if (activity.includes('cycl') || activity.includes('bike')) {
    return {
      family: 'indoor-cycling',
      label: 'Indoor cycling',
      workloadUnit: 'W',
    };
  }
  if (activity.includes('walk') && activity.includes('treadmill')) {
    return {
      family: 'treadmill-walking',
      label: 'Incline treadmill walking',
      workloadUnit: 'METs',
    };
  }
  return null;
}

function workloadForSession(
  session: CardioSession,
  family: ActivityGroup['family'],
): number | null {
  if (family === 'indoor-cycling') {
    const watts = session.average_power_watts;
    return watts != null && watts > 0 ? watts : null;
  }

  const speedKph = session.average_speed_kph;
  const inclinePercent = session.incline_percent;
  if (
    speedKph == null ||
    inclinePercent == null ||
    speedKph < 2 ||
    speedKph > 6.5 ||
    inclinePercent < 0 ||
    inclinePercent > 25
  ) {
    return null;
  }
  const speedMetresPerMinute = (speedKph * 1_000) / 60;
  const grade = inclinePercent / 100;
  const estimatedOxygenCost = 0.1 * speedMetresPerMinute + 1.8 * speedMetresPerMinute * grade + 3.5;
  return estimatedOxygenCost / 3.5;
}

function confidenceFor(sessions: ScoredSession[]): CardioFitnessConfidence {
  const first = new Date(`${sessions[0].sessionDate}T12:00:00`).getTime();
  const last = new Date(`${sessions.at(-1)!.sessionDate}T12:00:00`).getTime();
  const spanDays = (last - first) / 86_400_000;
  if (sessions.length >= 12 && spanDays >= 42) return 'High';
  if (sessions.length >= 8 && spanDays >= 21) return 'Medium';
  return 'Low';
}

function componentScores(
  current: ScoredSession[],
  baseline: ScoredSession[],
): CardioFitnessComponents {
  const efficiency = (session: ScoredSession) => session.workload / session.heartRate;
  const capacity = (session: ScoredSession) => session.workload * session.durationMinutes;
  return {
    efficiency: relativeScore(median(current.map(efficiency)), median(baseline.map(efficiency))),
    workload: relativeScore(
      median(current.map((session) => session.workload)),
      median(baseline.map((session) => session.workload)),
    ),
    endurance: relativeScore(median(current.map(capacity)), median(baseline.map(capacity))),
  };
}

function combinedScore(components: CardioFitnessComponents): number {
  return Math.round(
    components.efficiency * 0.6 + components.workload * 0.2 + components.endurance * 0.2,
  );
}

function buildActivityGroups(
  sessions: CardioSession[] | undefined,
  today: string,
): ActivityGroup[] {
  const groups = new Map<string, ActivityGroup>();
  for (const session of sessions ?? []) {
    if (session.session_date > today) continue;
    const family = activityFamily(session);
    if (!family) continue;
    const context = cardioWorkoutContext(session);
    const key = `${family.family}:${context}`;
    const group = groups.get(key) ?? {
      ...family,
      context,
      contextLabel: contextLabel(context),
      sessions: [],
      totalSessions: 0,
    };
    group.totalSessions += 1;
    const heartRate = session.average_heart_rate_bpm;
    const workload = workloadForSession(session, family.family);
    if (
      session.duration_minutes >= MIN_SESSION_MINUTES &&
      heartRate != null &&
      heartRate >= 40 &&
      heartRate <= 230 &&
      workload != null
    ) {
      group.sessions.push({
        id: session.id,
        sessionDate: session.session_date,
        durationMinutes: session.duration_minutes,
        heartRate,
        workload,
      });
    }
    groups.set(key, group);
  }

  return [...groups.values()]
    .map((group) => ({
      ...group,
      sessions: [...group.sessions].sort((left, right) =>
        left.sessionDate.localeCompare(right.sessionDate),
      ),
    }))
    .sort((left, right) => {
      if (left.context !== right.context) return left.context === 'pure_cardio' ? -1 : 1;
      const sessionDifference = right.sessions.length - left.sessions.length;
      if (sessionDifference !== 0) return sessionDifference;
      const leftDate = left.sessions.at(-1)?.sessionDate ?? '';
      const rightDate = right.sessions.at(-1)?.sessionDate ?? '';
      return rightDate.localeCompare(leftDate);
    });
}

function scoreActivity(group: ActivityGroup): CardioFitnessActivityScore | null {
  if (group.sessions.length < BASELINE_SESSION_COUNT + CURRENT_SESSION_COUNT) return null;
  const baseline = group.sessions.slice(0, BASELINE_SESSION_COUNT);
  const current = group.sessions.slice(BASELINE_SESSION_COUNT).slice(-MAX_CURRENT_WINDOW);
  const components = componentScores(current, baseline);
  const score = combinedScore(components);

  return {
    family: group.family,
    activityLabel: group.label,
    context: group.context,
    contextLabel: group.contextLabel,
    score,
    changeFromBaseline: score - 50,
    confidence: confidenceFor(group.sessions),
    eligibleSessions: group.sessions.length,
    totalSessions: group.totalSessions,
    baselineStart: baseline[0].sessionDate,
    baselineEnd: baseline.at(-1)!.sessionDate,
    currentStart: current[0].sessionDate,
    currentEnd: current.at(-1)!.sessionDate,
    workload: median(current.map((session) => session.workload)),
    workloadUnit: group.workloadUnit,
    components,
  };
}

export function cardioSessionScores(
  sessions: CardioSession[] | undefined,
  today = localDate(),
): Map<string, CardioFitnessSessionScore> {
  const scores = new Map<string, CardioFitnessSessionScore>();
  for (const group of buildActivityGroups(sessions, today)) {
    if (group.sessions.length < BASELINE_SESSION_COUNT) continue;
    const baseline = group.sessions.slice(0, BASELINE_SESSION_COUNT);
    group.sessions.forEach((session, index) => {
      const components = componentScores([session], baseline);
      const score = combinedScore(components);
      scores.set(session.id, {
        sessionId: session.id,
        sessionDate: session.sessionDate,
        activityLabel: group.label,
        context: group.context,
        contextLabel: group.contextLabel,
        score,
        changeFromBaseline: score - 50,
        confidence: confidenceFor(
          group.sessions.slice(0, Math.max(BASELINE_SESSION_COUNT, index + 1)),
        ),
        isBaselineSession: index < BASELINE_SESSION_COUNT,
        workload: session.workload,
        workloadUnit: group.workloadUnit,
        components,
      });
    });
  }
  return scores;
}

export function cardioFitnessSummary(
  sessions: CardioSession[] | undefined,
  today = localDate(),
): CardioFitnessSummary {
  const orderedGroups = buildActivityGroups(sessions, today);
  const activities = orderedGroups
    .map(scoreActivity)
    .filter((activity): activity is CardioFitnessActivityScore => activity !== null);
  const leadingGroup = orderedGroups[0] ?? null;

  if (activities.length === 0) {
    const eligibleSessions = leadingGroup?.sessions.length ?? 0;
    return {
      status: 'building',
      score: null,
      changeFromBaseline: null,
      confidence: 'Low',
      activityLabel: leadingGroup
        ? `${leadingGroup.label} · ${leadingGroup.contextLabel}`
        : 'Cardio',
      eligibleSessions,
      totalSessions: leadingGroup?.totalSessions ?? 0,
      sessionsNeeded: Math.max(
        0,
        BASELINE_SESSION_COUNT + CURRENT_SESSION_COUNT - eligibleSessions,
      ),
      activities: [],
      primaryActivity: null,
    };
  }

  const activityWeights = activities.map((activity) =>
    Math.min(MAX_CURRENT_WINDOW, activity.eligibleSessions - BASELINE_SESSION_COUNT),
  );
  const totalWeight = activityWeights.reduce((total, weight) => total + weight, 0);
  const score = Math.round(
    activities.reduce(
      (total, activity, index) => total + activity.score * activityWeights[index],
      0,
    ) / totalWeight,
  );
  const primaryActivity = activities[0];
  return {
    status: 'ready',
    score,
    changeFromBaseline: score - 50,
    confidence: primaryActivity.confidence,
    activityLabel:
      activities.length === 1
        ? `${primaryActivity.activityLabel} · ${primaryActivity.contextLabel}`
        : `${activities.length} activity contexts`,
    eligibleSessions: orderedGroups.reduce((total, group) => total + group.sessions.length, 0),
    totalSessions: orderedGroups.reduce((total, group) => total + group.totalSessions, 0),
    sessionsNeeded: 0,
    activities,
    primaryActivity,
  };
}

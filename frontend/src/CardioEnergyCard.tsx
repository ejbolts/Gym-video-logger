import { useState } from 'react';
import type { CardioEnergyPeriod, CardioSession } from './types';
import { fatEnergyEquivalent } from './cardioEnergy';
import { cardioFitnessSummary } from './cardioFitness';

const periods: { value: CardioEnergyPeriod['period']; label: string }[] = [
  { value: 'week', label: 'This week' },
  { value: 'month', label: 'This month' },
  { value: '3m', label: '3 months' },
  { value: '6m', label: '6 months' },
  { value: 'year', label: 'This year' },
  { value: 'all', label: 'All time' },
];

function prettyDate(value: string): string {
  return new Date(`${value}T12:00:00`).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function comparison(current: number | null, previous: number | null, unit = ''): string {
  if (current === null || previous === null) return 'No prior comparison';
  const difference = current - previous;
  const decimals = ['bpm', 'g', 'kcal'].includes(unit) ? 0 : 1;
  const unchangedThreshold = decimals === 0 ? 0.5 : 0.05;
  if (Math.abs(difference) < unchangedThreshold) return 'No change vs prior';
  const prefix = difference > 0 ? '↑' : '↓';
  return `${prefix} ${Math.abs(difference).toFixed(decimals)}${unit ? ` ${unit}` : ''} vs prior`;
}

export function CardioEnergyCard({
  summaries,
  sessions,
}: {
  summaries: CardioEnergyPeriod[] | undefined;
  sessions?: CardioSession[];
}) {
  const [period, setPeriod] = useState<CardioEnergyPeriod['period']>('week');
  const [expanded, setExpanded] = useState(false);
  const summary = summaries?.find((item) => item.period === period);
  if (!summary) return null;
  const missing = summary.total_sessions - summary.logged_sessions;
  const caloriesRecorded = summary.logged_sessions > 0;
  const previousDates =
    summary.previous_start_date && summary.previous_end_date
      ? `${prettyDate(summary.previous_start_date)} – ${prettyDate(summary.previous_end_date)}`
      : null;
  const previousCalories = summary.previous_calories_kcal ?? null;
  const caloriesComparison = comparison(summary.calories_kcal, previousCalories, 'kcal');
  const fatComparison = comparison(
    (summary.calories_kcal / 7700) * 1000,
    previousCalories === null ? null : (previousCalories / 7700) * 1000,
    'g',
  );
  const heartRate = summary.average_heart_rate_bpm ?? null;
  const distance = summary.distance_km ?? 0;
  const speed = summary.average_speed_kph ?? null;
  const incline = summary.average_incline_percent ?? null;
  const fitness = cardioFitnessSummary(sessions);
  const fitnessChange = fitness.changeFromBaseline ?? 0;
  const fitnessTrend =
    Math.abs(fitnessChange) < 3
      ? 'Stable vs baseline'
      : `${fitnessChange > 0 ? '+' : ''}${fitnessChange} vs baseline`;
  const primaryFitness = fitness.primaryActivity;

  return (
    <section className="panel cardio-energy-card cardio-progress-card" aria-label="Cardio progress">
      <button
        type="button"
        className="cardio-progress-toggle"
        aria-expanded={expanded}
        onClick={() => setExpanded((current) => !current)}
      >
        <div>
          <p className="section-kicker">COMPARE WITH YOURSELF</p>
          <h2>Cardio fitness</h2>
          <div className="cardio-fitness-summary" aria-live="polite">
            {fitness.status === 'ready' ? (
              <>
                <strong>
                  {fitness.score}
                  <small>/100</small>
                </strong>
                <span>
                  {fitness.activityLabel} · {fitnessTrend}
                </span>
              </>
            ) : (
              <>
                <strong>Building baseline</strong>
                <span>
                  {fitness.sessionsNeeded} more complete {fitness.activityLabel.toLocaleLowerCase()}{' '}
                  {fitness.sessionsNeeded === 1 ? 'session' : 'sessions'} needed
                </span>
              </>
            )}
          </div>
        </div>
        <span className="cardio-energy-estimate">
          {expanded ? 'Hide details −' : 'Show details +'}
        </span>
      </button>
      {expanded && (
        <div className="cardio-progress-content">
          <div className="cardio-fitness-details">
            <div className="cardio-fitness-heading">
              <div>
                <span>Personal progress score</span>
                <strong>{fitness.confidence} confidence</strong>
              </div>
              <small>
                {fitness.eligibleSessions} of {fitness.totalSessions} comparable sessions include
                the required workload and heart-rate data.
              </small>
            </div>
            {primaryFitness ? (
              <>
                <div className="cardio-fitness-components">
                  <article>
                    <span>Aerobic efficiency</span>
                    <strong>{primaryFitness.components.efficiency}</strong>
                    <small>Workload per heartbeat · 60%</small>
                  </article>
                  <article>
                    <span>Sustained workload</span>
                    <strong>{primaryFitness.components.workload}</strong>
                    <small>
                      {primaryFitness.workload.toFixed(1)} {primaryFitness.workloadUnit} · 20%
                    </small>
                  </article>
                  <article>
                    <span>Endurance</span>
                    <strong>{primaryFitness.components.endurance}</strong>
                    <small>Workload × duration · 20%</small>
                  </article>
                </div>
                {fitness.activities.length > 1 && (
                  <div className="cardio-fitness-context-scores">
                    {fitness.activities.map((activity) => (
                      <article key={`${activity.family}-${activity.context}`}>
                        <span>{activity.activityLabel}</span>
                        <small>{activity.contextLabel}</small>
                        <strong>{activity.score}/100</strong>
                      </article>
                    ))}
                  </div>
                )}
                <p className="cardio-fitness-method">
                  Your first three complete {primaryFitness.activityLabel.toLocaleLowerCase()}{' '}
                  sessions in {primaryFitness.contextLabel.toLocaleLowerCase()} set a personal
                  baseline of 50. The current score uses sessions from{' '}
                  {prettyDate(primaryFitness.currentStart)} to{' '}
                  {prettyDate(primaryFitness.currentEnd)}. Pure cardio and workout + cardio are
                  scored separately so earlier lifting does not distort the comparison. Treadmill
                  workload uses speed and incline; cycling uses average watts.
                </p>
              </>
            ) : (
              <p className="cardio-fitness-method">
                Log at least four comparable sessions in one activity and workout context. Incline
                treadmill walking needs duration, average heart rate, speed, and incline. Indoor
                cycling needs duration, average heart rate, and average watts.
              </p>
            )}
          </div>
          <h3 className="cardio-progress-subheading">Training metrics</h3>
          <div className="cardio-energy-periods" role="group" aria-label="Cardio progress period">
            {periods.map((item) => (
              <button
                key={item.value}
                type="button"
                aria-pressed={period === item.value}
                onClick={() => setPeriod(item.value)}
              >
                {item.label}
              </button>
            ))}
          </div>
          <div className="cardio-progress-dates">
            <strong>
              {prettyDate(summary.start_date)} – {prettyDate(summary.end_date)}
            </strong>
            <span>{previousDates ? `Compared with ${previousDates}` : 'All recorded history'}</span>
          </div>
          <div className="cardio-progress-grid" aria-live="polite" aria-atomic="true">
            <article>
              <span>Calories</span>
              <strong>
                {caloriesRecorded ? `${summary.calories_kcal.toLocaleString()} kcal` : '—'}
              </strong>
              <small>
                {summary.logged_sessions} of {summary.total_sessions} sessions logged
              </small>
              <small className="cardio-progress-comparison">
                {caloriesRecorded ? caloriesComparison : 'No calories logged'}
              </small>
            </article>
            <article>
              <span>Fat-energy equivalent</span>
              <strong>
                {caloriesRecorded ? `≈ ${fatEnergyEquivalent(summary.calories_kcal)}` : '—'}
              </strong>
              <small>Calculated from logged calories</small>
              <small className="cardio-progress-comparison">
                {caloriesRecorded ? fatComparison : 'Not measured fat loss'}
              </small>
            </article>
            <article>
              <span>Average HR</span>
              <strong>{heartRate === null ? '—' : `${heartRate.toFixed(0)} bpm`}</strong>
              <small>{summary.heart_rate_sessions ?? 0} sessions logged</small>
              <small className="cardio-progress-comparison">
                {heartRate === null
                  ? 'No heart rate logged'
                  : comparison(heartRate, summary.previous_average_heart_rate_bpm ?? null, 'bpm')}
              </small>
            </article>
            <article>
              <span>Distance</span>
              <strong>
                {(summary.distance_sessions ?? 0) === 0 ? '—' : `${distance.toFixed(2)} km`}
              </strong>
              <small>{summary.distance_sessions ?? 0} sessions logged</small>
              <small className="cardio-progress-comparison">
                {(summary.distance_sessions ?? 0) === 0
                  ? 'No distance logged'
                  : comparison(distance, summary.previous_distance_km ?? null, 'km')}
              </small>
            </article>
            <article>
              <span>Average speed</span>
              <strong>{speed === null ? '—' : `${speed.toFixed(1)} km/h`}</strong>
              <small>{summary.speed_sessions ?? 0} sessions logged</small>
              <small className="cardio-progress-comparison">
                {speed === null
                  ? 'No speed logged'
                  : comparison(speed, summary.previous_average_speed_kph ?? null, 'km/h')}
              </small>
            </article>
            <article>
              <span>Average incline</span>
              <strong>{incline === null ? '—' : `${incline.toFixed(1)}%`}</strong>
              <small>{summary.incline_sessions ?? 0} sessions logged</small>
              <small className="cardio-progress-comparison">
                {incline === null
                  ? 'No incline logged'
                  : comparison(incline, summary.previous_average_incline_percent ?? null, '%')}
              </small>
            </article>
          </div>
          {missing > 0 && (
            <p className="cardio-energy-note">{missing} sessions are missing calories.</p>
          )}
        </div>
      )}
    </section>
  );
}

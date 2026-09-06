import { useState } from 'react';
import type { CardioEnergyPeriod } from './types';
import { fatEnergyEquivalent } from './cardioEnergy';

const periods: { value: CardioEnergyPeriod['period']; label: string }[] = [
  { value: 'week', label: 'This week' },
  { value: 'month', label: 'This month' },
  { value: '3m', label: '3 months' },
  { value: '6m', label: '6 months' },
  { value: 'year', label: 'This year' },
  { value: 'all', label: 'All time' },
];

export function CardioEnergyCard({ summaries }: { summaries: CardioEnergyPeriod[] | undefined }) {
  const [period, setPeriod] = useState<CardioEnergyPeriod['period']>('week');
  const summary = summaries?.find((item) => item.period === period);
  if (!summary) return null;
  const missing = summary.total_sessions - summary.logged_sessions;
  const recorded = summary.logged_sessions > 0;
  const prettyDate = (value: string) =>
    new Date(`${value}T12:00:00`).toLocaleDateString(undefined, {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });

  return (
    <section className="panel cardio-energy-card" aria-label="Cardio energy progress">
      <header>
        <div>
          <p className="section-kicker">YOUR CARDIO EFFORT</p>
          <h2>Fat-energy equivalent</h2>
        </div>
        <span className="cardio-energy-estimate">Estimate</span>
      </header>
      <div className="cardio-energy-periods" role="group" aria-label="Cardio energy period">
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
      <div className="cardio-energy-result" aria-live="polite" aria-atomic="true">
        <p className="cardio-energy-dates">
          {prettyDate(summary.start_date)} – {prettyDate(summary.end_date)}
        </p>
        <strong>{recorded ? `≈ ${fatEnergyEquivalent(summary.calories_kcal)}` : '—'}</strong>
        <p>
          {recorded
            ? `${summary.calories_kcal.toLocaleString()} kcal logged`
            : 'No calories logged yet'}
        </p>
        <small>
          {summary.total_sessions === 0
            ? 'Log a cardio session to start building your total.'
            : `${summary.logged_sessions} of ${summary.total_sessions} sessions with calories`}
          {missing > 0 && ` · ${missing} not logged`}
        </small>
      </div>
      <p className="cardio-energy-note">Energy comparison, not measured fat loss.</p>
      <details>
        <summary>How this estimate works</summary>
        <p>
          Your logged cardio calories ÷ 7,700 kcal per kg. This compares energy with stored body
          fat; it does not measure fat burned, fat loss, or a food calorie deficit. All cardio zones
          count. Sessions without calories are excluded from the estimate.
        </p>
        <a href="https://pubmed.ncbi.nlm.nih.gov/17848938/" target="_blank" rel="noreferrer">
          About the estimate
        </a>
      </details>
    </section>
  );
}

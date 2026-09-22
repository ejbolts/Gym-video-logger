import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { BodyCompositionScreen } from './App';
import { bodyweightEntryPlaceholder } from './bodyTrend';
import type { BodyMeasurement } from './types';

describe('BodyCompositionScreen', () => {
  it('uses the most recent bodyweight as the new check-in placeholder', () => {
    const measurements: BodyMeasurement[] = [
      {
        id: 'latest',
        measurement_date: '2026-09-02',
        weight_kg: 84.2,
        body_fat_pct: 13,
        notes: null,
        is_sample: false,
        created_at: '2026-09-02T01:00:00Z',
      },
      {
        id: 'previous',
        measurement_date: '2026-09-01',
        weight_kg: 84,
        body_fat_pct: 13,
        notes: null,
        is_sample: false,
        created_at: '2026-09-01T01:00:00Z',
      },
    ];

    const markup = renderToStaticMarkup(
      <BodyCompositionScreen
        measurements={measurements}
        onSave={vi.fn()}
        onDelete={vi.fn()}
        onDataChange={vi.fn()}
      />,
    );

    expect(bodyweightEntryPlaceholder(measurements)).toBe('84.2');
    expect(markup).toContain('<strong>84.2 kg</strong>');
    expect(markup).toContain('<option value="1m" selected="">1 month</option>');
    expect(markup).toContain('<option value="3m">3 months</option>');
    expect(markup).not.toContain('Training phase');
  });

  it('shows the configured bodyweight trend statistic and duration as dropdowns', () => {
    const measurements: BodyMeasurement[] = [
      {
        id: 'latest',
        measurement_date: '2026-09-02',
        weight_kg: 84.2,
        body_fat_pct: null,
        notes: null,
        is_sample: false,
        created_at: '2026-09-02T01:00:00Z',
      },
      {
        id: 'previous',
        measurement_date: '2026-09-01',
        weight_kg: 83.8,
        body_fat_pct: null,
        notes: null,
        is_sample: false,
        created_at: '2026-09-01T01:00:00Z',
      },
    ];

    const markup = renderToStaticMarkup(
      <BodyCompositionScreen
        measurements={measurements}
        onSave={vi.fn()}
        onDelete={vi.fn()}
        onDataChange={vi.fn()}
        trendPreference={{ duration: '14d', statistic: 'median' }}
      />,
    );

    expect(markup).toContain('aria-label="Bodyweight trend statistic"');
    expect(markup).toContain('<option value="median" selected="">Median</option>');
    expect(markup).toContain('aria-label="Bodyweight trend duration"');
    expect(markup).toContain('<option value="14d" selected="">14 days</option>');
    expect(markup).toContain('<option value="6m">6 months</option>');
    expect(markup).toContain('<option value="1y">1 year</option>');
    expect(markup).toContain('<strong>84.0 kg</strong>');
  });
});

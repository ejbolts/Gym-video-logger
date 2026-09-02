import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { WorkoutHeaderMeta, WorkoutRestTimer } from './WorkoutRestTimer';

describe('workout header rest timer', () => {
  it('shows the countdown with an accessible red-X skip control', () => {
    const markup = renderToStaticMarkup(<WorkoutRestTimer seconds={168} onSkip={vi.fn()} />);

    expect(markup).toContain('role="timer"');
    expect(markup).toContain('aria-label="Rest timer 2:48"');
    expect(markup).toContain('<strong>2:48</strong>');
    expect(markup).not.toContain('>REST<');
    expect(markup).toContain('aria-label="Skip rest timer"');
    expect(markup).toContain('>×</button>');
  });

  it('keeps a dot separator between the duration and active timer', () => {
    const markup = renderToStaticMarkup(
      <WorkoutHeaderMeta durationLabel="Live 3:55:32" restSeconds={168} onSkipRest={vi.fn()} />,
    );

    expect(markup).toContain('Live 3:55:32');
    expect(markup).toContain(
      '<span class="workout-header-duration">Live 3:55:32</span><span class="workout-header-separator" aria-hidden="true">•</span><span class="workout-rest-timer"',
    );
    expect(markup).not.toContain('Push');
  });

  it('shows only the duration when the timer is inactive', () => {
    const markup = renderToStaticMarkup(
      <WorkoutHeaderMeta durationLabel="Live 4:11:40" restSeconds={null} onSkipRest={vi.fn()} />,
    );

    expect(markup).toContain('<span class="workout-header-duration">Live 4:11:40</span>');
    expect(markup).not.toContain('Push');
    expect(markup).not.toContain('workout-header-separator');
    expect(markup).not.toContain('workout-rest-timer');
  });
});

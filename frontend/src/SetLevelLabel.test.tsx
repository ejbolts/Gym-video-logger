import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SetLevelLabel } from './SetLevelLabel';

describe('SetLevelLabel', () => {
  it.each([
    ['normal', 'working', 'set-level-working'],
    ['drop', 'drop set', 'set-level-drop'],
    ['warmup', 'warmup', 'set-level-warmup'],
  ] as const)('renders %s sets as text', (setType, label, className) => {
    const markup = renderToStaticMarkup(<SetLevelLabel setType={setType} />);

    expect(markup).toContain(`class="set-level-label ${className}"`);
    expect(markup).toContain(`>${label}</span>`);
    expect(markup).not.toContain('★');
  });

  it('keeps legacy warm-up sets labelled as warmups', () => {
    const markup = renderToStaticMarkup(<SetLevelLabel setType="normal" warmup />);

    expect(markup).toContain('set-level-warmup');
  });
});

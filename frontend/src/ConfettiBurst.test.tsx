import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ConfettiBurst } from './ConfettiBurst';

describe('ConfettiBurst', () => {
  it('renders a non-interactive decorative celebration', () => {
    const markup = renderToStaticMarkup(<ConfettiBurst />);

    expect(markup).toContain('class="confetti-burst"');
    expect(markup).toContain('aria-hidden="true"');
    expect(markup.match(/class="confetti-piece"/g)).toHaveLength(36);
  });
});

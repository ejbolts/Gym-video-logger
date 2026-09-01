import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('App startup', () => {
  it('renders an animated menu-shaped skeleton before training data has loaded', () => {
    vi.stubGlobal('window', {
      history: { state: null },
      location: { hash: '' },
      localStorage: { getItem: () => null },
    });

    const markup = renderToStaticMarkup(<App />);

    expect(markup).toContain('menu-loading-skeleton');
    expect(markup).toContain('menu-skeleton-shortcut');
    expect(markup).toContain('Loading training menu');
    expect(markup).not.toContain('Loading your training log');
  });
});

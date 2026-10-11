import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import metadata from '../release.json';
import { ReleaseAnnouncement } from './ReleaseAnnouncement';

vi.mock('react-dom', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-dom')>()),
  createPortal: (children: ReactNode) => children,
}));
beforeEach(() => vi.stubGlobal('document', { body: {} }));
afterEach(() => vi.unstubAllGlobals());

describe('release popup', () => {
  it('shows the version, notes, safe GitHub link and accessible dismissal controls', () => {
    const markup = renderToStaticMarkup(
      <ReleaseAnnouncement release={metadata} onClose={vi.fn()} />,
    );
    expect(markup).toContain('<dialog');
    expect(markup).toContain('aria-modal="true"');
    expect(markup).toContain('>Version 0.2.0</h2>');
    expect(markup).toContain(metadata.title);
    expect(markup).toContain(metadata.summary);
    expect(markup.match(/<li>/g)).toHaveLength(metadata.changes.length);
    expect(markup).toContain(`href="${metadata.url}"`);
    expect(markup).toContain('target="_blank" rel="noopener noreferrer"');
    expect(markup).toContain('aria-label="Close Version 0.2.0"');
    expect(markup).toContain('>Got it</button>');
  });

  it('renders release notes as text rather than executable HTML', () => {
    const markup = renderToStaticMarkup(
      <ReleaseAnnouncement
        release={{ ...metadata, changes: ['<script>alert(1)</script>'] }}
        onClose={vi.fn()}
      />,
    );
    expect(markup).toContain('&lt;script&gt;');
    expect(markup).not.toContain('<script>');
  });
});

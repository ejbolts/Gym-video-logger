import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NotificationDialog } from './NotificationDialog';

// Check the popup's rendered content without a browser or a real portal target.
vi.mock('react-dom', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-dom')>()),
  createPortal: (children: ReactNode) => children,
}));

beforeEach(() => vi.stubGlobal('document', { body: {} }));
afterEach(() => vi.unstubAllGlobals());

describe('app notification popup', () => {
  it.each(['Workout CSV exported.', 'Could not export workout data.'])(
    'renders a popup for the message: %s',
    (message) => {
      const markup = renderToStaticMarkup(
        <NotificationDialog message={message} onClose={() => undefined} />,
      );
      expect(markup).toContain('<dialog');
      expect(markup).toContain('class="notification-dialog"');
      expect(markup).toContain(message);
      expect(markup).not.toContain('status-banner');
    },
  );

  it('provides an accessible title, description, and both dismissal controls', () => {
    const markup = renderToStaticMarkup(
      <NotificationDialog message="Body measurement saved." onClose={() => undefined} />,
    );
    expect(markup).toContain('aria-modal="true"');
    const titleId = markup.match(/aria-labelledby="([^"]+)"/)?.[1];
    const messageId = markup.match(/aria-describedby="([^"]+)"/)?.[1];
    expect(titleId).toBeTruthy();
    expect(messageId).toBeTruthy();
    expect(markup).toContain(`<h2 id="${titleId}">Notification</h2>`);
    expect(markup).toContain(`<p id="${messageId}">Body measurement saved.</p>`);
    expect(markup).toContain('aria-label="Close notification"');
    expect(markup).toContain('>OK</button>');
  });

  it('treats message content as text, not markup', () => {
    const markup = renderToStaticMarkup(
      <NotificationDialog message={'Could not import <script>.'} onClose={() => undefined} />,
    );
    expect(markup).toContain('Could not import &lt;script&gt;.');
    expect(markup).not.toContain('<script>');
  });
});

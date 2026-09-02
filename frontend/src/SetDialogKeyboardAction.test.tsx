import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SetDialogKeyboardAction } from './SetDialogKeyboardAction';

describe('set dialog keyboard action', () => {
  it('renders a labelled Add action instead of an icon-only confirmation', () => {
    const markup = renderToStaticMarkup(<SetDialogKeyboardAction label="Add" />);

    expect(markup).toContain('class="set-dialog-keyboard-action"');
    expect(markup).toContain('aria-label="Add set"');
    expect(markup).toContain('>Add</button>');
    expect(markup).not.toContain('✓');
  });

  it('can submit edits with a Save label', () => {
    const markup = renderToStaticMarkup(
      <SetDialogKeyboardAction label="Save" submit form="set-editor" />,
    );

    expect(markup).toContain('type="submit"');
    expect(markup).toContain('form="set-editor"');
    expect(markup).toContain('aria-label="Save set"');
  });
});

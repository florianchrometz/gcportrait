// SPDX-License-Identifier: Apache-2.0
/**
 * The Copy link button (views/CopyLink.tsx): the diagram's URL with its hash to the clipboard, and a toast;
 * a refusal said in words; inert away from the diagram page.
 */
import { screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { stubClipboard } from '../test/clipboard';
import { viewLink } from './CopyLink';
import { inTopBar, renderControls } from './testing/controls';

describe('Copy link', () => {
  it('copies the diagram’s URL with its hash and says so in a toast', async () => {
    const writeText = stubClipboard();
    renderControls('/diagram#snapshot=demo:S&lens=data', { workers: false });
    await userEvent.click(inTopBar().getByRole('button', { name: 'Copy link' }));
    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/diagram#snapshot=demo:S&lens=data`);
    await waitFor(() => {
      expect(screen.getByText('Link copied to the clipboard.').getAttribute('role')).toBe('status');
    });
  });

  it('links the diagram page with the hash, below the app’s base path', () => {
    expect(viewLink('', 'https://example.com/app?x=1')).toBe('https://example.com/diagram');
    // The static demo, below /demo/: the link keeps the base path.
    expect(viewLink('snapshot=demo:M', 'https://gcportrait.app/demo/settings', '/demo/')).toBe(
      'https://gcportrait.app/demo/diagram#snapshot=demo:M',
    );
  });

  it('says when the browser refuses, and is inert away from the diagram page', async () => {
    stubClipboard(() => Promise.reject(new Error('no')));
    const app = renderControls('/diagram#snapshot=demo:S', { workers: false });
    await userEvent.click(inTopBar().getByRole('button', { name: 'Copy link' }));
    await screen.findByText('The browser did not allow copying: copy the address bar instead.');
    app.unmount();
    renderControls('/settings', { workers: false });
    expect(inTopBar().getByRole('button', { name: 'Copy link' }).getAttribute('aria-disabled')).toBe('true');
  });
});

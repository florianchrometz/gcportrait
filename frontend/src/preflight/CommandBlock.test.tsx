// SPDX-License-Identifier: Apache-2.0
/**
 * The CommandBlock component: renders command with variables, and copies resolved command to clipboard with status.
 */
import { render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { stubClipboard } from '../test/clipboard';
import { CommandBlock } from './CommandBlock';

describe('CommandBlock', () => {
  const command = 'gcloud services enable cloudasset.googleapis.com --project=my-project';

  it('copies the command to the clipboard and updates status', async () => {
    const writeText = stubClipboard();
    render(<CommandBlock command={command} />);

    await userEvent.click(screen.getByRole('button', { name: /Copy the command/ }));
    expect(writeText).toHaveBeenCalledWith(command);
    await waitFor(() => {
      expect(screen.getByRole('status').textContent).toBe('Copied.');
    });
  });

  it('reports failure when clipboard API is unavailable', async () => {
    render(<CommandBlock command={command} />);

    await userEvent.click(screen.getByRole('button', { name: /Copy the command/ }));
    await waitFor(() => {
      expect(screen.getByRole('status').textContent).toBe(
        'Copying is not available here: select the command instead.',
      );
    });
  });

  it('reports failure when browser denies clipboard access', async () => {
    stubClipboard(() => Promise.reject(new Error('Permission denied')));
    render(<CommandBlock command={command} />);

    await userEvent.click(screen.getByRole('button', { name: /Copy the command/ }));
    await waitFor(() => {
      expect(screen.getByRole('status').textContent).toBe(
        'The browser did not allow copying: select the command instead.',
      );
    });
  });
});

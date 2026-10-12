// SPDX-License-Identifier: MIT
import type { ReactElement } from 'react';

import { usePopover } from '../../state';
import { THEME_PREFERENCE_LABELS, THEME_PREFERENCES } from '../../theme/theme';
import { useTheme } from '../../theme/useTheme';
import type { MenuItem } from '../../ui/Menu';
import { MenuButton } from '../../ui/MenuButton';

/**
 * The top bar's Theme menu: a menu button (ui/MenuButton) with three radio items,
 * System, Light and Dark, the chosen one checked. It sets the same preference as the Settings page (`useTheme`:
 * stored in IndexedDB, mirrored for the first paint), so the two always agree; "System" follows the operating
 * system's light or dark setting. One popup at a time, like the other top-bar menus (the store's `ui.popover`).
 */
export function ThemeToggle(): ReactElement {
  const { preference, setPreference } = useTheme();
  const [open, setOpen] = usePopover('theme');
  const items: MenuItem[] = THEME_PREFERENCES.map((option) => ({
    id: option,
    label: THEME_PREFERENCE_LABELS[option],
    kind: 'radio',
    checked: option === preference,
    onSelect: () => {
      setPreference(option);
    },
  }));
  return <MenuButton label="Theme" align="end" open={open} onOpenChange={setOpen} items={items} />;
}

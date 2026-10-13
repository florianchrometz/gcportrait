// SPDX-License-Identifier: MIT
/**
 * A search result's icon: the artwork the canvas draws the node with (resolved in the data worker, sent with
 * the answer), 16 px inside a 20 px box, decorative. On the dark theme Google's colour and grey marks sit on the
 * same light plate the diagram gives them (skill gcp-diagram-style §2, "Rules for dark"); the artwork itself is
 * never altered (AGENTS.md, Style and accessibility).
 */
import type { Icon } from '@gcportrait/icons';
import type { ReactElement } from 'react';

import { placeIconMarkup } from '../diagram/icons';
import { ICON_PLATE } from '../diagram/theme/tokens';
import type { ResolvedTheme } from '../theme/theme';

const BOX = 20;
const SIZE = 16;

export function ResultIcon({
  icon,
  theme,
}: {
  readonly icon: Icon;
  readonly theme: ResolvedTheme;
}): ReactElement {
  const inset = (BOX - SIZE) / 2;
  return (
    <svg
      width={BOX}
      height={BOX}
      viewBox={`0 0 ${String(BOX)} ${String(BOX)}`}
      aria-hidden="true"
      focusable="false"
      data-icon={icon.key}
    >
      {theme === 'dark' && icon.plateOnDark ? (
        <rect
          width={BOX}
          height={BOX}
          rx={ICON_PLATE.radius}
          fill={ICON_PLATE.fill}
          fillOpacity={ICON_PLATE.opacity}
        />
      ) : null}
      <g dangerouslySetInnerHTML={{ __html: placeIconMarkup(icon, SIZE, inset, inset) }} />
    </svg>
  );
}

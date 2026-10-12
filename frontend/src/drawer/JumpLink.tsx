// SPDX-License-Identifier: MIT
/** The drawer's jump link: a link-styled button that selects a node, its id as the tooltip. */
import type { ReactElement } from 'react';

import styles from './DetailsDrawer.module.css';
import type { NodeRef } from './types';

export function JumpLink({
  target,
  onJump,
}: {
  readonly target: NodeRef;
  readonly onJump: (target: NodeRef) => void;
}): ReactElement {
  return (
    <button
      type="button"
      className={styles.jump}
      title={target.id}
      onClick={() => {
        onJump(target);
      }}
    >
      {target.label}
    </button>
  );
}

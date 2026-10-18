// SPDX-License-Identifier: Apache-2.0
import { Link } from 'react-router';

import page from './Page.module.css';
import { useDocumentTitle } from './useDocumentTitle';

export function NotFoundPage() {
  useDocumentTitle('Page not found');
  return (
    <div className={page.page}>
      <div className={page.intro}>
        <h1 className={page.title}>Page not found</h1>
        <p className={page.lead}>
          There is nothing at this address. Start again from the <Link to="/">Connect</Link> page.
        </p>
      </div>
    </div>
  );
}

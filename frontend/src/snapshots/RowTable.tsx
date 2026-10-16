// SPDX-License-Identifier: MIT
/**
 * The rows of the Snapshots page's tables (SnapshotTable.tsx, ScopeTimelines.tsx), drawn from one list of columns
 * (AGENTS.md, Product rules): a table on a tablet and a desktop; on a phone, where a row of five or seven columns
 * could be read only by scrolling it sideways, a list of cards, one per row, each column a labelled line of a
 * description list (its header, then its cell) with the row's actions under them, as wide as the page. Both come from
 * the same columns and the same `actions`, and only one of them is drawn at a time, so a card shows the row's facts
 * under the table's own words and its buttons are the row's, under the same accessible names.
 */
import { Fragment, type ReactElement, type ReactNode } from 'react';

import { cx } from '../classNames';
import { useScreen } from '../ui/screen';
import styles from './Snapshots.module.css';

/** A row's data attributes (`data-snapshot`, `data-entry`, …), on its table row or its card alike. */
export type RowData = Readonly<Record<`data-${string}`, string>>;

export interface RowColumn<Row> {
  /** The column's header in the table, and the label of its line on a card. */
  readonly header: string;
  /** A number: right-aligned in tabular figures in the table. */
  readonly numeric?: boolean;
  /** Kept on one line in the table (a time). */
  readonly nowrap?: boolean;
  readonly cell: (row: Row) => ReactNode;
}

export interface RowTableProps<Row> {
  /** What the rows are: the table's caption, and the name of the list of cards. */
  readonly caption: string;
  /** The columns in order; the first one's cell is the row's header. */
  readonly columns: readonly RowColumn<Row>[];
  readonly rows: readonly Row[];
  readonly keyOf: (row: Row) => string;
  readonly dataOf: (row: Row) => RowData;
  /** The row's buttons, or null for none. */
  readonly actions: (row: Row) => ReactElement | null;
}

export function RowTable<Row>(props: RowTableProps<Row>): ReactElement {
  return useScreen() === 'phone' ? <RowCards {...props} /> : <RowRows {...props} />;
}

/** A cell's classes in the table: a number's alignment, a time kept on one line. */
function cellClass<Row>(column: RowColumn<Row>): string | undefined {
  const names = cx(column.numeric === true && styles.number, column.nowrap === true && styles.nowrap);
  return names === '' ? undefined : names;
}

function RowRows<Row>({ caption, columns, rows, keyOf, dataOf, actions }: RowTableProps<Row>): ReactElement {
  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <caption className="visually-hidden">{caption}</caption>
        <thead>
          <tr>
            {columns.map((column) => (
              <th
                key={column.header}
                scope="col"
                className={column.numeric === true ? styles.number : undefined}
              >
                {column.header}
              </th>
            ))}
            <th scope="col">
              <span className="visually-hidden">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const buttons = actions(row);
            return (
              <tr key={keyOf(row)} {...dataOf(row)}>
                {columns.map((column, index) =>
                  index === 0 ? (
                    <th key={column.header} scope="row" className={cellClass(column)}>
                      {column.cell(row)}
                    </th>
                  ) : (
                    <td key={column.header} className={cellClass(column)}>
                      {column.cell(row)}
                    </td>
                  ),
                )}
                <td>{buttons === null ? null : <div className={styles.actions}>{buttons}</div>}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function RowCards<Row>({ caption, columns, rows, keyOf, dataOf, actions }: RowTableProps<Row>): ReactElement {
  return (
    <ul className={styles.cards} aria-label={caption}>
      {rows.map((row) => {
        const buttons = actions(row);
        return (
          <li key={keyOf(row)} className={styles.card} {...dataOf(row)}>
            <dl className={styles.facts}>
              {columns.map((column, index) => (
                <Fragment key={column.header}>
                  <dt>{column.header}</dt>
                  <dd className={index === 0 ? styles.head : undefined}>{column.cell(row)}</dd>
                </Fragment>
              ))}
            </dl>
            {buttons === null ? null : (
              <div className={cx(styles.actions, styles.cardActions)}>{buttons}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

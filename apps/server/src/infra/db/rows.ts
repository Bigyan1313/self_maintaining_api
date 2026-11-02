/**
 * Returns the single row produced by an `INSERT … RETURNING` / `UPDATE … RETURNING`.
 *
 * @param rows - Rows returned by the query.
 * @param what - Description used in the error message.
 * @throws Error when no row was returned.
 */
export function one<T>(rows: T[], what: string): T {
  const row = rows[0];
  if (row === undefined) throw new Error(`Expected one ${what} row, got none`);
  return row;
}

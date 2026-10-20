export type BulkSuccess<T, R> = {id: string; row: T; result: R};
export type BulkFailure<T> = {id: string; row: T; error: string};
export type BulkResult<T, R> = {
  total: number;
  successIds: string[];
  failedIds: string[];
  successes: BulkSuccess<T, R>[];
  failures: BulkFailure<T>[];
};

/** Execute only the supplied selection; each ID is attempted once per batch. */
export async function runBulkActions<T extends {id: string}, R>(rows: T[], action: (row: T) => Promise<R>, options: {concurrency?: number} = {}): Promise<BulkResult<T, R>> {
  const unique = [...new Map(rows.map(row => [row.id, row])).values()];
  const requested = options.concurrency ?? 3;
  const concurrency = Number.isFinite(requested) ? Math.max(1, Math.min(3, Math.trunc(requested))) : 3;
  const successes: (BulkSuccess<T, R> | undefined)[] = new Array(unique.length);
  const failures: (BulkFailure<T> | undefined)[] = new Array(unique.length);
  let next = 0;
  async function worker() {
    while (next < unique.length) {
      const index = next++, row = unique[index];
      try {successes[index] = {id: row.id, row, result: await action(row)};}
      catch (reason) {failures[index] = {id: row.id, row, error: reason instanceof Error ? reason.message || '操作失败，请重试' : typeof reason === 'string' && reason ? reason : '操作失败，请重试'};}
    }
  }
  await Promise.all(Array.from({length: Math.min(concurrency, unique.length)}, worker));
  const completed = successes.filter((value): value is BulkSuccess<T, R> => value !== undefined);
  const rejected = failures.filter((value): value is BulkFailure<T> => value !== undefined);
  return {total: unique.length, successes: completed, failures: rejected, successIds: completed.map(value => value.id), failedIds: rejected.map(value => value.id)};
}

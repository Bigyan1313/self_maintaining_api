/** Serial in-process queue shared by URL checks, uploads, and scheduled checks. */
export class CheckQueue {
  private tail: Promise<unknown> = Promise.resolve();
  /** Enqueue one task; a failed task cannot poison the next one. */
  run<T>(task: () => Promise<T>): Promise<T> {
    const next = this.tail.then(task);
    this.tail = next.catch(() => undefined);
    return next;
  }
  /** Wait for shutdown without abandoning a current check. */
  async drain(): Promise<void> {
    await this.tail;
  }
}
/** Optional polling configuration, absent/null means disabled. */
export interface PollApi {
  id: string;
  pollIntervalSeconds: number | null;
}
/** Poll coordinator; a single tick may be in flight, with no catch-up burst after a slow check. */
export class SpecPoller {
  private due = new Map<string, number>();
  private busy = false;
  constructor(
    private readonly queue: CheckQueue,
    private readonly list: () => Promise<PollApi[]>,
    private readonly check: (id: string) => Promise<unknown>,
    private readonly clock: () => number = Date.now,
  ) {}
  /** Poll enabled APIs when due. Reject malformed intervals instead of busy-looping. */
  async tick(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      const apis = await this.list();
      const enabled = new Set(
        apis.filter((api) => api.pollIntervalSeconds !== null).map((api) => api.id),
      );
      for (const id of this.due.keys()) if (!enabled.has(id)) this.due.delete(id);
      for (const api of apis) {
        if (api.pollIntervalSeconds === null) continue;
        if (!Number.isInteger(api.pollIntervalSeconds) || api.pollIntervalSeconds < 60)
          throw new Error('Poll interval must be at least 60 seconds');
        const due = this.due.get(api.id);
        if (due === undefined) {
          this.due.set(api.id, this.clock() + api.pollIntervalSeconds * 1000);
          continue;
        }
        if (this.clock() < due) continue;
        try {
          await this.queue.run(() => this.check(api.id));
        } finally {
          this.due.set(api.id, this.clock() + api.pollIntervalSeconds * 1000);
        }
      }
    } finally {
      this.busy = false;
    }
  }
}

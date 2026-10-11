/**
 * Grace-window batching for shopping mode (pure; no React, no network).
 *
 * Every check-off is saved right away (PATCH, persisted on the server). Moving the checked rows into the cabinet is a
 * separate, group-wide server transaction (POST /shopping-list/complete). The batcher decides WHEN to call it:
 *
 *  - `checked(id)` adds the row to the pending batch and (re)starts the grace timer (default 4 s): a quick run of
 *    check-offs becomes one completion.
 *  - `unchecked(id)` (Undo) drops it from the batch; an empty batch cancels the timer.
 *  - `adopt(ids)` takes rows that were already checked when the screen opened (left over from a closed app).
 *  - `flush()` completes as soon as it is safe (Done button, leaving the screen, app going to the background).
 *  - Safety: completion never starts while a check/uncheck request is in flight (`track`), never runs twice at once
 *    (requests made meanwhile are coalesced into one follow-up), and never runs with an empty batch.
 *  - A failed completion keeps the batch and retries with back-off, at most `maxRetries` times in a row; the rows stay
 *    checked on the server, so the next visit adopts and completes them.
 */

export const GRACE_MS = 4000;
const MAX_RETRY_MS = 30_000;

export type TripBatcherOptions = {
  /** Calls the server; resolves with the number of rows moved to the cabinet. */
  complete: () => Promise<number>;
  graceMs?: number;
  maxRetries?: number;
};

export type TripBatcherListener = {
  /** `ids`: the rows this batch covered (the server may move more, e.g. rows another member checked). */
  onCompleted?: (moved: number, ids: string[]) => void;
  onError?: (error: unknown, willRetry: boolean) => void;
  /** A tracked check-off failed and was rolled back; the row is no longer pending. */
  onCheckFailed?: (id: string, checked: boolean, error: unknown) => void;
  /** Any observable state changed (pending, completing, scheduled). */
  onChange?: () => void;
};

export type TripBatcherSnapshot = {
  pending: string[];
  completing: boolean;
  inflight: number;
  scheduled: boolean;
  lastChecked: string | null;
};

export class TripBatcher {
  private readonly pending = new Set<string>();
  /** ids covered by the completion currently in flight */
  private completingIds = new Set<string>();
  private completing = false;
  private inflight = 0;
  private flushWanted = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private failures = 0;
  private lastChecked: string | null = null;
  private listener: TripBatcherListener = {};
  private readonly graceMs: number;
  private readonly maxRetries: number;

  constructor(private readonly opts: TripBatcherOptions) {
    this.graceMs = opts.graceMs ?? GRACE_MS;
    this.maxRetries = opts.maxRetries ?? 3;
  }

  setListener(listener: TripBatcherListener | null) {
    this.listener = listener ?? {};
  }

  snapshot(): TripBatcherSnapshot {
    return {
      pending: [...this.pending],
      completing: this.completing,
      inflight: this.inflight,
      scheduled: this.timer !== null,
      lastChecked: this.lastChecked,
    };
  }

  isPending(id: string) {
    return this.pending.has(id);
  }

  /** Undo is possible while the row is pending and not part of a completion already on its way. */
  canUndo(id: string) {
    return this.pending.has(id) && !this.completingIds.has(id);
  }

  checked(id: string) {
    this.failures = 0;
    this.pending.add(id);
    this.lastChecked = id;
    this.schedule(this.graceMs);
    this.changed();
  }

  unchecked(id: string) {
    if (!this.canUndo(id)) return false;
    this.pending.delete(id);
    if (this.lastChecked === id) this.lastChecked = null;
    if (this.pending.size === 0) {
      this.clearTimer();
      this.flushWanted = false;
    }
    this.changed();
    return true;
  }

  /** Rows found already checked (e.g. on opening the screen). Starts the grace timer if anything new was added. */
  adopt(ids: string[]) {
    let added = false;
    for (const id of ids) {
      if (this.pending.has(id) || this.completingIds.has(id)) continue;
      this.pending.add(id);
      added = true;
    }
    if (!added) return;
    if (!this.timer && !this.completing) this.schedule(this.graceMs);
    this.changed();
  }

  /**
   * Track a check/uncheck request. Completion waits until every tracked request has settled. A failed request means
   * the server never saw the change, so the batch is corrected (a failed check leaves it, a failed uncheck rejoins it).
   */
  track<T>(id: string, checked: boolean, request: Promise<T>): Promise<T> {
    this.inflight += 1;
    this.changed();
    return request.then(
      (v) => {
        this.settle();
        return v;
      },
      (err: unknown) => {
        if (checked) {
          this.pending.delete(id);
          if (this.lastChecked === id) this.lastChecked = null;
        } else {
          this.pending.add(id);
          if (!this.timer && !this.completing) this.schedule(this.graceMs);
        }
        this.listener.onCheckFailed?.(id, checked, err);
        this.settle();
        throw err;
      },
    );
  }

  /** Complete as soon as it is safe (no check in flight, no completion running). */
  flush() {
    this.clearTimer();
    if (this.pending.size === 0 && !this.completing) {
      this.flushWanted = false;
      this.changed();
      return;
    }
    this.flushWanted = true;
    this.failures = 0;
    this.tryRun();
  }

  /** Stop timers (e.g. tests). Pending rows stay checked on the server. */
  dispose() {
    this.clearTimer();
    this.listener = {};
  }

  private settle() {
    this.inflight = Math.max(0, this.inflight - 1);
    this.changed();
    if (this.inflight === 0) this.tryRun();
  }

  private schedule(ms: number) {
    this.clearTimer();
    this.timer = setTimeout(() => {
      this.timer = null;
      this.flushWanted = true;
      this.tryRun();
    }, ms);
  }

  private clearTimer() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private tryRun() {
    if (!this.flushWanted || this.completing || this.inflight > 0) {
      this.changed();
      return;
    }
    if (this.pending.size === 0) {
      this.flushWanted = false;
      this.changed();
      return;
    }
    this.flushWanted = false;
    this.completing = true;
    this.completingIds = new Set(this.pending);
    this.changed();
    let request: Promise<number>;
    try {
      request = this.opts.complete();
    } catch (err) {
      request = Promise.reject(err);
    }
    request.then(
      (moved) => {
        const ids = [...this.completingIds];
        for (const id of ids) this.pending.delete(id);
        if (this.lastChecked && !this.pending.has(this.lastChecked)) this.lastChecked = null;
        this.completingIds = new Set();
        this.completing = false;
        this.failures = 0;
        this.listener.onCompleted?.(moved, ids);
        this.afterRun();
      },
      (err: unknown) => {
        this.completingIds = new Set();
        this.completing = false;
        this.failures += 1;
        const willRetry = this.failures <= this.maxRetries;
        this.listener.onError?.(err, willRetry);
        if (willRetry) {
          this.schedule(Math.min(this.graceMs * 2 ** (this.failures - 1), MAX_RETRY_MS));
          this.flushWanted = false;
        } else {
          this.flushWanted = false;
        }
        this.changed();
      },
    );
  }

  /** Rows checked while the completion was running form the next batch. */
  private afterRun() {
    if (this.pending.size > 0) {
      if (this.flushWanted) this.tryRun();
      else if (!this.timer) this.schedule(this.graceMs);
    } else {
      this.flushWanted = false;
    }
    this.changed();
  }

  private changed() {
    this.listener.onChange?.();
  }
}

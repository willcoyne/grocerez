import { GRACE_MS, TripBatcher } from "../tripBatcher";

type Deferred<T> = { promise: Promise<T>; resolve: (v: T) => void; reject: (e: unknown) => void };
function deferred<T>(): Deferred<T> {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Let promise callbacks run (fake timers don't advance microtasks by themselves). */
const flushMicrotasks = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

function setup(graceMs = GRACE_MS) {
  const calls: Deferred<number>[] = [];
  const complete = jest.fn(() => {
    const d = deferred<number>();
    calls.push(d);
    return d.promise;
  });
  const b = new TripBatcher({ complete, graceMs });
  const completed: [number, string[]][] = [];
  const errors: boolean[] = [];
  const checkFailed: string[] = [];
  b.setListener({
    onCompleted: (n, ids) => completed.push([n, ids]),
    onError: (_e, willRetry) => errors.push(willRetry),
    onCheckFailed: (id) => checkFailed.push(id),
  });
  return { b, complete, calls, completed, errors, checkFailed };
}

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

describe("TripBatcher", () => {
  it("completes once after the grace window, batching quick check-offs and resetting the timer on each", async () => {
    const { b, complete, calls, completed } = setup();
    b.checked("a");
    jest.advanceTimersByTime(3000);
    b.checked("b"); // resets the 4 s timer
    jest.advanceTimersByTime(3500);
    expect(complete).not.toHaveBeenCalled();
    jest.advanceTimersByTime(500);
    expect(complete).toHaveBeenCalledTimes(1);
    calls[0].resolve(2);
    await flushMicrotasks();
    expect(completed).toEqual([[2, ["a", "b"]]]);
    expect(b.snapshot()).toMatchObject({ pending: [], completing: false, scheduled: false });
  });

  it("undo removes the item; undoing everything cancels the completion", () => {
    const { b, complete } = setup();
    b.checked("a");
    b.checked("b");
    expect(b.unchecked("a")).toBe(true);
    expect(b.snapshot().pending).toEqual(["b"]);
    expect(b.unchecked("b")).toBe(true);
    expect(b.snapshot().scheduled).toBe(false);
    jest.advanceTimersByTime(GRACE_MS * 2);
    expect(complete).not.toHaveBeenCalled();
  });

  it("never completes while a check request is in flight; it waits and then runs once", async () => {
    const { b, complete, calls } = setup();
    const req = deferred<unknown>();
    b.checked("a");
    void b.track("a", true, req.promise);
    jest.advanceTimersByTime(GRACE_MS);
    expect(complete).not.toHaveBeenCalled();
    b.flush(); // Done pressed while still saving
    expect(complete).not.toHaveBeenCalled();
    req.resolve({});
    await flushMicrotasks();
    expect(complete).toHaveBeenCalledTimes(1);
    calls[0].resolve(1);
    await flushMicrotasks();
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it("dedupes: flushes during a running completion coalesce into one follow-up for items checked meanwhile", async () => {
    const { b, complete, calls, completed } = setup();
    b.checked("a");
    b.flush();
    expect(complete).toHaveBeenCalledTimes(1);
    expect(b.canUndo("a")).toBe(false); // already on its way
    expect(b.unchecked("a")).toBe(false);
    b.flush();
    b.flush();
    b.checked("b");
    b.flush();
    expect(complete).toHaveBeenCalledTimes(1);
    calls[0].resolve(1);
    await flushMicrotasks();
    expect(complete).toHaveBeenCalledTimes(2);
    calls[1].resolve(1);
    await flushMicrotasks();
    expect(completed).toEqual([
      [1, ["a"]],
      [1, ["b"]],
    ]);
    b.flush();
    expect(complete).toHaveBeenCalledTimes(2); // nothing pending → no call
  });

  it("items checked during a completion form the next batch after a fresh grace window", async () => {
    const { b, complete, calls } = setup();
    b.checked("a");
    jest.advanceTimersByTime(GRACE_MS);
    expect(complete).toHaveBeenCalledTimes(1);
    b.checked("b");
    calls[0].resolve(1);
    await flushMicrotasks();
    expect(b.snapshot().pending).toEqual(["b"]);
    jest.advanceTimersByTime(GRACE_MS - 1);
    expect(complete).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(1);
    expect(complete).toHaveBeenCalledTimes(2);
  });

  it("adopts leftover checked rows on open and completes them after the grace", () => {
    const { b, complete } = setup();
    b.adopt(["x", "y"]);
    b.adopt(["x"]); // no duplicate
    expect(b.snapshot().pending).toEqual(["x", "y"]);
    jest.advanceTimersByTime(GRACE_MS);
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it("a failed check-off leaves the batch; a failed undo rejoins it", async () => {
    const { b, complete, checkFailed } = setup();
    b.checked("a");
    const req = deferred<unknown>();
    b.track("a", true, req.promise).catch(() => {});
    req.reject(new Error("offline"));
    await flushMicrotasks();
    expect(checkFailed).toEqual(["a"]);
    expect(b.snapshot().pending).toEqual([]);
    jest.advanceTimersByTime(GRACE_MS);
    expect(complete).not.toHaveBeenCalled(); // empty batch is never completed

    b.checked("b");
    b.unchecked("b");
    const undo = deferred<unknown>();
    b.track("b", false, undo.promise).catch(() => {});
    undo.reject(new Error("offline"));
    await flushMicrotasks();
    expect(b.snapshot().pending).toEqual(["b"]);
    jest.advanceTimersByTime(GRACE_MS);
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it("retries a failed completion with back-off, then gives up (rows stay checked on the server)", async () => {
    const { b, complete, calls, errors } = setup(1000);
    b.checked("a");
    b.flush();
    calls[0].reject(new Error("500"));
    await flushMicrotasks();
    expect(errors).toEqual([true]);
    expect(b.snapshot().pending).toEqual(["a"]);
    jest.advanceTimersByTime(1000);
    expect(complete).toHaveBeenCalledTimes(2);
    calls[1].reject(new Error("500"));
    await flushMicrotasks();
    jest.advanceTimersByTime(1999);
    expect(complete).toHaveBeenCalledTimes(2);
    jest.advanceTimersByTime(1);
    expect(complete).toHaveBeenCalledTimes(3);
    calls[2].reject(new Error("500"));
    await flushMicrotasks();
    jest.advanceTimersByTime(4000);
    expect(complete).toHaveBeenCalledTimes(4);
    calls[3].reject(new Error("500"));
    await flushMicrotasks();
    expect(errors).toEqual([true, true, true, false]);
    jest.advanceTimersByTime(60_000);
    expect(complete).toHaveBeenCalledTimes(4);
    expect(b.snapshot().pending).toEqual(["a"]);
  });

  it("flush on leave completes immediately without waiting for the grace", () => {
    const { b, complete } = setup();
    b.checked("a");
    b.flush();
    expect(complete).toHaveBeenCalledTimes(1);
  });
});

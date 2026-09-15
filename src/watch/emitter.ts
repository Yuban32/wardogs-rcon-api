/**
 * A small async queue backing the watcher's `for await` interface.
 *
 * Deliberately not Node's `EventEmitter`: this library ships a UMD build for
 * `<script>` tags, and pulling in a Node module — or a shim of one — to emit
 * three event types is not a trade worth making. Everything here is a plain
 * array and promise, so it behaves identically in every runtime.
 */

export class AsyncQueue<T> implements AsyncIterable<T> {
  private readonly buffered: T[] = [];
  private readonly waiting: ((result: IteratorResult<T>) => void)[] = [];
  private closed = false;

  /** Number of values waiting to be consumed. */
  get size(): number {
    return this.buffered.length;
  }

  get isClosed(): boolean {
    return this.closed;
  }

  /**
   * Enqueues a value, handing it straight to a waiting consumer if there is
   * one. Values pushed without a consumer are buffered.
   */
  push(value: T): void {
    if (this.closed) return;

    const waiter = this.waiting.shift();
    if (waiter !== undefined) {
      waiter({ value, done: false });
      return;
    }
    this.buffered.push(value);
  }

  /**
   * Discards and returns the oldest buffered value.
   *
   * Only removes what is already buffered — a value handed directly to a
   * waiting consumer never enters the buffer, so there is nothing to drop.
   * Returns `undefined` when the buffer is empty.
   */
  shift(): T | undefined {
    return this.buffered.shift();
  }

  /**
   * Closes the queue.
   *
   * Any buffered values are still delivered before the iterator completes, so
   * a consumer that stops a watcher does not lose the last snapshot.
   */
  close(): void {
    if (this.closed) return;
    this.closed = true;

    while (this.waiting.length > 0) {
      const waiter = this.waiting.shift()!;
      waiter({ value: undefined, done: true });
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: (): Promise<IteratorResult<T>> => {
        const buffered = this.buffered.shift();
        if (buffered !== undefined) {
          return Promise.resolve({ value: buffered, done: false });
        }
        if (this.closed) {
          return Promise.resolve({ value: undefined, done: true });
        }
        return new Promise<IteratorResult<T>>((resolve) => {
          this.waiting.push(resolve);
        });
      },
      return: (): Promise<IteratorResult<T>> => {
        this.close();
        return Promise.resolve({ value: undefined, done: true });
      },
    };
  }
}

/**
 * A typed listener registry.
 *
 * `on` returns an unsubscribe function, which keeps cleanup at the call site
 * to one line and removes the need to hold a reference to the handler.
 *
 * The constraint is `object` rather than `Record<string, unknown>`: an
 * interface of named event keys does not carry an index signature, so the
 * stricter-looking constraint would reject every interface a caller might
 * reasonably define for its events.
 */
export class Emitter<Events extends object> {
  private readonly listeners = new Map<keyof Events, Set<(payload: never) => void>>();

  /** Registers a listener. Returns a function that removes it. */
  on<K extends keyof Events>(event: K, listener: (payload: Events[K]) => void): () => void {
    let set = this.listeners.get(event);
    if (set === undefined) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(listener as (payload: never) => void);

    return () => {
      this.off(event, listener);
    };
  }

  /** Removes a previously registered listener. */
  off<K extends keyof Events>(event: K, listener: (payload: Events[K]) => void): void {
    this.listeners.get(event)?.delete(listener as (payload: never) => void);
  }

  /** Removes every listener, for every event. */
  clear(): void {
    this.listeners.clear();
  }

  /** How many listeners are registered for an event. */
  count<K extends keyof Events>(event: K): number {
    return this.listeners.get(event)?.size ?? 0;
  }

  /**
   * Invokes every listener for an event.
   *
   * A listener that throws is reported to `onListenerError` rather than
   * allowed to escape: one broken UI callback must not stop the others from
   * receiving the same event, nor kill the polling loop.
   */
  emit<K extends keyof Events>(
    event: K,
    payload: Events[K],
    onListenerError?: (error: unknown) => void,
  ): void {
    const set = this.listeners.get(event);
    if (set === undefined) return;

    // Copy first: a listener may unsubscribe during dispatch.
    for (const listener of Array.from(set)) {
      try {
        (listener as (value: Events[K]) => void)(payload);
      } catch (error) {
        onListenerError?.(error);
      }
    }
  }
}

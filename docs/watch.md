# Polling

There is no push channel. The API is request/response HTTP, so live data means polling, and `createWatcher` is that loop with change detection and error recovery around it.

[中文](watch.zh-CN.md) | **English**

```ts
const watcher = createWatcher(client, { intervalMs: 5000 });
watcher.start();
```

## Cadence

The reference asks for gentle polling and notes the official panel refreshes every 3–5 seconds. `intervalMs` defaults to `5000`.

There is no published rate limit, but going below ~3000 buys little: `matchSeconds` and score ticks move on second boundaries, so a faster poll mostly re-reads the same values. If you are behind a reverse proxy, its throttling is the practical ceiling.

**A tick costs one request.** `GET /v1/status` already carries the player count, faction scores and rotation indices, so a status watcher never needs a second call. `watchPlayers: true` adds `GET /v1/players` per tick to diff the roster — double the traffic, which is why it is opt-in.

The loop is a self-rescheduling `setTimeout`, not `setInterval`: a slow response delays the next tick rather than stacking requests on top of it.

## Events

| Event      | Fires                                                  | Payload           |
| ---------- | ------------------------------------------------------ | ----------------- |
| `snapshot` | Every successful tick                                  | `WatchSnapshot`   |
| `change`   | Only when the status differs from the previous tick    | `StatusChange`    |
| `players`  | Only when the roster differs — requires `watchPlayers` | `PlayerListDelta` |
| `error`    | A failed tick                                          | The error         |

`change` compares the documented fields and reports which ones moved:

```ts
watcher.on('change', ({ changed, snapshot, previous }) => {
  if (changed.includes('map')) console.log(`${previous.status.map} → ${snapshot.status.map}`);
});
```

`changed` is a convenience, not a contract: it covers the documented fields and will not see anything a server adds beyond them. Do not branch on it for correctness.

`players` distinguishes three transitions, keyed by SteamID64:

```ts
watcher.on('players', ({ joined, left, updated }) => {
  for (const p of joined) console.log(`${p.name} joined`);
  for (const p of left) console.log(`${p.name} left`);
  for (const p of updated) console.log(`${p.name} changed faction or stats`);
});
```

Every `on()` returns an unsubscribe function.

## Failures

A failed tick is emitted as `error` and the loop continues, backing off exponentially to 8× `intervalMs` and resetting on the first success. A transient blip should not end monitoring on a dashboard left running for days.

Two exceptions, both deliberate:

- **An auth failure stops the watcher.** A rejected credential will not start working on its own, and retrying it forever is pure noise against a server already refusing you. Call `start()` again after fixing the token.
- **`onError: 'stop'`** ends the watcher on any failure, if you would rather fail loudly.

An error caused by your own `stop()` is not reported — a cancellation is a shutdown, not a fault.

```ts
watcher.on('error', (error) => {
  // Log it; the loop is already retrying.
  console.error('poll failed:', error);
});
```

## Consumption

Events are one way. `for await` is the other:

```ts
for await (const snapshot of watcher) {
  render(snapshot.status);
}
```

Snapshots are buffered up to `maxBuffer` (default 100) and the oldest is dropped past that, so a stalled consumer cannot exhaust memory. A watcher's value is its latest state, not its history — if you need every transition, use events and handle them synchronously.

Iteration completes when the watcher stops, and any buffered snapshots are still delivered first.

## Shutdown

```ts
await watcher.stop();
```

`stop()` cancels the in-flight request, waits for it to settle, closes the iterator and clears listeners. Awaiting it means no further events will fire and no promise is left dangling — which matters in tests and on process exit.

You can also tie a watcher's lifetime to a signal:

```ts
const watcher = createWatcher(client, { signal: request.signal });
```

## Reading state without a request

```ts
watcher.getStatus(); // Status | null
watcher.getPlayers(); // Player[] — empty unless watchPlayers
watcher.getLast(); // WatchSnapshot | null
```

Useful for rendering on demand against the most recent tick instead of triggering a fetch per render.

## Full options

```ts
createWatcher(client, {
  intervalMs: 5000, // default
  watchPlayers: false, // also poll the roster
  immediate: true, // tick once on start rather than after one interval
  signal: undefined, // stop when this aborts
  maxBuffer: 100, // snapshots held for `for await`
  onError: 'backoff', // or 'stop'
  timeoutMs: undefined, // per-request timeout, forwarded to the client
});
```

## Using it without the client

`createWatcher` only needs two methods:

```ts
const watcher = createWatcher({ status: myStatusSource, players: myRosterSource });
```

`diffStatusFields` and `diffPlayers` are exported too, if you want the comparison without the loop.

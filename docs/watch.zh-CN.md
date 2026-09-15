# 轮询

接口没有推送通道。它就是一个请求/响应式的 HTTP API,所以想拿实时数据就得轮询,而 `createWatcher` 就是把这套循环、外加差分检测与错误恢复一起封装起来的东西。

```ts
const watcher = createWatcher(client, { intervalMs: 5000 });
watcher.start();
```

**中文** | [English](watch.md)

## 节奏

官方参考建议温和轮询,并指出管理面板自身是每 3–5 秒刷新一次。`intervalMs` 默认为 `5000`。

没有公布任何限流,但把间隔压到 3000 以下收益很小:`matchSeconds` 和得分结算都以秒为粒度变化,更快的轮询大多只是在重复读取同样的值。如果你前面还挡着反向代理,它的限流才是实际的上限。

**一次轮询只花一个请求。** `GET /v1/status` 本身就已经带回了玩家人数、阵营得分与轮换索引,所以只监听状态时永远不需要第二个请求。`watchPlayers: true` 会为每次轮询额外加上一个 `GET /v1/players` 用于差分名单 —— 流量翻倍,这正是它默认关闭的原因。

循环采用的是自我重排的 `setTimeout`,而不是 `setInterval`:响应变慢只会推迟下一次轮询,而不会把请求层层堆叠上去。

## 事件

| 事件       | 触发时机                                | 载荷              |
| ---------- | --------------------------------------- | ----------------- |
| `snapshot` | 每次成功轮询                            | `WatchSnapshot`   |
| `change`   | 仅当状态与上一次轮询不同                | `StatusChange`    |
| `players`  | 仅当名单发生变化 —— 需要 `watchPlayers` | `PlayerListDelta` |
| `error`    | 某次轮询失败                            | 该错误            |

`change` 会比较文档化的那些字段,并告诉你具体哪些动了:

```ts
watcher.on('change', ({ changed, snapshot, previous }) => {
  if (changed.includes('map')) console.log(`${previous.status.map} → ${snapshot.status.map}`);
});
```

`changed` 只是一个便利项,不是契约:它覆盖文档化的字段,但看不见服务器额外添加的任何内容。**不要**把它当作正确性判断的依据。

`players` 区分三种变化,全部以 SteamID64 为键:

```ts
watcher.on('players', ({ joined, left, updated }) => {
  for (const p of joined) console.log(`${p.name} 加入了`);
  for (const p of left) console.log(`${p.name} 离开了`);
  for (const p of updated) console.log(`${p.name} 更换了阵营或数据有变`);
});
```

每次 `on()` 都返回一个取消订阅的函数。

## 失败处理

失败的轮询会以 `error` 事件上报,循环继续,并按指数退避重试(最多到间隔的 8 倍),首次成功后复位。一个跑了几天的看板,不该因为一次网络抖动就停止监控。

只有两个例外,且都是刻意的:

- **鉴权失败会停止监视器。** 一个被拒绝的凭据不会自己变好,而对一台已经在拒绝你的服务器无限重试,纯粹是噪音。修好 token 后再次调用 `start()` 即可。
- **`onError: 'stop'`** 会在任何失败时结束监视器 —— 如果你更愿意让它响亮地失败。

由你自己调用 `stop()` 所导致的错误不会被上报 —— 取消是关闭,不是故障。

```ts
watcher.on('error', (error) => {
  // 记录即可;循环已经在重试了。
  console.error('轮询失败:', error);
});
```

## 消费方式

事件是一种方式,`for await` 是另一种:

```ts
for await (const snapshot of watcher) {
  render(snapshot.status);
}
```

快照会被缓冲,上限为 `maxBuffer`(默认 100),超出后丢弃最旧的,因此消费端即使卡住也不会耗尽内存。监视器的价值在于它的最新状态,而不是它的历史 —— 如果你需要每一次变化,请用事件并同步处理。

监视器停止时迭代随之结束,而缓冲区里已有的快照仍会先被送达。

## 关闭

```ts
await watcher.stop();
```

`stop()` 会取消在途请求、等待其结束、关闭迭代器并清除监听器。`await` 它意味着:不会再有事件触发,也不会留下悬空的 promise —— 这在测试和进程退出时很重要。

你也可以把监视器的生命周期绑定到一个 signal 上:

```ts
const watcher = createWatcher(client, { signal: request.signal });
```

## 不发起请求地读取状态

```ts
watcher.getStatus(); // Status | null
watcher.getPlayers(); // Player[] —— 未开启 watchPlayers 时为空
watcher.getLast(); // WatchSnapshot | null
```

适合在按需渲染时复用最近一次轮询的结果,而不是每次渲染都触发一次请求。

## 完整配置项

```ts
createWatcher(client, {
  intervalMs: 5000, // 默认值
  watchPlayers: false, // 同时轮询名单
  immediate: true, // 启动时立刻轮询一次,而不是等一个间隔
  signal: undefined, // 该 signal 中止时停止
  maxBuffer: 100, // 供 `for await` 保留的快照数量
  onError: 'backoff', // 或 'stop'
  timeoutMs: undefined, // 每次请求的超时,转发给客户端
});
```

## 脱离客户端单独使用

`createWatcher` 只需要两个方法:

```ts
const watcher = createWatcher({ status: myStatusSource, players: myRosterSource });
```

`diffStatusFields` 与 `diffPlayers` 同样有导出 —— 如果你只想要比较逻辑而不需要那套循环。

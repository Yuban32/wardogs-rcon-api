# wardogs-rcon-api-tool

Wardogs 专用服务器 **RCON HTTP API**(`/v1`)的类型化客户端与工具集。

零运行时依赖。同一套源码产出 ESM、CommonJS 与 UMD 三种格式,因此无论是 `npm install`、打包器、`require()`,还是一个普通的 `<script>` 标签,都能直接使用 —— 适用于 Node、Bun、Deno、浏览器与 Worker。

**中文** | [English](README.md)

> **非官方。** 本库面向的是社区整理的接口参考,并非游戏开发者发布或支持的 API,可能随时变更。库中固化了编写时所依据的规范版本(`SPEC_VERSION`、`SPEC_UPDATED`),并有测试将其路由表面与随包携带的规范副本逐一比对 —— 因此服务端一旦变更,是构建失败,而不是你的面板悄悄出问题。请以自己的服务器为准进行验证。

---

## 安装

```bash
npm install @yuban32/wardogs-rcon-api
```

或直接从 CDN 引入,无需构建步骤:

```html
<script src="https://unpkg.com/@yuban32/wardogs-rcon-api/dist/wardogs-rcon-api.umd.js"></script>
<script>
  const { createClient } = WardogsRCON;
</script>
```

所有内容都挂在唯一的 `WardogsRCON` 全局变量上,而不是散落到 `window` 的各个角落。

---

## 快速开始

### Node / Bun / Deno

```ts
import { createClient } from '@yuban32/wardogs-rcon-api';

const client = createClient({
  baseUrl: 'https://my-server.example:7776',
  token: process.env.WARDOGS_TOKEN!,
});

const status = await client.status.get();
console.log(`${status.players.current}/${status.players.max} 名玩家,地图 ${status.map}`);

await client.broadcast('服务器将在 5 分钟后重启');
```

RCON 默认端口是 `7776`。`baseUrl` 应指向服务器的 RCON 监听端口,而不是游戏端口。

### 浏览器

只有在服务器返回 CORS 响应头时,浏览器才能直连 —— 而大多数自建服务器并不会返回。此外,HTTPS 页面根本无法调用明文回环监听。这种情况应改为经由你自有的同源后端转发:

```ts
import { createClient, createProxyFetch } from '@yuban32/wardogs-rcon-api';

const client = createClient({
  baseUrl: 'https://my-server.example:7776',
  token: '', // 由你的后端持有
  fetch: createProxyFetch({ endpoint: '/rcon-proxy' }),
});
```

[examples/browser-proxy-server.mjs](examples/browser-proxy-server.mjs) 是一份可直接复制使用的、零依赖的可用代理,[docs/adapters.zh-CN.md](docs/adapters.zh-CN.md) 说明了如何取舍。

---

## 两件需要先知道的事

**token 就是全权限管理员密码。** 没有独立的登录步骤,也没有只读版本 —— 同一个凭据既能读取状态,也能踢人、封禁、替换服务器配置、结束比赛。官方参考明确指出它应当保留在服务端。在浏览器场景下,请使用代理适配器。

**并非每台服务器都开放全部路由。** 提供某项功能前,先调用 `GET /v1/capabilities` 确认:

```ts
import { createCapabilities } from '@yuban32/wardogs-rcon-api';

const caps = createCapabilities(client);
if (await caps.supports('PATCH /v1/players/{steamId}')) {
  // 可以显示「更换阵营」
}
if (await caps.configWritable()) {
  // 可以显示配置编辑器
}
```

能力字符串在比较时会折叠路径参数名,因为规范里写的是 `{steamId}`,而参考正文的示例里写的是 `{id}`。两者指的是同一条路由。

---

## API

以下每个方法都有两种等价写法:命名空间形式(`client.players.kick(...)`)与扁平别名(`client.kickPlayer(...)`)。实现完全相同,按上下文可读性选择即可。

### 比赛状态

| 方法                  | 端点             | 返回     |
| --------------------- | ---------------- | -------- |
| `client.status.get()` | `GET /v1/status` | `Status` |

### 玩家

| 方法                                          | 端点                                 | 返回       |
| --------------------------------------------- | ------------------------------------ | ---------- |
| `client.players.list()`                       | `GET /v1/players`                    | `Player[]` |
| `client.players.kick(steamId, reason?)`       | `POST /v1/players/{steamId}/kick`    | `Ok`       |
| `client.players.kill(steamId)`                | `POST /v1/players/{steamId}/kill`    | `Ok`       |
| `client.players.message(steamId, message)`    | `POST /v1/players/{steamId}/message` | `Ok`       |
| `client.players.setFaction(steamId, faction)` | `PATCH /v1/players/{steamId}`        | `Ok`       |
| `client.broadcast(message)`                   | `POST /v1/broadcast`                 | `Ok`       |

`setFaction` 在服务端受能力开关控制 —— 提供该功能前先确认 `capabilities.supports(...)`。

### 管理

| 方法                                   | 端点                                  | 返回           |
| -------------------------------------- | ------------------------------------- | -------------- |
| `client.bans.list()`                   | `GET /v1/bans`                        | `Ban[]`        |
| `client.bans.add(steamId, reason?)`    | `POST /v1/bans`                       | `Ok`           |
| `client.bans.remove(steamId)`          | `DELETE /v1/bans/{steamId}`           | `Ok`           |
| `client.reservedSlots.list()`          | `GET /v1/reserved-slots`              | `string[]`     |
| `client.reservedSlots.add(steamId)`    | `POST /v1/reserved-slots`             | `Ok`           |
| `client.reservedSlots.remove(steamId)` | `DELETE /v1/reserved-slots/{steamId}` | `Ok`           |
| `client.audit.list(limit?)`            | `GET /v1/audit?limit=N`               | `AuditEntry[]` |

`limit` 范围为 1–500,服务端默认 50。

### 比赛控制

| 方法                                                                     | 端点                     | 返回 |
| ------------------------------------------------------------------------ | ------------------------ | ---- |
| `client.match.setMap({ map, experiences?, lighting?, zoneAlternator? })` | `POST /v1/match/map`     | `Ok` |
| `client.match.end()`                                                     | `POST /v1/match/end`     | `Ok` |
| `client.match.restart()`                                                 | `POST /v1/match/restart` | `Ok` |
| `client.world.setLighting(lighting)`                                     | `PUT /v1/world/lighting` | `Ok` |

`MapSelection` 中未提供的字段会回落到地图自身的默认配置 —— 这与传空字符串并不等价,因此客户端是直接省略这些字段,而不是发送 `null`。

### 地图轮换

| 方法                                               | 端点                                 | 返回       |
| -------------------------------------------------- | ------------------------------------ | ---------- |
| `client.rotation.get()`                            | `GET /v1/rotation`                   | `Rotation` |
| `client.rotation.addEntry(selection)`              | `POST /v1/rotation/entries`          | `Ok`       |
| `client.rotation.removeEntry(index)`               | `DELETE /v1/rotation/entries/{i}`    | `Ok`       |
| `client.rotation.moveEntry(index, 'up' \| 'down')` | `POST /v1/rotation/entries/{i}/move` | `Ok`       |
| `client.rotation.save()`                           | `POST /v1/rotation/save`             | `Ok`       |

增删改只作用于**运行中**的轮换。`save()` 才会写入 `ServerSettings.ini`;不调用它,重启后就丢失了。

### 设置、目录、赞助

| 方法                                                                     | 端点                                    | 返回             |
| ------------------------------------------------------------------------ | --------------------------------------- | ---------------- |
| `client.settings.patch({ scoreTick?, rotationEnabled?, rotationMode? })` | `PATCH /v1/settings`                    | `Ok`             |
| `client.catalog.maps()`                                                  | `GET /v1/catalog/maps`                  | `unknown`        |
| `client.catalog.lightings()`                                             | `GET /v1/catalog/lightings`             | `unknown`        |
| `client.catalog.experiences()`                                           | `GET /v1/catalog/experiences`           | `unknown`        |
| `client.catalog.mapExperiences(mapId)`                                   | `GET /v1/catalog/maps/{id}/experiences` | `MapExperiences` |
| `client.catalog.mapAlternators(mapId)`                                   | `GET /v1/catalog/maps/{id}/alternators` | `MapAlternators` |
| `client.sponsor.get()`                                                   | `GET /v1/sponsor`                       | `Sponsor`        |
| `client.sponsor.set(imageUrl)`                                           | `PUT /v1/sponsor`                       | `Ok`             |

三个目录列表接口返回 `unknown`:规范把它们的结构留空,并注明「因端点而异」。两个按地图查询的接口有类型,但请注意 [docs/api.zh-CN.md](docs/api.zh-CN.md) 中的说明 —— 规范把它们标注为一个普通的成功信封,这不可能是对的。

### 配置

| 方法                                                          | 端点                       | 返回           |
| ------------------------------------------------------------- | -------------------------- | -------------- |
| `client.config.get()`                                         | `GET /v1/config`           | `Config`       |
| `client.config.apply(text, { ifMatch?, force?, fullApply? })` | `PUT /v1/config`           | `ConfigResult` |
| `client.config.validate(text)`                                | `POST /v1/config/validate` | `ConfigResult` |

这两个接口是一个全 JSON API 中仅有的 `text/plain` 例外;客户端会自动处理。

把读取到的 revision 作为 `ifMatch` 传入,即可检测并发编辑 —— revision 过期会以 `412` 失败:

```ts
const config = await client.config.get();
try {
  await client.config.apply(edited, { ifMatch: config.revision });
} catch (error) {
  if (isWardogsError(error) && error instanceof WardogsHttpError && error.isRevisionConflict) {
    // 重新读取,把改动重新应用到新文本上,然后重试。
  }
}
```

### 元信息与逃生舱

| 方法                                     | 端点                   | 返回               |
| ---------------------------------------- | ---------------------- | ------------------ |
| `client.meta.capabilities()`             | `GET /v1/capabilities` | `Capabilities`     |
| `client.meta.serverId()`                 | `GET /v1/server-id`    | `ServerId`         |
| `client.meta.health()`                   | `GET /v1/health`       | `Health`           |
| `client.ping()`                          | `GET /v1/status`       | `Promise<boolean>` |
| `client.request(method, path, options?)` | 任意                   | `Promise<T>`       |

`ping()` 就是官方参考指定的 token 校验方式:成功返回 `true`,`401`/`403` 返回 `false`,**其他情况一律抛出** —— 网络故障绝不会被当成密码错误上报。`request()` 用于访问本库尚未收录类型的路由。

---

## 轮询

接口没有推送通道 —— 要拿实时数据就得轮询。`createWatcher` 把这套循环、差分与错误恢复都封装好了:

```ts
import { createWatcher } from '@yuban32/wardogs-rcon-api';

const watcher = createWatcher(client, {
  intervalMs: 5000, // 官方面板是 3–5 秒刷新一次
  watchPlayers: true, // 同时产出名单差分 —— 请求数翻倍
});

watcher.on('change', ({ changed }) => console.log('发生变化:', changed));

watcher.on('players', ({ joined, left }) => {
  for (const p of joined) console.log(`${p.name} 加入了`);
  for (const p of left) console.log(`${p.name} 离开了`);
});

watcher.on('error', (error) => console.error('本次轮询失败,正在重试:', error));

watcher.start();
// 稍后
await watcher.stop();
```

一次轮询只花一个请求 —— `GET /v1/status` 本身就已经带回了玩家人数、阵营得分与轮换索引。失败的轮询会被上报,并以逐步增长的退避重试(最多到间隔的 8 倍):一个跑了几天的看板,不该因为一次网络抖动就静默停止监控。`stop()` 会等待在途请求结束,不会留下悬空的 promise。

快照同样支持异步迭代:

```ts
for await (const snapshot of watcher) {
  console.log(snapshot.status.players.current);
}
```

详见 [docs/watch.zh-CN.md](docs/watch.zh-CN.md)。

---

## 配置文档

`ServerSettings.ini` 是 Unreal 风格的 INI,但有一个关键细节:`+RotationEntries=` 会重复出现,而每一次出现都是一条独立的轮换条目。用 `Record<string, string>` 会只剩最后一条。

```ts
import { createConfigDocument } from '@yuban32/wardogs-rcon-api';

const config = await client.config.get();
const doc = createConfigDocument(config.text);

doc.getNumber('/Script/Engine.GameSession', 'MaxPlayers'); // 128
doc.rotationEntries(); // 已解析,按文件顺序
doc.bannedPlayerIds(); // ["76561198000000009"]

const edited = doc
  .set('/Script/WDGame.WDGameSession', 'ServerName', 'New Name')
  .setBannedPlayerIds(['76561198000000009', '76561198000000011']);

await client.config.apply(edited.text, { ifMatch: config.revision });
```

键名查找不区分大小写,与 Unreal 的读取器一致。每次编辑都返回新文档,你读取到的那份保持不变 —— 这正是 `ifMatch` 所需要的。

解析器从不抛异常:无法解析的行会被收集到 `doc.malformed`,而不是让整份文档不可用。未识别的节会被保留而非剥离,这样服务器正在静默忽略的键仍然看得见。

---

## 工具函数

```ts
import { toSteamId64, isSteamId64, groupPlayersByFaction } from '@yuban32/wardogs-rcon-api';

toSteamId64('76561198000000001'); // 正常
toSteamId64(76561198000000001); // 抛出 TypeError —— 见下

const [players, status] = await Promise.all([client.players.list(), client.status.get()]);
groupPlayersByFaction(players, status.factionScores); // 以 colorHex 为键
```

**SteamID64 绝不应当用 `number` 承载。** 它需要 64 位,而 JS 的双精度浮点只有 53 位有效整数,所以 `76561198000000001` 会变成 `...0000` —— 一个看起来同样合理、却属于别人的 ID,于是封错了人。`toSteamId64` 遇到数字会直接抛出,而不是替你转换。

玩家的 `faction` 只是一个名字,官方参考明确指出 `colorHex` 才是稳定标识。`groupPlayersByFaction` 与 `resolvePlayerFactions` 负责这层关联;当服务器没有提供匹配行时,它们会把颜色留为 `undefined`,而不是去猜。

---

## 错误

所有错误都继承自 `WardogsError`,并带有出错请求的 method 与 URL。

| 类                    | 触发场景                                                                                                              |
| --------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `WardogsHttpError`    | 非 2xx。含 `status`、`code`、`body`,以及 `isRevisionConflict`(412)、`isAuthError`(401/403)、`isRetryable`(5xx、429)。 |
| `WardogsTimeoutError` | 超过 `timeoutMs`。                                                                                                    |
| `WardogsAbortError`   | 被你传入的 `AbortSignal` 取消。                                                                                       |
| `WardogsNetworkError` | 没收到响应:DNS、连接被拒、TLS 握手、连接中断。                                                                        |
| `WardogsParseError`   | 声称是 JSON 的响应体解析失败。带有原始 `body`。                                                                       |

反向代理返回的 HTML 错误页会以 `code: "http_502"` 的 `WardogsHttpError` 呈现,消息取该页面第一行可读文本 —— 而不是变成一个解析错误。

### 重试

GET 请求默认重试一次,覆盖传输层失败与 5xx,采用带抖动的指数退避。**写操作永不重试。** 连接中断并不告诉你服务器是否已经执行了操作,而重试一次 `kick` 可能真的踢两次。可通过 `retries` 调整,或设为 `0` 关闭。

---

## 配置项

```ts
createClient({
  baseUrl: 'https://host:7776',
  token: 'rcon-password',

  timeoutMs: 15_000, // 每次请求;0 表示不超时
  retries: 1, // 仅对 GET 的额外尝试次数
  fetch: myFetch, // 替换传输层 —— 见 docs/adapters.zh-CN.md
  headers: { 'X-Trace': '…' }, // 也可传函数,每次请求重新求值
  allowInsecureHttp: false, // 允许对非回环主机使用明文 http://
});
```

`createClient` 会校验配置并直接抛出,而不是等到第一次请求才失败 —— 拼写错误在写下的地方就被指出来。对非回环主机的明文 `http://` 会被直接拒绝并给出解释:网络监听的 RCON 必须启用 TLS,这种连接永远不可能成功。回环地址是允许的,因为那是明文唯一真实存在的场景。

每个方法都接受一个可选的末位参数,用于逐次调用覆盖:

```ts
await client.status.get({ timeoutMs: 3000, signal: controller.signal });
```

### 自签名证书的 TLS

本库没有提供关闭证书校验的开关 —— 在一个承载全权限密码的连接上,把这种危险操作包装成便利选项是不负责任的。请改为传入你自己的传输层:

```ts
import { Agent, fetch } from 'undici';

const client = createClient({
  baseUrl: 'https://my-server:7776',
  token,
  fetch: (url, init) =>
    fetch(url, { ...init, dispatcher: new Agent({ connect: { ca: myCaPem } }) }),
});
```

完整说明见 [docs/adapters.zh-CN.md](docs/adapters.zh-CN.md)。

---

## 文档

- [docs/api.zh-CN.md](docs/api.zh-CN.md) —— 全部 37 个操作,含参数、返回类型与 curl 对照
- [docs/adapters.zh-CN.md](docs/adapters.zh-CN.md) —— 直连与代理、自定义传输层、TLS、链路追踪
- [docs/watch.zh-CN.md](docs/watch.zh-CN.md) —— 轮询节奏、事件语义、失败处理
- [CHANGELOG.zh-CN.md](CHANGELOG.zh-CN.md) —— 版本变更记录
- [examples/](examples/) —— 可直接运行的 Node、代理与 CDN 示例

## 示例

```bash
node examples/mock-rcon-server.mjs      # 一个替身服务器,不需要真实游戏服务端
node examples/node-basic.mjs            # 用它跑通客户端
node examples/minimal-client.mjs        # 同一遍流程,完全不依赖本库
node examples/browser-proxy-server.mjs  # 然后打开 examples/cdn.html
```

示例默认指向 mock。通过 `WARDOGS_BASE_URL` 与 `WARDOGS_TOKEN` 可指向真实服务器。

如果你不想引入依赖,或者打算把它移植到别的语言,[examples/minimal-client.mjs](examples/minimal-client.mjs) 值得一读:它仅用 `fetch` 走完了同一套 API。

---

## 网页面板

[`web/`](web/) 是一个本地控制面板:完整的路由面、按服务器能力门控、带实时轮询,以及一个遵守版本校验的配置编辑器。

```bash
node examples/mock-rcon-server.mjs &                                    # 一个可对话的服务端
WARDOGS_ALLOWED_ORIGINS=http://127.0.0.1:7777 \
WARDOGS_TOKEN=mock-rcon-password \
  node examples/browser-proxy-server.mjs &                              # 由代理持有 token
cd web && pnpm install && pnpm dev                                      # http://localhost:5300
```

| 标签页       | 内容                                                      |
| ------------ | --------------------------------------------------------- |
| Status       | 实时比赛状态,可单次拉取或轮询,含变化与名单差分            |
| Players      | 名单,按名字解析出各阵营配色                               |
| Routes       | 全部 37 个操作,带表单与按语义渲染的响应                   |
| Capabilities | 这台服务器实际实现了哪些路由,以及它自己的拼写             |
| Config       | 读取、编辑、校验并应用 `ServerSettings.ini`,带 `If-Match` |
| Log          | 面板发过的每个请求,含状态码、耗时、大小与映射后的错误     |

它是开发工具,不属于发布产物:`web/` 有自己的 `package.json`、自己的 lockfile 和自己的安装过程(用 pnpm,库本身用 npm),根目录的 `verify` 与发布链路不受它影响。默认只读 —— 未解锁前写操作一律被拒绝,解锁后每一次写仍需二次确认。详见 [web/README.md](web/README.md)。

---

## 开发

Git hooks 由 `npm install` 自动安装,并自动执行:

| Hook         | 执行内容                                              | 为什么放在这里                                                                                                                                                                       |
| ------------ | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `pre-commit` | `lint-staged` → `format:check` → `typecheck` → `test` | `lint-staged` 会直接重排你暂存的文件,提交时顺手把格式修好,而不是报错让你再手动跑一次。紧随其后的全仓库 `format:check` 覆盖的是这次提交**没有**碰过的文件。                           |
| `pre-push`   | `npm run verify`                                      | 这是「构建坏了」还能低成本挽回的最后一道关口。`npm publish` 一旦发出,同一个版本号无法撤回。                                                                                          |
| `commit-msg` | Conventional Commits 检查                             | 只警告,不阻断 —— 一个因为标点就不让提交的 hook,只会教会人们去用 `--no-verify`,而那会把类型检查和测试 hook 一起跳过。它还会在 `package.json` 版本号变更、但没有对应变更记录时提醒你。 |

完整测试套件在每次提交时都会跑,因为它远不到一秒 —— 一个慢到让人绕过的 hook 等于没有。构建则**刻意不**放在提交时执行:它会重写 `dist/`,`git status` 会因此变脏,得不偿失。`pre-push` 已经覆盖了这一步。

### 格式化

[Prettier](https://prettier.io) 是唯一的形式权威 —— 没有 linter,也没有风格之争。配置在 [.prettierrc.json](.prettierrc.json):100 列、单引号、尾随逗号。

```bash
npm run format         # 写入
npm run format:check   # 校验 —— CI 跑的就是这个
```

有两条路径被刻意排除,写在 [.prettierignore](.prettierignore) 中:

- **`spec/openapi.json`** 是社区发布的规范原文快照。重新格式化会掩盖「服务器实际发布了什么」与「我们写了什么」之间的差异 —— 而这正是那个文件存在的唯一意义。
- **`package-lock.json`**,因为它的排版归 npm 所有,重新格式化只会和写它的工具对着干。

```bash
npm run verify            # 格式化 + 类型检查 + 测试 + 构建 + 打包检查
npm run check:changelog   # 变更记录与清单一致
npm test -- --watch       # 同一套测试,监听模式
```

---

## 发布

`repository` 字段是**必填**的,且必须精确指向本仓库。registry 会把它与 provenance 签名中记录的仓库地址做比对,不一致时以 `E422` 拒绝发布 —— 填错不是"包页面上少一个链接",而是发布失败。`bugs` 和 `homepage` 则是可选的补充信息。

每次发版前,请把新版本写进 [CHANGELOG.zh-CN.md](CHANGELOG.zh-CN.md) —— `npm run check:changelog` 会校验最新条目与 `package.json` 一致,并确认中英文两版覆盖的版本相同。

```bash
npm run verify            # 类型检查 + 测试 + 构建 + 打包检查
npm run check:changelog   # 变更记录与清单一致
npm pack --dry-run        # 确认打包内容
git tag v0.1.0 && git push --tags
```

`.github/workflows/publish.yml` 会在 `v*` 标签上发布,带 `--provenance`,并在发布前校验标签与 `package.json` 一致。从 CI 发布需要一个 `NPM_TOKEN` secret,里面放**启用了 bypass-2FA 的 granular access token** —— npm 已于 2025 年 12 月吊销全部 classic token,且不再签发。workflow 会在构建任何东西之前先确认该 secret 存在。

在本机发布则完全无法生成 provenance(不在受支持的 CI 环境中),必须显式关闭:`npm publish --provenance=false`。

---

## 许可

MIT。与 Bulkhead Interactive 或 Team17 无任何关联。见 [NOTICE](NOTICE)。

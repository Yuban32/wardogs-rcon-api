# API 参考

`/v1` 接口暴露的全部 37 个操作,含 TypeScript 签名与对应的 `curl` 命令。路径均相对于 `baseUrl`,每个请求都携带 `Authorization: Bearer <token>`。

下文 `$BASE` 指你的服务器地址,例如 `https://my-server.example:7776`。

**中文** | [English](api.md)

---

## 已弃用的操作

服务器 build `++Wardogs+Live-CL-501228`(2026-09-14)移除了八个写路由:

| 已移除                               | 替代做法                                                |
| ------------------------------------ | ------------------------------------------------------- |
| `POST /v1/reserved-slots`            | 在配置文档的 `DefaultReservedPlayers` 中加入该 id       |
| `DELETE /v1/reserved-slots/{id}`     | 从 `DefaultReservedPlayers` 中删除该 id                 |
| `POST /v1/rotation/entries`          | 追加一行 `RotationEntries`                              |
| `DELETE /v1/rotation/entries/{i}`    | 删除那一行 `RotationEntries`                            |
| `POST /v1/rotation/entries/{i}/move` | 调整 `RotationEntries` 各行的顺序                       |
| `POST /v1/rotation/save`             | 无需替代 —— 配置编辑本身就是持久化的,文档*就是*那个文件 |
| `PATCH /v1/settings`                 | `[/Script/WDGame.WDMatchState]` 中的 `ScorePeriod`      |
| `PUT /v1/sponsor`                    | 配置文档中的 `ServerImageURL`                           |

当前服务器对这八条一律返回 `404`,并且在 `GET /v1/capabilities` 中不再列出;旧 build 仍然提供,这正是客户端方法保留且依旧可用的原因。每个方法都带有 `@deprecated` 标签并写明替代方案,支持该标注的编辑器会在调用处提示。

请用 `caps.supports(...)` 判断,而不是靠捕获 `404` —— `capabilities.routes` 存在的意义就在于此。

---

## 比赛状态

### `GET /v1/status`

```ts
client.status.get(options?): Promise<Status>
```

```bash
curl -H "Authorization: Bearer $TOKEN" "$BASE/v1/status"
```

```jsonc
{
  "serverName": string,
  "map": string,                    // 地图 id,例如 "Kavkazi"
  "experiences": string[],
  "lighting": string,
  "alternator": string,
  "scoreTick": { "current": number, "min": number, "max": number },
  "scoreCap": number,
  "matchSeconds": number,
  "players": { "current": number, "max": number },
  "factionScores": [ { "name": string, "colorHex": string } ],
  "rotation": { "nowIndex": number | null, "nextIndex": number | null } | null
}
```

这同时也是 token 校验接口 —— 并不存在登录端点。

---

## 玩家

### `GET /v1/players`

```ts
client.players.list(options?): Promise<Player[]>
```

```bash
curl -H "Authorization: Bearer $TOKEN" "$BASE/v1/players"
```

服务端返回 `{ players: [...] }`,客户端已替你拆包。每个玩家为 `{ name, steamId, faction, kills, deaths, cash, pingMs }`。

`faction` 只是服务器自定义的一个**名字**。官方参考明确指出 `factionScores` 行上的 `colorHex` 才是稳定键 —— 请使用 `groupPlayersByFaction` 或 `resolvePlayerFactions`,而不是自己按名字匹配。

### `POST /v1/players/{steamId}/kick`

```ts
client.players.kick(steamId: string, reason?: string, options?): Promise<Ok>
```

```bash
curl -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"reason":"teamkilling"}' "$BASE/v1/players/76561198000000001/kick"
```

省略 `reason` 时请求体为 `{}` —— 键是**不存在**,而不是空值。

### `POST /v1/players/{steamId}/kill`

```ts
client.players.kill(steamId: string, options?): Promise<Ok>
```

在比赛中击杀该玩家,但不断开连接。

### `POST /v1/players/{steamId}/message`

```ts
client.players.message(steamId: string, message: string, options?): Promise<Ok>
```

### `PATCH /v1/players/{steamId}`

```ts
client.players.setFaction(steamId: string, faction: string, options?): Promise<Ok>
```

**受能力开关控制。** 官方参考指出,管理面板只有在 `GET /v1/capabilities` 的 `routes` 中包含该路由时才显示「更换阵营」。提供该功能前请先检查:

```ts
if (await caps.supports('PATCH /v1/players/{steamId}')) {
  /* … */
}
```

### `POST /v1/broadcast`

```ts
client.broadcast(message: string, options?): Promise<Ok>
```

官方参考把它归在「Players」分组下,但它并不以玩家为作用域,因此在客户端上它位于顶层。

---

## 管理

### `GET /v1/bans`

```ts
client.bans.list(options?): Promise<Ban[]>   // { steamId, bannedAtUtc, bannedBy, reason }[]
```

### `POST /v1/bans`

```ts
client.bans.add(steamId: string, reason?: string, options?): Promise<Ok>
```

### `DELETE /v1/bans/{steamId}`

```ts
client.bans.remove(steamId: string, options?): Promise<Ok>
```

### `GET /v1/reserved-slots`

```ts
client.reservedSlots.list(options?): Promise<string[]>   // SteamID64 字符串
```

### `POST /v1/reserved-slots`

```ts
client.reservedSlots.add(steamId: string, options?): Promise<Ok>
```

### `DELETE /v1/reserved-slots/{steamId}`

```ts
client.reservedSlots.remove(steamId: string, options?): Promise<Ok>
```

### `GET /v1/audit`

```ts
client.audit.list(limit?: number, options?): Promise<AuditEntry[]>
```

`limit` 范围为 1–500,服务端默认 50。未提供时该参数会被完全省略,而不是发送 `undefined`。

---

## 比赛控制

### `POST /v1/match/map`

```ts
client.match.setMap(selection: MapSelection, options?): Promise<Ok>

interface MapSelection {
  map: string;
  experiences?: string[];
  lighting?: string;
  zoneAlternator?: string;
}
```

只有 `map` 是必填的。省略的字段会回落到地图自身的默认配置,这与传空字符串**并不等价** —— 客户端会直接省略它们。

### `POST /v1/match/end` · `POST /v1/match/restart`

```ts
client.match.end(options?): Promise<Ok>
client.match.restart(options?): Promise<Ok>
```

### `PUT /v1/world/lighting`

```ts
client.world.setLighting(lighting: string, options?): Promise<Ok>
```

在不换地图的前提下实时改变光照。

---

## 地图轮换

### `GET /v1/rotation`

```ts
client.rotation.get(options?): Promise<Rotation>
```

```jsonc
{
  "enabled": boolean,
  "mode": "ordered" | "random",
  "entries": [{
    "map": string, "experiences": string[], "lighting": string,
    "zoneAlternator": string,
    "status": "now" | "next" | string,   // 在轮换中的位置
    "denied": boolean
  }]
}
```

### `POST /v1/rotation/entries`

```ts
client.rotation.addEntry(selection: MapSelection, options?): Promise<Ok>
```

### `DELETE /v1/rotation/entries/{i}`

```ts
client.rotation.removeEntry(index: number, options?): Promise<Ok>
```

### `POST /v1/rotation/entries/{i}/move`

```ts
client.rotation.moveEntry(index: number, direction: 'up' | 'down', options?): Promise<Ok>
```

### `POST /v1/rotation/save`

```ts
client.rotation.save(options?): Promise<Ok>
```

增、删、移动改变的是**运行中**的轮换。只有这个接口会把它们持久化到 `ServerSettings.ini`;不调用它,重启后就丢失了。

---

## 设置

### `PATCH /v1/settings`

```ts
client.settings.patch(patch: SettingsPatch, options?): Promise<Ok>

interface SettingsPatch {
  scoreTick?: number;       // 得分结算间隔秒数;服务端接受 18–30
  rotationEnabled?: boolean;
  rotationMode?: string;
}
```

所有字段都是可选的 —— 这是一个 patch。只会发送你实际提供的键。

---

## 目录

### `GET /v1/catalog/maps` · `GET /v1/catalog/lightings` · `GET /v1/catalog/experiences`

```ts
client.catalog.maps(options?): Promise<unknown>
client.catalog.lightings(options?): Promise<unknown>
client.catalog.experiences(options?): Promise<unknown>
```

刻意标注为 `unknown`。规范把 `Catalog` 留空,并注明其结构「因端点而异」;官方参考也没有固定字段名。请先对自己的服务器观测一次实际载荷,再做窄化。

### `GET /v1/catalog/maps/{id}/experiences` · `GET /v1/catalog/maps/{id}/alternators`

```ts
client.catalog.mapExperiences(mapId: string, options?): Promise<MapExperiences>
client.catalog.mapAlternators(mapId: string, options?): Promise<MapAlternators>
```

> **规范与正文的偏差。** 规范把这两个都标注为普通的 `Ok`,这不可能是对的 —— 这两个操作的命名和文档都表明它们返回的是列表。规范也没有固定字段名。因此 `MapExperiences` 与 `MapAlternators` 在 `Ok` 成员之外,各自带一个可选的有类型列表字段(`experiences` / `alternators`),并保持开放以容纳其他字段。**依赖字段名之前请先对自己的服务器验证**;这是整个库中唯一一处文档化的约定确实未知的地方。

---

## 赞助

### `GET /v1/sponsor`

```ts
client.sponsor.get(options?): Promise<Sponsor>   // { imageUrl }
```

### `PUT /v1/sponsor`

```ts
client.sponsor.set(imageUrl: string, options?): Promise<Ok>
```

横幅必须是 1024×256 的 PNG/JPEG,且在服务器的白名单内。

---

## 配置

### `GET /v1/config`

```ts
client.config.get(options?): Promise<Config>
```

返回 `{ revision, writable, text, sections, warnings }`。`text` 是权威文档;`revision` 是 `ifMatch` 所需要的值。

关于「能否编辑」:`writable` 与 `capabilities.configWritable()` 报告的是同一个标志。

### `PUT /v1/config`

```ts
client.config.apply(
  text: string,
  options?: { ifMatch?: string; force?: boolean; fullApply?: boolean } & CallOptions,
): Promise<ConfigResult>
```

```bash
curl -X PUT -H "Authorization: Bearer $TOKEN" -H "Content-Type: text/plain" \
  -H 'If-Match: "rev-1"' --data-binary @ServerSettings.ini "$BASE/v1/config"
```

两个 `text/plain` 端点之一 —— 请求头由客户端自动设置。`ifMatch` 按 HTTP 对实体标签的要求加引号;已经带引号的 revision 不会被重复加引号,而包含引号或换行的 revision 会被直接拒绝,而不是发出去一个畸形的请求头。

revision 过期会返回 **HTTP 412**:

```ts
const error = await client.config.apply(text, { ifMatch: 'stale' }).catch((e) => e);
if (error instanceof WardogsHttpError && error.isRevisionConflict) {
  // 重新读取,把改动重新应用到新文本上,然后重试。
}
```

### `POST /v1/config/validate`

```ts
client.config.validate(text: string, options?): Promise<ConfigResult>
```

校验文档但不应用。同样是 `text/plain`。

### `ConfigResult`

```jsonc
{
  "ok": boolean,
  "revision": string,
  "error": { "code": string, "message": string },
  "errors": ConfigError[],    // 非空表示什么都没应用
  "outcomes": unknown[],
  "changed": ConfigChange[],  // 本文档将会改动的分区
  "shadowed": unknown[],      // 被后续重复键遮蔽的键
  "stripped": unknown[],      // 因不在白名单而被剥离的键
  "conflict": unknown[],      // 出现在 HTTP 412 响应中
  "warnings": string[],
  "timingsMs": object | null
}

interface ConfigError  { section: string; key: string; code: string; message: string }
interface ConfigChange { section: string; added?: boolean; removed?: boolean; keys?: string[] }
```

规范 1.1.0 给 `errors` 与 `changed` 补上了正式类型,所以这里对应标注为 `ConfigError[]` 与 `ConfigChange[]`。其余结果数组在规范中仍是 `items: {}`,一律保持 `unknown[]`,而不是靠猜。

写入失败时最该看的是 `errors`:只要它非空,就什么都没应用 —— 单个过期的值(比如赞助商 URL 的主机已从 `ImageURLWhitelist` 中移除)会一直挡住其他无关的修改,直到它被订正为止。`message` 是写给人的,可以原样展示。

---

## 元信息

### `GET /v1/capabilities`

```ts
client.meta.capabilities(options?): Promise<Capabilities>

interface Capabilities {
  apiVersion?: string;              // "1"
  build?: string;                   // "++Wardogs+Live-CL-501228"
  auth?: { scheme: string; header: string };
  limits?: { maxBodyBytes: number; maxRequestsPerMinutePerIp: number };
  config: { writable: boolean; document?: string };
  routes: string[];                 // 例如 "PATCH /v1/players/{id}"
}
```

这是某台服务器实际开放内容的权威列表。`routes` 中的条目在比较时路径参数名会被折叠,所以 `{id}` 与 `{steamId}` 是同一条路由:

```ts
const caps = createCapabilities(client); // 带缓存,TTL 30 秒
await caps.supports('PATCH /v1/players/{steamId}');
await caps.configWritable();
await caps.get(true); // 强制刷新
```

除 `routes` 与 `config.writable` 外,其余字段都是可选的:规范 1.1.0 才首次记录它们,旧 build 的服务器根本不会返回。能力检查失败时最该记录的是 `build` —— 它指明这个答案来自哪个服务器 build,通常这一条就足以解释问题。

`findRouteEntries(capabilities, route)` 会返回服务器自己的原始字符串,在你检查失败、需要肉眼比对时正需要这个。

### `GET /v1/server-id`

```ts
client.meta.serverId(options?): Promise<ServerId>

interface ServerId {
  serverId: string;
}
```

一个不随重启与换图变化的不可见 id。持久化状态请以它为键,而不是 `host:port` —— 服务器迁移后地址会变,以地址为键的仪表盘会在下一次迁移时丢掉全部历史。

### `GET /v1/health`

```ts
client.meta.health(options?): Promise<Health>

interface Health {
  status: string;
  uptimeSeconds: number;
  connections: { active: number };
  gameThreadQueue: { inFlight: number; depth: number; rejectedTotal: number };
}
```

运行时长、当前连接数与游戏线程工作队列。`gameThreadQueue.depth` 持续攀升或 `rejectedTotal` 上涨,说明服务器正在丢弃管理请求 —— 这是该让轮询退避的信号,而不是加大重试力度的信号。

### 用 `GET /v1/status` 做连通性探测

```ts
client.ping(options?): Promise<boolean>
```

成功返回 `true`,`401`/`403` 返回 `false`,**其他情况一律抛出**。把「连不上」和「密码错」混为一谈,会让运维去检查一个根本不是问题所在的凭据。

---

## 逃生舱

```ts
client.request<T>(
  method: string,
  path: string,
  options?: CallOptions & { query?: Record<string, QueryValue>; body?: unknown },
): Promise<T>
```

用于访问服务器已开放、但本库尚未收录类型的路由。值为 `undefined` 或 `null` 的查询参数会被省略。

---

## 逐次调用选项

每个方法都接受一个可选的末位参数:

```ts
interface CallOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  retries?: number; // 仅对 GET 生效
}
```

```ts
const controller = new AbortController();
await client.status.get({ timeoutMs: 3000, signal: controller.signal });
```

---

## 路由标识

`ROUTE_IDS` 与 `RouteId` 类型以 `"METHOD /path"` 字符串形式列出了全部 37 个操作,这正是 `capabilities.routes` 使用的格式。

```ts
import { ROUTE_IDS, normalizeRoute, isRouteId } from '@yuban32/wardogs-rcon-api';
```

`normalizeRoute('patch /v1/players/{id}/')` → `'PATCH /v1/players/{*}'`。一致性测试正是用这些字符串与随包携带的规范副本比对,因此服务端一旦变更,构建就会失败。

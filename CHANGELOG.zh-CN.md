# 变更记录

本项目所有值得记录的变更都写在这里。

格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/),
版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/spec/v2.0.0.html)。

**中文** | [English](CHANGELOG.md)

## [未发布]

### 新增

- **`GET /v1/server-id` 与 `GET /v1/health`。** `client.meta.serverId()` 返回一个不随重启与换图变化的不可见 id —— 持久化状态请以它为键,而不是会变的 `host:port`。`client.meta.health()` 返回运行时长、当前连接数与游戏线程工作队列;其中 `depth` 持续攀升或 `rejectedTotal` 上涨,说明服务器正在丢弃管理请求。两者都是 build `++Wardogs+Live-CL-501228` 新增的;更旧的服务器会返回 `404`。对应类型为 `ServerId` 与 `Health`,并提供扁平别名 `getServerId()` 与 `getHealth()`。
- **`Capabilities` 补上了规范 1.1.0 记录的字段**:`apiVersion`、`build`、`auth`、`limits` 与 `config.document`。全部可选 —— 旧 build 根本不会返回;`routes` 与 `config.writable` 仍为必需,因此既有调用方不受影响。能力检查失败时最该记录 `build`,它指明这个答案来自哪个服务器 build。
- **`ConfigError` 与 `ConfigChange`**,`ConfigResult.errors` / `.changed` 现在用它们标注,而不再是 `unknown[]`。`errors` 非空即表示什么都没应用,这正是最值得处理的分支。

### 变更

- **重新 vendor 规范至 1.1.0(2026-09-14,build `++Wardogs+Live-CL-501228`)**,此前为 0.27(2026-09-10)。`SPEC_VERSION` 与 `SPEC_UPDATED` 同步更新。现在有测试把这两个常量钉在 vendor 的文件上,只更新其中一个会直接失败,而不会再悄悄漂移 —— 本次落后两个规范版本正是这样发生的。
- **路由从 31 条路径 35 个操作,增加到 33 条路径 37 个操作。** `ROUTE_IDS` 与网页面板的注册表同步更新。
- **八个写操作被标注 `@deprecated`。** 2026-09-14 的 build 移除了 `POST`/`DELETE /v1/reserved-slots`、`POST`/`DELETE /v1/rotation/entries`、`POST /v1/rotation/entries/{i}/move`、`POST /v1/rotation/save`、`PATCH /v1/settings` 与 `PUT /v1/sponsor`,把它们的功能移入配置文档。当前服务器返回 `404`,并且不再从 `capabilities.routes` 中列出它们。**这些方法仍然存在且仍然可用** —— 旧 build 依旧提供 —— 每个方法现在都写明替代方案,编辑器会在调用处提示。运行时行为没有任何改变。

### 说明

- **接入并强制 Prettier。** `.prettierrc.json`(100 列、单引号、尾随逗号)、`npm run format` 与 `npm run format:check`。CI 与发布工作流都会执行 `format:check`,它也是 `npm run verify` 的第一步。
- **`pre-commit` 现在会先格式化你暂存的文件**(通过 `lint-staged`),再校验整个仓库,然后才跑类型检查和测试。格式化一个即将提交的文件,不该是一个需要手动执行的独立步骤。
- **`examples/minimal-client.mjs`** —— 与 `node-basic.mjs` 同一遍流程,但完全不依赖本库,只用全局 `fetch`。它的用途是让你直接拷贝到别的项目、或移植到别的语言;它同样会在 CI 中执行,因此不会悄悄失效。
- **网页面板。** `web/` 是一个面向运行中服务器的本地控制面板:全部 35 条路由,带表单与按语义渲染的响应;按服务器能力门控;比赛状态支持实时轮询;配置编辑器可读取、校验并带 `If-Match` 应用 `ServerSettings.ini`。它是独立子包,有自己的安装过程与 lockfile —— 刻意不做成 npm workspace —— 因此根目录的 `npm install`、`npm run verify` 与发布链路都没有变化。默认只读,且 RCON token 永不落盘。详见 [web/README.md](web/README.md)。

### 说明

- 有两条路径被排除在格式化之外,写在 `.prettierignore` 中:**`spec/openapi.json`**,因为它是社区发布的规范原文快照,重新格式化会掩盖「服务器发布了什么」与「本仓库写了什么」之间的差异 —— 而这正是那个文件存在的唯一意义;以及 **`package-lock.json`**,因为它的排版归 npm 所有。
- 没有配置 linter。Prettier 是唯一的形式权威,风格问题只有一个地方给出答案,而不是两个地方可能互相矛盾。
- 应用 Prettier 重排了既有源码。改动仅涉及空白 —— 合并行与补齐尾随逗号 —— 完整测试套件未作任何修改即全部通过。

## [0.1.0] — 2026-09-14

首次发布。

### 新增

- **类型化客户端**,覆盖 Wardogs RCON HTTP API(`/v1`)的全部 35 个操作,依据规范版本
  `0.27`(更新于 2026-09-10)。每个方法都有命名空间写法(`client.players.kick(...)`)
  与扁平别名(`client.kickPlayer(...)`)两种形式。
- **同一套源码产出三种模块格式**:ESM、CommonJS 与 UMD,并附带打包后的类型声明。
  UMD 构建只挂载一个 `WardogsRCON` 全局变量,而不是把名字散落到 `window` 上。
- **`createWatcher`** —— 带变化检测的轮询、以 SteamID64 为键的名单差分、失败时的指数退避,
  以及供 `for await` 使用的有界缓冲。一次轮询只花一个请求:`GET /v1/status` 本身就已经
  带回了文档化事件所需的全部信息。
- **`createCapabilities`** —— 带缓存的能力探测。路由比较会折叠路径参数名,因此 `{id}` 与
  `{steamId}` 被视为相等;字面比较会把一个受支持的功能误报为不支持。
- **配置文档辅助工具** —— `ServerSettings.ini` 解析,保留重复出现的 `+Key=` 行,支持不可变
  编辑;轮换条目解析(处理单数 `Experience` 与复数 `Experiences` 的区别);以及封禁/预留
  名单的读取。
- **`createProxyFetch`** —— 面向浏览器的同源传输层。在 CORS 响应头与混合内容规则本会拦下
  请求的场景下,它能让请求真正发出去,同时 token 可以留在你的后端。
- **`createDirectFetch`** —— 默认传输层。在发起请求时才解析 `fetch`,因此在 import 之后
  才安装的 polyfill 同样有效。
- **SteamID64 工具函数**,拒绝以 `number` 传入 —— 它无法精确表示 17 位数字,会得到一个
  看起来合理、却属于别人的 ID。
- **阵营工具函数**(`groupPlayersByFaction`、`resolvePlayerFactions`),按 `colorHex` 把玩家
  关联到 `factionScores`。
- **错误体系** —— `WardogsHttpError`、`WardogsTimeoutError`、`WardogsAbortError`、
  `WardogsNetworkError`、`WardogsParseError`,全部继承自 `WardogsError`,并带有出错请求的
  method 与 URL。
- **中英文文档**:README、`docs/api`、`docs/adapters`、`docs/watch` 以及本变更记录。
- **可直接运行的示例**:替身 RCON 服务器、Node 演示脚本、零依赖的浏览器代理,以及一个
  CDN 页面。
- **一致性测试**,把发布的路由表面与随包携带的社区规范副本逐一比对,因此接口变更会导致
  构建失败,而不是用户的面板出问题。

### 设计取舍

以下是事后阅读代码时最容易被这些选择绊住的地方,因此记录下来而不是留作隐含前提。

- **写操作永不重试。** 连接中断并不能说明服务器是否已经执行了操作,而重试一次 `kick` 可能
  真的踢两次。GET 请求默认重试一次,覆盖传输层失败与 5xx,采用带抖动的指数退避。
- **对非回环主机的明文 `http://` 在构造时即被拒绝。** 网络监听的 RCON 必须启用 TLS,这种
  连接永远不可能成功。在写配置的地方失败,能指出问题所在,而不是抛出一个 socket 错误。
  回环地址是允许的 —— 那是明文唯一真实存在的场景。
- **证书校验无法关闭。** 没有 `rejectUnauthorized: false` 这类开关,调用方应自行传入传输层。
  这条连接承载着全权限管理员密码,在这里提供一个「便利」开关就是在埋雷。
- **调用方取消优先于错误名。** 调用方完全可能用一个 `TimeoutError` 来中止请求,而 signal
  已被中止是直接证据,错误名只是线索。
- **非 JSON 的错误响应体会被宽松解码。** 网关返回的 HTML 502 会以 `WardogsHttpError` 呈现,
  `code` 为 `"http_502"` 并带一条可读消息,而不是变成一个掩盖了状态码的 JSON 解析失败。
- **`null`/`undefined` 查询参数会被省略,而不是被序列化。** 对 `POST /v1/match/map` 而言,
  省略某个键会选用地图自身的默认配置 —— 这与传一个空值并不等价。
- **目录列表接口返回 `unknown`。** 规范把它们的结构留空,并注明「因端点而异」。靠猜比让调用
  方自己看一眼更糟。

### 说明

- **非官方。** 本库面向的是社区整理的接口参考,并非开发者发布的 API,可能随时变更。
  `SPEC_VERSION` 与 `SPEC_UPDATED` 记录了本次发布所依据的规范版本。
- **`GET /v1/catalog/maps/{id}/experiences` 与 `.../alternators` 是唯一一处真正未知的结构。**
  规范把两者都标注为普通的成功信封,这不可能是对的 —— 它们返回的是列表 —— 而官方参考正文
  也没有固定字段名。因此 `MapExperiences` 与 `MapAlternators` 各自带一个可选的有类型字段并
  保持开放。依赖它之前请先对自己的服务器验证。
- 需要 Node 18+(首个内置全局 `fetch` 的版本)。不打包任何 polyfill。Node、Bun、Deno、浏览器
  与 Worker 均可使用;浏览器场景可能需要 `createProxyFetch`。
- 零运行时依赖,不使用任何 Node 内置模块。

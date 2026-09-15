# 直连还是走代理?

`createClient` 需要一个传输层。默认是直连 —— 每个请求直接发给服务器。`createProxyFetch` 则改为经由你自己的后端转发。除此之外,两种方式下客户端的行为完全一致。

|                            | 直连(默认)                 | 代理                 |
| -------------------------- | -------------------------- | -------------------- |
| 可在 Node/Bun/Deno 中使用  | 是                         | 是                   |
| 可在浏览器中使用           | 仅当服务器返回 CORS 响应头 | 是                   |
| HTTPS 页面访问明文回环监听 | 否 —— 混合内容会被拦截     | 是                   |
| token 位于客户端           | 是                         | 可选 —— 可由后端持有 |
| 额外基础设施               | 无                         | 一个端点             |

如果你本身有后端,且场景中涉及浏览器,就用代理。官方 API 参考本身就很明确:token 是全权限管理员密码,没有只读版本,应当保留在服务端。

**中文** | [English](adapters.md)

---

## 直连

```ts
const client = createClient({ baseUrl: 'https://my-server:7776', token });
```

不需要其他东西。默认传输层在**发起请求时**才去解析 `globalThis.fetch`,因此在 import 之后才安装的 polyfill 同样有效。当运行时完全没有 `fetch` 时,第一个请求会抛出一个 `WardogsError`,消息里直接写明该怎么修。

### 会在哪里出问题

**CORS。** 官方参考说浏览器可以调用 TLS 服务器。但它对 CORS 响应头只字未提,而一个从不返回这些头的服务器,会在请求真正发出之前就被浏览器拦下。你会看到一个没有更多信息的 `TypeError: Failed to fetch`,响应里什么都没有。

**混合内容。** HTTPS 页面不允许调用明文 `http://` 监听,这直接排除了本地服务器的场景。

**自签名证书。** Node 运行时会拒绝该证书,失败以带 TLS 原因的 `WardogsNetworkError` 形式出现。

---

## 代理

```ts
const client = createClient({
  baseUrl: 'https://my-server:7776', // 仍然是真实目标
  token: '', // 由你的后端持有
  fetch: createProxyFetch({ endpoint: '/rcon-proxy' }),
});
```

代理适配器会向你的端点发送一个 `POST`,并在请求头里描述真实请求:

| 请求头             | 含义                                                 |
| ------------------ | ---------------------------------------------------- |
| `X-Wardogs-Target` | 完整目标 URL,例如 `https://my-server:7776/v1/status` |
| `X-Wardogs-Method` | `GET`、`POST`、`PATCH`、`PUT`、`DELETE`              |
| `Authorization`    | 仅当你向适配器传入了 `token` 时                      |
| 内容相关请求头     | 原样转发                                             |

你的端点读取这些信息,发起真实请求,并把状态码、响应体和 `Content-Type` 原样返回。

```js
createProxyFetch({
  endpoint: '/rcon-proxy',
  targetPlacement: 'header', // 或 'query',用于无法读取自定义请求头的后端
  token: undefined, // 不传,让你的后端自己注入
  headers: { 'X-CSRF-Token': token }, // 发给代理本身的额外请求头
});
```

[examples/browser-proxy-server.mjs](../examples/browser-proxy-server.mjs) 是一份可直接使用的代理实现:零依赖、支持 token 注入、带白名单,并为浏览器来源处理好了 CORS。

### 给目标加白名单

`X-Wardogs-Target` 来自浏览器,因此**完全由攻击者可控**。不加检查就转发的代理,就是一个指向代理自身可达网络的 SSRF 原语 —— 云元数据端点、内部管理后台、游戏服务器自己的回环接口,都在射程之内。

比较**源(origin)**,绝不要比较字符串前缀:`target.startsWith('https://my-server')` 会被 `https://my-server.attacker.example` 满足。示例代理中的 `assertAllowedTarget` 展示了正确的检查方式。

---

## 自定义传输层

`fetch` 的类型是 `FetchLike` —— 一个接收 URL 字符串和一个小巧 init 对象的函数,返回带有 `ok`、`status` 和 `text()` 的对象。全局 `fetch` 在结构上满足它,`undici`、`node-fetch`、`cross-fetch` 同样满足。

凡是本库不该替你做决定的事情,都可以用它:

### 信任你自己的 CA

```ts
import { Agent, fetch } from 'undici';
import { createClient } from '@yuban32/wardogs-rcon-api';

const client = createClient({
  baseUrl: 'https://my-server:7776',
  token: process.env.WARDOGS_TOKEN!,
  fetch: (url, init) =>
    fetch(url, { ...init, dispatcher: new Agent({ connect: { ca: myCaPem } }) }),
});
```

请固定(pin)你的 CA。`rejectUnauthorized: false` 虽然可用,但会在一条承载管理员密码的连接上关掉 TLS 存在的全部意义 —— 优先选择固定证书。

### 经由企业代理

```ts
import { ProxyAgent, fetch } from 'undici';

const dispatcher = new ProxyAgent('http://proxy.internal:3128');
const client = createClient({
  baseUrl,
  token,
  fetch: (url, init) => fetch(url, { ...init, dispatcher }),
});
```

### 链路追踪

```ts
const tracingFetch: FetchLike = async (url, init) => {
  const started = performance.now();
  try {
    return await fetch(url, init);
  } finally {
    console.log(`${init?.method ?? 'GET'} ${url} — ${(performance.now() - started).toFixed(0)}ms`);
  }
};
```

### 与代理适配器组合

自定义传输层与代理适配器可以叠加 —— 把你的追踪版 fetch 传给适配器即可:

```ts
createProxyFetch({ endpoint: '/rcon-proxy', fetch: tracingFetch });
```

---

## 测试你自己的集成

单元测试里,传入一个从队列取答案的传输层,而不是真的访问网络:

```ts
const responses = [{ body: { ok: true } }];
const client = createClient({
  baseUrl,
  token,
  fetch: async () => {
    const step = responses.shift()!;
    return { ok: true, status: 200, text: async () => JSON.stringify(step.body) };
  },
});
```

本仓库自己的测试就是这么搭的 —— 见 [tests/helpers.ts](../tests/helpers.ts) 中那个既能录制请求、又能对「实际发了什么」做断言的实现。

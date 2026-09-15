# Direct or proxied?

`createClient` needs a transport. The default is direct — every request goes to the server. `createProxyFetch` routes through a backend of yours instead. Everything else about the client is identical either way.

[中文](adapters.zh-CN.md) | **English**

|                                                                | Direct (default)                      | Proxy                              |
| -------------------------------------------------------------- | ------------------------------------- | ---------------------------------- |
| Works in Node/Bun/Deno                                         | Yes                                   | Yes                                |
| Works in a browser                                             | Only if the server sends CORS headers | Yes                                |
| Works against a plaintext loopback listener from an HTTPS page | No — mixed content is blocked         | Yes                                |
| Token on the client                                            | Yes                                   | Optional — the backend can hold it |
| Extra infrastructure                                           | None                                  | One endpoint                       |

If you are running a backend and the browser is involved, use the proxy. The API reference itself is explicit that the token is a full-access admin password with no read-only variant, and recommends keeping it server-side.

---

## Direct

```ts
const client = createClient({ baseUrl: 'https://my-server:7776', token });
```

Nothing else is required. The default transport resolves `globalThis.fetch` at request time, so a polyfill installed after import still works. When there is no `fetch` at all, the first request throws a `WardogsError` naming the fix rather than failing obscurely.

### Where it goes wrong

**CORS.** The API reference says a browser can call a TLS server. It says nothing about CORS headers, and a server that never advertises them is blocked by the browser before a request lands. You will see an opaque `TypeError: Failed to fetch` with nothing in the response.

**Mixed content.** An HTTPS page may not call a plaintext `http://` listener, which rules out the local-server case entirely.

**Self-signed certificates.** A Node runtime rejects the certificate, and the failure arrives as `WardogsNetworkError` with a TLS cause.

---

## Proxy

```ts
const client = createClient({
  baseUrl: 'https://my-server:7776', // still the real target
  token: '', // held by your backend
  fetch: createProxyFetch({ endpoint: '/rcon-proxy' }),
});
```

The proxy adapter sends a `POST` to your endpoint and describes the real request in headers:

| Header             | Meaning                                                  |
| ------------------ | -------------------------------------------------------- |
| `X-Wardogs-Target` | Full target URL, e.g. `https://my-server:7776/v1/status` |
| `X-Wardogs-Method` | `GET`, `POST`, `PATCH`, `PUT`, `DELETE`                  |
| `Authorization`    | Only if you passed `token` to the adapter                |
| content headers    | Forwarded as-is                                          |

Your endpoint reads those, makes the real request, and returns status, body and `Content-Type` unchanged.

```js
createProxyFetch({
  endpoint: '/rcon-proxy',
  targetPlacement: 'header', // or 'query' for a backend that cannot read custom headers
  token: undefined, // leave unset so your backend injects it
  headers: { 'X-CSRF-Token': token }, // extra headers for the proxy call itself
});
```

[docs/../examples/browser-proxy-server.mjs](../examples/browser-proxy-server.mjs) is a working proxy: no dependencies, token injection, allow-list, CORS for the browser origin.

### Allow-list your targets

`X-Wardogs-Target` arrives from the browser and is therefore attacker-controlled. A proxy that forwards it blindly is a server-side request forgery primitive pointed at whatever the proxy can reach — cloud metadata endpoints, internal admin panels, the game server's own loopback interface.

Compare **origins**, never string prefixes: `target.startsWith('https://my-server')` is satisfied by `https://my-server.attacker.example`. The example proxy's `assertAllowedTarget` shows the check.

---

## Custom transports

`fetch` is a `FetchLike` — a function taking a URL string and a small init object, returning something with `ok`, `status` and `text()`. The global `fetch` satisfies it structurally, as do `undici`, `node-fetch` and `cross-fetch`.

Use it for anything the library should not decide for you:

### Trusting your own CA

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

Pin the CA. `rejectUnauthorized: false` is available but disables the protection TLS exists to provide, on a connection carrying an admin password — prefer pinning.

### Through a corporate proxy

```ts
import { ProxyAgent, fetch } from 'undici';

const dispatcher = new ProxyAgent('http://proxy.internal:3128');
const client = createClient({
  baseUrl,
  token,
  fetch: (url, init) => fetch(url, { ...init, dispatcher }),
});
```

### Tracing

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

### Composing with a proxy

A custom transport and the proxy adapter compose — pass your traced fetch to the adapter:

```ts
createProxyFetch({ endpoint: '/rcon-proxy', fetch: tracingFetch });
```

---

## Testing your integration

For unit tests, pass a transport that answers from a queue rather than reaching the network:

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

The repository's own suite is built this way — see [tests/helpers.ts](../tests/helpers.ts) for a recording implementation that also asserts on what was sent.

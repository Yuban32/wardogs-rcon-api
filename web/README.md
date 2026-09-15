# Wardogs RCON panel

A local control panel for a Wardogs dedicated server's `/v1` HTTP API: the whole
route surface, capability-gated, with live polling and a config editor that
respects the revision check.

It is a **development tool**, not part of the published package. `web/` is a
separate package with its own `package.json` and lockfile — deliberately not an
npm workspace — so the root `npm install`, `npm run verify` and the publish path
are unaffected by anything in here.

## Running it

Three terminals. The panel talks to a server the same way a browser must: through
a same-origin proxy, because a self-hosted RCON listener sends no CORS headers.

```bash
# 1. a stand-in server, no game required
node examples/mock-rcon-server.mjs

# 2. the proxy, injecting the token so it never reaches the browser
WARDOGS_ALLOWED_ORIGINS=http://127.0.0.1:7777 \
WARDOGS_TOKEN=mock-rcon-password \
  node examples/browser-proxy-server.mjs

# 3. the panel
cd web
pnpm install
pnpm dev             # http://localhost:5300
```

Open the page, press **Connect**, and the Vite dev server forwards `/rcon-proxy`
to the example proxy for you.

Point it at a real server by changing the base URL in the panel — and read
[Direct or proxied?](../docs/adapters.md) first, because the token is a
full-access admin password.

## What it does

| Tab          | What it is                                                                     |
| ------------ | ------------------------------------------------------------------------------ |
| Status       | Live match state, one-shot or polled, with change and roster deltas            |
| Players      | The roster, with each faction colour resolved by name                          |
| Routes       | All 35 operations, with per-route forms and semantic response rendering        |
| Capabilities | Which routes this server actually implements, and how it spells them           |
| Config       | Read, edit, validate and apply `ServerSettings.ini` with `If-Match`            |
| Log          | Every request the panel made, with status, duration, size and the mapped error |

## The decisions worth knowing

**Read-only by default.** Every non-GET route is disabled until you uncheck
Read-only in the header, and even then a write needs a second confirmation. The
panel is pointed at a live server; a mis-click should not end a match.

**The token is never persisted.** Settings (base URL, transport, proxy endpoint)
go to `localStorage`. The token does not — it is a full-access admin password
with no read-only variant. In proxy mode the panel forwards no `Authorization`
header at all unless you type one, so the backend keeps the credential.

**Proxy by default**, because it is the only transport that works from a browser
against a typical server: no CORS headers, and an HTTPS page may not call a
plaintext loopback listener.

**The API's own list is the source of truth.** The route registry is checked
against the library's `ROUTE_IDS` in `src/lib/routes.test.ts`, so the panel cannot
drift from `spec/openapi.json` without failing its test run.

## Scripts

```bash
pnpm dev         # dev server on :5300, /rcon-proxy forwarded to :8787
pnpm test        # the route registry, the connection layer and the formatters
pnpm run typecheck
pnpm run build   # bundles ../src through the Vite alias
pnpm preview
```

**pnpm here, npm at the root.** The two never meet — this package is installed on
its own, and it is not an npm workspace, so the root `npm install`,
`npm run verify` and the publish path are unaffected by anything in this
directory. CI runs the same split: `npm ci` for the library, `pnpm install
--frozen-lockfile` here.

The port is 5300 rather than Vite's 5173 because Windows commonly reserves a
block (5138–5237) that covers 5173 — binding one of those fails with `EACCES`,
which reads like a permissions problem and is not.

There is no component-test harness: the tests here cover the pure logic, which is
where the panel's actual decisions live. Everything else is verified by using it.

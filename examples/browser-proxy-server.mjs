/**
 * A minimal, dependency-free proxy that lets a browser page talk to a Wardogs
 * RCON server.
 *
 * ## What it is for
 *
 * Two browser restrictions make a direct call impossible on a typical
 * self-hosted server:
 *
 * 1. **CORS.** The server has to answer `OPTIONS` and send
 *    `Access-Control-Allow-Origin`. Nothing in the API reference says it does,
 *    and a dedicated server that never advertises those headers is blocked
 *    before a request lands.
 * 2. **Mixed content.** A loopback listener is plaintext `http://`, and an
 *    HTTPS page may not call it.
 *
 * A same-origin backend has neither problem, because the browser only ever
 * talks to its own origin. It also keeps the RCON password on the server, which
 * is what the reference asks for: the bearer token can kick, ban, replace the
 * config and end a match, with no read-only variant.
 *
 * ## Running it
 *
 * ```bash
 * export WARDOGS_ALLOWED_ORIGINS='https://my-server.example:7776'
 * export WARDOGS_TOKEN='the-rcon-password'
 * node examples/browser-proxy-server.mjs
 * ```
 *
 * Then in the browser:
 *
 * ```js
 * const client = WardogsRCON.createClient({
 *   baseUrl: 'https://my-server.example:7776',
 *   token: '',                       // held by the proxy, never sent here
 *   fetch: WardogsRCON.createProxyFetch({ endpoint: '/rcon-proxy' }),
 * });
 * ```
 *
 * This is a reference, not a hardened service. Read `assertAllowedTarget` and
 * the header handling below before putting it anywhere public.
 */

import { createServer } from 'node:http';

const PORT = Number(process.env.PORT ?? 8787);
const PROXY_PATH = process.env.WARDOGS_PROXY_PATH ?? '/rcon-proxy';

/**
 * Origins this proxy will forward to. **Required.**
 *
 * There is no default and no wildcard. `X-Wardogs-Target` arrives from the
 * browser and is therefore attacker-controlled: a proxy that forwards it
 * blindly is a server-side request forgery primitive pointed at whatever the
 * proxy can reach — cloud metadata endpoints, internal admin panels, the game
 * server's own loopback interface.
 */
const ALLOWED_ORIGINS = (process.env.WARDOGS_ALLOWED_ORIGINS ?? '')
  .split(',')
  .map((value) => value.trim())
  .filter((value) => value !== '');

/**
 * The RCON password to attach to outgoing requests.
 *
 * Holding it here is the point of the proxy — it never reaches the browser.
 * Leave it unset if you would rather the browser send its own token
 * (`createProxyFetch({ token })` forwards one).
 */
const TOKEN = process.env.WARDOGS_TOKEN ?? '';

/** Plaintext `http://` targets are refused unless this is set to `1`. */
const ALLOW_INSECURE = process.env.WARDOGS_ALLOW_INSECURE === '1';

const MAX_BODY_BYTES = 2 * 1024 * 1024;

/** Browser origins allowed to use this proxy. Empty means same-origin only. */
const CORS_ORIGINS = (process.env.WARDOGS_CORS_ORIGINS ?? '')
  .split(',')
  .map((value) => value.trim())
  .filter((value) => value !== '');

/**
 * Decides whether a target may be forwarded to.
 *
 * Compares **origins**, not string prefixes. A prefix check like
 * `target.startsWith('https://my-server')` is passed by
 * `https://my-server.attacker.example`, which is exactly the mistake this
 * function exists to avoid.
 */
function assertAllowedTarget(target) {
  if (ALLOWED_ORIGINS.length === 0) {
    throw new Error(
      'WARDOGS_ALLOWED_ORIGINS is not set. Refusing to forward any target — ' +
        'set it to a comma-separated list of RCON origins, e.g. ' +
        '"https://my-server.example:7776".',
    );
  }

  let url;
  try {
    url = new URL(target);
  } catch {
    throw new Error(`Malformed target: ${JSON.stringify(target)}`);
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error(`Unsupported target protocol: ${url.protocol}`);
  }

  if (url.protocol === 'http:' && !ALLOW_INSECURE) {
    const loopback =
      url.hostname === '127.0.0.1' || url.hostname === 'localhost' || url.hostname === '[::1]';
    if (!loopback) {
      throw new Error(
        `Refusing plaintext http:// to ${url.hostname}. A network-exposed RCON ` +
          'listener requires TLS. Set WARDOGS_ALLOW_INSECURE=1 only if a ' +
          'plaintext tunnel terminates in front of the server.',
      );
    }
  }

  const permitted = ALLOWED_ORIGINS.some((allowed) => {
    try {
      return new URL(allowed).origin === url.origin;
    } catch {
      return false;
    }
  });

  if (!permitted) {
    throw new Error(`Target origin ${url.origin} is not in WARDOGS_ALLOWED_ORIGINS.`);
  }

  return url;
}

function applyCors(request, response) {
  const origin = request.headers.origin;
  if (origin !== undefined && CORS_ORIGINS.includes(origin)) {
    response.setHeader('Access-Control-Allow-Origin', origin);
    response.setHeader('Vary', 'Origin');
  }
  response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  response.setHeader(
    'Access-Control-Allow-Headers',
    'Content-Type, X-Wardogs-Target, X-Wardogs-Method, Authorization',
  );
}

function send(response, status, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  response.end(body);
}

async function readBody(request) {
  const chunks = [];
  let total = 0;

  for await (const chunk of request) {
    total += chunk.length;
    if (total > MAX_BODY_BYTES) {
      throw new Error('Request body too large.');
    }
    chunks.push(chunk);
  }

  return Buffer.concat(chunks);
}

const server = createServer((request, response) => {
  applyCors(request, response);

  if (request.method === 'OPTIONS') {
    response.writeHead(204);
    response.end();
    return;
  }

  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);

  if (url.pathname !== PROXY_PATH) {
    send(response, 404, { error: { code: 'not_found', message: `No route ${url.pathname}` } });
    return;
  }

  if (request.method !== 'POST') {
    send(response, 405, {
      error: { code: 'method_not_allowed', message: 'The proxy accepts POST only.' },
    });
    return;
  }

  void (async () => {
    try {
      // The target may arrive as a header (default) or a query parameter, so a
      // backend that cannot read custom headers still works.
      const target = request.headers['x-wardogs-target'] ?? url.searchParams.get('target');
      const method = String(
        request.headers['x-wardogs-method'] ?? url.searchParams.get('method') ?? 'GET',
      ).toUpperCase();

      if (typeof target !== 'string') {
        send(response, 400, {
          error: {
            code: 'missing_target',
            message: 'Missing X-Wardogs-Target header (or ?target= parameter).',
          },
        });
        return;
      }

      const targetUrl = assertAllowedTarget(target);
      const body = await readBody(request);

      const outgoingHeaders = {
        Accept: 'application/json',
        ...(TOKEN === ''
          ? { Authorization: String(request.headers.authorization ?? '') }
          : { Authorization: `Bearer ${TOKEN}` }),
      };

      // Content-Type is passed through, because the two config endpoints speak
      // text/plain while everything else speaks JSON.
      const contentType = request.headers['content-type'];
      if (contentType !== undefined) outgoingHeaders['Content-Type'] = contentType;

      const upstream = await fetch(targetUrl, {
        method,
        headers: outgoingHeaders,
        ...(body.length > 0 ? { body } : {}),
      });

      const text = await upstream.text();
      response.writeHead(upstream.status, {
        'Content-Type': upstream.headers.get('content-type') ?? 'application/json; charset=utf-8',
        'Content-Length': Buffer.byteLength(text),
      });
      response.end(text);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const status = message.includes('not in WARDOGS_ALLOWED_ORIGINS') ? 403 : 502;
      send(response, status, { error: { code: 'proxy_error', message } });
    }
  })();
});

server.listen(PORT, () => {
  console.log(`Wardogs RCON proxy listening on http://localhost:${PORT}${PROXY_PATH}`);
  if (ALLOWED_ORIGINS.length === 0) {
    console.warn('  ! WARDOGS_ALLOWED_ORIGINS is unset — every request will be refused.');
  } else {
    console.log(`  allowed origins: ${ALLOWED_ORIGINS.join(', ')}`);
  }
  console.log(
    TOKEN === '' ? '  token: forwarded from the browser' : '  token: injected by the proxy',
  );
});

import { describeError } from '../lib/format';
import {
  isPlaintextRemote,
  originOf,
  type ConnectionSettings,
  type TransportMode,
} from '../lib/connection';

export interface ConnectionBarProps {
  settings: ConnectionSettings;
  onSettings(next: ConnectionSettings): void;
  token: string;
  onToken(next: string): void;
  /** Direct-mode override for the library's plaintext refusal. Not persisted. */
  allowPlaintext: boolean;
  onAllowPlaintext(next: boolean): void;
  connected: boolean;
  onConnect(): void;
  onDisconnect(): void;
  error: unknown;
}

/**
 * Where the panel is pointed, and how it gets there.
 *
 * The transport choice is the first decision, so it is the first control. The
 * proxy is the default because it is the only one that works in a typical
 * browser: a self-hosted listener sends no CORS headers, and an HTTPS page
 * cannot call a plaintext loopback listener at all. It also keeps the RCON
 * password — a full-access admin credential — on a backend.
 */
export function ConnectionBar(props: ConnectionBarProps) {
  const {
    settings,
    onSettings,
    token,
    onToken,
    allowPlaintext,
    onAllowPlaintext,
    connected,
    onConnect,
    onDisconnect,
    error,
  } = props;
  const failure = error === null ? null : describeError(error);
  const plaintextRemote = isPlaintextRemote(settings.baseUrl);
  const refusedPlaintext =
    failure !== null && settings.mode === 'direct' && plaintextRemote && !allowPlaintext;

  const setMode = (mode: TransportMode) => {
    onSettings({ ...settings, mode });
  };

  return (
    <section className="connect">
      <div className="row">
        <label>
          RCON base URL
          <input
            value={settings.baseUrl}
            spellCheck={false}
            disabled={connected}
            onChange={(event) => onSettings({ ...settings, baseUrl: event.target.value })}
          />
        </label>

        <label>
          Transport
          <select
            value={settings.mode}
            disabled={connected}
            onChange={(event) => setMode(event.target.value === 'direct' ? 'direct' : 'proxy')}
          >
            <option value="proxy">Proxy — token stays on the backend</option>
            <option value="direct">Direct — the page holds the token</option>
          </select>
        </label>

        {settings.mode === 'proxy' && (
          <label>
            Proxy endpoint
            <input
              value={settings.proxyEndpoint}
              spellCheck={false}
              disabled={connected}
              placeholder="/rcon-proxy"
              onChange={(event) => onSettings({ ...settings, proxyEndpoint: event.target.value })}
            />
          </label>
        )}

        <label>
          {settings.mode === 'proxy' ? 'RCON token (optional)' : 'RCON token'}
          <input
            type="password"
            value={token}
            spellCheck={false}
            disabled={connected}
            placeholder={
              settings.mode === 'proxy'
                ? 'leave blank if the proxy injects it'
                : 'the RCON password'
            }
            onChange={(event) => onToken(event.target.value)}
          />
        </label>

        {connected ? (
          <button type="button" onClick={onDisconnect}>
            Disconnect
          </button>
        ) : (
          <button type="button" className="primary" onClick={onConnect}>
            Connect
          </button>
        )}
      </div>

      <p className="hint">
        {settings.mode === 'proxy' ? (
          <>
            The browser talks to <code>{settings.proxyEndpoint || '(no endpoint)'}</code> only.
            Leave the token blank when the backend holds it — the panel then forwards no{' '}
            <code>Authorization</code> header at all. Fill it in only if your proxy expects the
            browser to supply one.
          </>
        ) : (
          <>
            The page will send the token itself, and the server must answer with CORS headers. The
            token is kept in memory for this tab and is never written to storage.
          </>
        )}
      </p>

      {/* Plaintext to a remote host is the one configuration the library refuses
          by default, and the panel's response to it depends on who connects. */}
      {plaintextRemote &&
        (settings.mode === 'proxy' ? (
          <p className="hint">
            <code>{settings.baseUrl}</code> is plaintext and not loopback. That is the
            backend&rsquo;s call, not this page&rsquo;s — but the proxy has to permit it: put its
            origin in <code>WARDOGS_ALLOWED_ORIGINS</code>, and unless the proxy runs on the same
            machine as the game server, set <code>WARDOGS_ALLOW_INSECURE=1</code> too, or it will
            refuse the target.
          </p>
        ) : (
          <>
            <p className="hint">
              The library refuses plaintext <code>http://</code> to a remote host, because a
              network-exposed RCON listener is not supposed to start without TLS — so this usually
              means the URL wants <code>https://</code>, or that something in front of the server
              terminates TLS. Note that direct mode cannot accept a self-signed certificate: a
              browser rejects the connection outright, so a proxy backend — which can be given your
              CA — is the only way through that.
            </p>
            <label className="inline">
              <input
                type="checkbox"
                checked={allowPlaintext}
                disabled={connected}
                onChange={(event) => onAllowPlaintext(event.target.checked)}
              />
              Send it anyway — my server really does serve plaintext here
            </label>
            <p className="hint">
              That lifts the check for this tab only. It is not stored, and it starts off again on
              reload. It does not make the request work on its own: the server must also answer with
              CORS headers, since the page sends an <code>Authorization</code> header and the
              browser will preflight it. The proxy transport needs neither.
            </p>
          </>
        ))}

      {failure !== null && (
        <div className="failure">
          <strong>{failure.title}</strong>
          {failure.detail !== undefined && <p>{failure.detail}</p>}
          {failure.hint !== undefined && <p className="hint">{failure.hint}</p>}
          {/* Predicted rather than matched against the error's text: the panel
              already knows everything this refusal depends on, so it can say
              which control is responsible instead of leaving the operator to
              connect the message to the checkbox above it. */}
          {refusedPlaintext && (
            <p className="hint">
              That is the plaintext refusal — the switch above lifts it. Be aware it only gets you
              past <em>this</em> check: the page then sends an <code>Authorization</code> header,
              which the browser preflights, so the server has to answer with CORS headers too. To
              skip both, switch the transport to Proxy and run the example proxy with{' '}
              <code>WARDOGS_ALLOWED_ORIGINS={originOf(settings.baseUrl)}</code> and{' '}
              <code>WARDOGS_ALLOW_INSECURE=1</code> — it needs neither CORS nor a plaintext override
              from you, and it can hold the token.
            </p>
          )}
        </div>
      )}
    </section>
  );
}

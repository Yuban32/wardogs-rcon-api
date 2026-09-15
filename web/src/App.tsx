import { useCallback, useMemo, useRef, useState } from 'react';

import {
  SPEC_UPDATED,
  SPEC_VERSION,
  VERSION,
  createCapabilities,
  type CapabilitiesProbe,
  type WardogsClient,
} from '@wardogs/api';

import { CapabilityPanel } from './components/CapabilityPanel';
import { ConfigPanel } from './components/ConfigPanel';
import { ConnectionBar } from './components/ConnectionBar';
import { PlayersPanel } from './components/PlayersPanel';
import { RequestLog } from './components/RequestLog';
import { RouteExplorer } from './components/RouteExplorer';
import { StatusPanel } from './components/StatusPanel';
import {
  createConnectedClient,
  loadSettings,
  saveSettings,
  type ConnectionSettings,
} from './lib/connection';
import {
  SessionContext,
  entryFromError,
  entryFromSuccess,
  type CallInfo,
  type LogEntry,
  type Session,
} from './lib/session';

type Tab = 'status' | 'players' | 'routes' | 'capabilities' | 'config' | 'log';

const TABS: readonly { id: Tab; label: string }[] = [
  { id: 'status', label: 'Status' },
  { id: 'players', label: 'Players' },
  { id: 'routes', label: 'Routes' },
  { id: 'capabilities', label: 'Capabilities' },
  { id: 'config', label: 'Config' },
  { id: 'log', label: 'Log' },
];

/** The log is a debugging aid, not a record; a long session does not need it all. */
const LOG_LIMIT = 200;

interface Connected {
  client: WardogsClient;
  caps: CapabilitiesProbe;
}

export function App() {
  const [settings, setSettings] = useState<ConnectionSettings>(() => loadSettings());
  // Deliberately not persisted, and deliberately not part of `settings`.
  const [token, setToken] = useState('');
  // Same treatment: this one lifts a safety check, so it starts off on every
  // load. `readOnly` is session-scoped for the same reason.
  const [allowPlaintext, setAllowPlaintext] = useState(false);
  const [connected, setConnected] = useState<Connected | null>(null);
  const [connectError, setConnectError] = useState<unknown>(null);
  const [readOnly, setReadOnly] = useState(true);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [tab, setTab] = useState<Tab>('status');
  const nextLogId = useRef(1);

  const connect = useCallback(() => {
    try {
      const client = createConnectedClient(settings, token, { allowPlaintext });
      setConnected({ client, caps: createCapabilities(client) });
      setConnectError(null);
      // Only the settings are stored; see lib/connection.ts on the token and the
      // plaintext override.
      saveSettings(settings);
    } catch (error) {
      // `createClient` validates at construction, so a malformed base URL lands
      // here rather than as a confusing failure on the first request.
      setConnectError(error);
      setConnected(null);
    }
  }, [settings, token, allowPlaintext]);

  const disconnect = useCallback(() => {
    setConnected(null);
    setLog([]);
  }, []);

  /*
   * Every input to the connection clears the last failure.
   *
   * A connect error belongs to the attempt that produced it. Leaving it on
   * screen while the fields under it change is how a panel tells you your fix
   * did not work when you have not tried it yet — tick the plaintext override,
   * and the old refusal sits there looking current.
   */
  const updateSettings = useCallback((next: ConnectionSettings) => {
    setSettings(next);
    setConnectError(null);
  }, []);

  const updateToken = useCallback((next: string) => {
    setToken(next);
    setConnectError(null);
  }, []);

  const updateAllowPlaintext = useCallback((next: boolean) => {
    setAllowPlaintext(next);
    setConnectError(null);
  }, []);

  const call = useCallback(
    async <T,>(info: CallInfo, run: (client: WardogsClient) => Promise<T>): Promise<T> => {
      if (connected === null) throw new Error('Not connected.');

      const started = performance.now();
      try {
        const data = await run(connected.client);
        const entry: LogEntry = {
          ...entryFromSuccess(info, data, performance.now() - started),
          id: nextLogId.current++,
        };
        setLog((previous) => [entry, ...previous].slice(0, LOG_LIMIT));
        return data;
      } catch (error) {
        const entry: LogEntry = {
          ...entryFromError(info, error, performance.now() - started),
          id: nextLogId.current++,
        };
        setLog((previous) => [entry, ...previous].slice(0, LOG_LIMIT));
        throw error;
      }
    },
    [connected],
  );

  const clearLog = useCallback(() => {
    setLog([]);
  }, []);

  const session = useMemo<Session | null>(() => {
    if (connected === null) return null;
    return { client: connected.client, caps: connected.caps, readOnly, log, call, clearLog };
  }, [connected, readOnly, log, call, clearLog]);

  return (
    <div className="app">
      <header className="top">
        <div>
          <h1>Wardogs RCON panel</h1>
          <p className="sub">
            Local control panel for a dedicated server&rsquo;s <code>/v1</code> HTTP API. It talks
            to the server the same way the library does — every request below goes through{' '}
            <code>@yuban32/wardogs-rcon-api</code>.
          </p>
        </div>
        <label className="readonly">
          <input
            type="checkbox"
            checked={readOnly}
            onChange={(event) => setReadOnly(event.target.checked)}
          />
          Read-only
        </label>
      </header>

      <ConnectionBar
        settings={settings}
        onSettings={updateSettings}
        token={token}
        onToken={updateToken}
        allowPlaintext={allowPlaintext}
        onAllowPlaintext={updateAllowPlaintext}
        connected={connected !== null}
        onConnect={connect}
        onDisconnect={disconnect}
        error={connectError}
      />

      {session === null ? (
        <p className="empty">
          Not connected. The panel defaults to the mock server at <code>http://127.0.0.1:7777</code>{' '}
          — start it with <code>node examples/mock-rcon-server.mjs</code>, and the proxy with{' '}
          <code>node examples/browser-proxy-server.mjs</code>, then press Connect.
        </p>
      ) : (
        <SessionContext.Provider value={session}>
          <nav className="tabs">
            {TABS.map((entry) => (
              <button
                key={entry.id}
                type="button"
                className={entry.id === tab ? 'tab active' : 'tab'}
                onClick={() => setTab(entry.id)}
              >
                {entry.label}
                {entry.id === 'log' && log.length > 0 && (
                  <span className="badge">{log.length}</span>
                )}
              </button>
            ))}
          </nav>

          <main className="panel">
            {tab === 'status' && <StatusPanel />}
            {tab === 'players' && <PlayersPanel />}
            {tab === 'routes' && <RouteExplorer />}
            {tab === 'capabilities' && <CapabilityPanel />}
            {tab === 'config' && <ConfigPanel />}
            {tab === 'log' && <RequestLog onClear={clearLog} />}
          </main>
        </SessionContext.Provider>
      )}

      <footer className="foot">
        library {VERSION} · spec {SPEC_VERSION} ({SPEC_UPDATED}) ·{' '}
        {readOnly ? 'writes disabled' : 'writes enabled'}
      </footer>
    </div>
  );
}

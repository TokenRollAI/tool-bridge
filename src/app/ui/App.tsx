import { useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  Braces,
  Copy,
  FileText,
  KeyRound,
  Play,
  RefreshCw,
  Search,
  Server,
  Shield,
} from 'lucide-react';

type AuthMode = 'none' | 'bearer' | 'oauth';

interface AuthConfig {
  mode: AuthMode;
  oauthIssuer?: string;
  oauthAudience?: string;
}

interface ServerSummary {
  id: string;
  name: string;
  endpoint: string;
  description?: string;
  allowedTools?: string[];
}

interface McpTool {
  name: string;
  description?: string;
  inputSchema?: unknown;
  outputSchema?: unknown;
}

interface ServersResponse {
  servers: ServerSummary[];
}

interface ToolsResponse {
  server: ServerSummary;
  tools: McpTool[];
}

interface CallResponse {
  server: ServerSummary;
  tool: string;
  result: unknown;
}

interface AdhocTarget {
  name: string;
  endpoint: string;
  bearerToken: string;
}

const AUTH_TOKEN_KEY = 'toolBridge.authToken';
const ADHOC_KEY = 'toolBridge.adhocTarget';
const DEFAULT_ADHOC_TARGET: AdhocTarget = {
  name: 'context7',
  endpoint: 'https://mcp.context7.com/mcp',
  bearerToken: '',
};

function readSessionValue(key: string): string {
  try {
    return sessionStorage.getItem(key) ?? '';
  } catch {
    return '';
  }
}

function writeSessionValue(key: string, value: string): void {
  try {
    if (value) {
      sessionStorage.setItem(key, value);
    } else {
      sessionStorage.removeItem(key);
    }
  } catch {
    // ignore unavailable storage
  }
}

function readAdhocTarget(): AdhocTarget {
  try {
    const raw = localStorage.getItem(ADHOC_KEY);
    if (!raw) {
      return DEFAULT_ADHOC_TARGET;
    }
    const parsed = JSON.parse(raw) as Partial<AdhocTarget>;
    return {
      name: parsed.name || DEFAULT_ADHOC_TARGET.name,
      endpoint: parsed.endpoint || DEFAULT_ADHOC_TARGET.endpoint,
      bearerToken: parsed.bearerToken || '',
    };
  } catch {
    return DEFAULT_ADHOC_TARGET;
  }
}

function writeAdhocTarget(value: AdhocTarget): void {
  try {
    localStorage.setItem(ADHOC_KEY, JSON.stringify(value));
  } catch {
    // ignore unavailable storage
  }
}

async function api<T>(path: string, token: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set('Accept', 'application/json');
  if (init.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  const response = await fetch(path, { ...init, headers });
  const contentType = response.headers.get('Content-Type') ?? '';
  const payload = contentType.includes('application/json') ? await response.json() : await response.text();
  if (!response.ok) {
    const message =
      typeof payload === 'object' && payload && 'error' in payload
        ? JSON.stringify(payload, null, 2)
        : String(payload);
    throw new Error(message);
  }
  return payload as T;
}

function pretty(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function parseArguments(value: string): Record<string, unknown> {
  if (!value.trim()) {
    return {};
  }
  const parsed = JSON.parse(value) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Arguments must be a JSON object.');
  }
  return parsed as Record<string, unknown>;
}

function toolSchemaSummary(tool: McpTool): string {
  if (!tool.inputSchema) {
    return '{}';
  }
  return pretty(tool.inputSchema);
}

export function App() {
  const [authToken, setAuthToken] = useState(() => readSessionValue(AUTH_TOKEN_KEY));
  const [selectedServerId, setSelectedServerId] = useState<string>('');
  const [selectedTool, setSelectedTool] = useState<string>('');
  const [argumentsText, setArgumentsText] = useState('{}');
  const [adhoc, setAdhoc] = useState<AdhocTarget>(() => readAdhocTarget());
  const [mode, setMode] = useState<'configured' | 'adhoc'>('configured');
  const [copied, setCopied] = useState('');

  const authQuery = useQuery({
    queryKey: ['auth-config'],
    queryFn: () => api<AuthConfig>('/api/auth/config', ''),
  });

  const serversQuery = useQuery({
    queryKey: ['servers', authToken],
    queryFn: () => api<ServersResponse>('/api/servers', authToken),
    enabled: authQuery.data?.mode === 'none' || authToken.length > 0,
  });

  const selectedServer = useMemo(
    () => serversQuery.data?.servers.find((server) => server.id === selectedServerId),
    [selectedServerId, serversQuery.data?.servers]
  );

  const configuredToolsQuery = useQuery({
    queryKey: ['tools', selectedServerId, authToken],
    queryFn: () => api<ToolsResponse>(`/api/servers/${encodeURIComponent(selectedServerId)}/tools`, authToken),
    enabled: mode === 'configured' && selectedServerId.length > 0,
  });

  const adhocToolsMutation = useMutation({
    mutationFn: () =>
      api<ToolsResponse>('/api/bridge/tools', authToken, {
        method: 'POST',
        body: JSON.stringify({
          server: {
            name: adhoc.name,
            endpoint: adhoc.endpoint,
            bearerToken: adhoc.bearerToken || undefined,
          },
        }),
      }),
  });

  const callMutation = useMutation({
    mutationFn: async () => {
      const args = parseArguments(argumentsText);
      if (!selectedTool) {
        throw new Error('Select a tool first.');
      }
      if (mode === 'adhoc') {
        return api<CallResponse>('/api/bridge/call', authToken, {
          method: 'POST',
          body: JSON.stringify({
            server: {
              name: adhoc.name,
              endpoint: adhoc.endpoint,
              bearerToken: adhoc.bearerToken || undefined,
            },
            tool: selectedTool,
            arguments: args,
          }),
        });
      }
      if (!selectedServerId) {
        throw new Error('Select a configured server first.');
      }
      return api<CallResponse>(
        `/api/servers/${encodeURIComponent(selectedServerId)}/tools/${encodeURIComponent(selectedTool)}/call`,
        authToken,
        {
          method: 'POST',
          body: JSON.stringify({ arguments: args }),
        }
      );
    },
  });

  const tools = mode === 'adhoc' ? adhocToolsMutation.data?.tools : configuredToolsQuery.data?.tools;
  const activeServer = mode === 'adhoc' ? adhocToolsMutation.data?.server : selectedServer;
  const authMode = authQuery.data?.mode ?? 'none';
  const bridgeBase = selectedServerId ? `/mcp/${encodeURIComponent(selectedServerId)}` : '';

  function updateAuthToken(value: string) {
    setAuthToken(value);
    writeSessionValue(AUTH_TOKEN_KEY, value);
  }

  function updateAdhoc(next: AdhocTarget) {
    setAdhoc(next);
    writeAdhocTarget(next);
  }

  async function copy(value: string) {
    await navigator.clipboard.writeText(value);
    setCopied(value);
    window.setTimeout(() => setCopied(''), 1200);
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <h1>Tool Bridge</h1>
          <p>HTTP bridge for MCP Streamable HTTP servers</p>
        </div>
        <div className="auth-strip">
          <span className={`auth-pill auth-${authMode}`}>
            <Shield size={15} />
            {authMode}
          </span>
          {authMode !== 'none' ? (
            <label className="token-field">
              <KeyRound size={15} />
              <input
                type="password"
                value={authToken}
                onChange={(event) => updateAuthToken(event.target.value)}
                placeholder="Bearer token"
              />
            </label>
          ) : null}
        </div>
      </header>

      <section className="mode-tabs" aria-label="Bridge mode">
        <button className={mode === 'configured' ? 'active' : ''} onClick={() => setMode('configured')}>
          <Server size={16} />
          Configured
        </button>
        <button className={mode === 'adhoc' ? 'active' : ''} onClick={() => setMode('adhoc')}>
          <Search size={16} />
          Ad-hoc
        </button>
      </section>

      <section className="workspace">
        <aside className="panel server-panel">
          <div className="panel-heading">
            <h2>Servers</h2>
            <button className="icon-button" onClick={() => void serversQuery.refetch()} title="Refresh servers">
              <RefreshCw size={16} />
            </button>
          </div>

          {mode === 'configured' ? (
            <div className="server-list">
              {(serversQuery.data?.servers ?? []).map((server) => (
                <button
                  key={server.id}
                  className={server.id === selectedServerId ? 'server-row selected' : 'server-row'}
                  onClick={() => {
                    setSelectedServerId(server.id);
                    setSelectedTool('');
                  }}
                >
                  <span>{server.name}</span>
                  <small>{server.endpoint}</small>
                </button>
              ))}
              {serversQuery.isError ? <pre className="error-box">{String(serversQuery.error.message)}</pre> : null}
              {serversQuery.data?.servers.length === 0 ? <p className="empty-state">No configured servers</p> : null}
            </div>
          ) : (
            <div className="adhoc-form">
              <label>
                Name
                <input
                  value={adhoc.name}
                  onChange={(event) => updateAdhoc({ ...adhoc, name: event.target.value })}
                />
              </label>
              <label>
                Endpoint
                <input
                  value={adhoc.endpoint}
                  onChange={(event) => updateAdhoc({ ...adhoc, endpoint: event.target.value })}
                  placeholder="https://example.com/mcp"
                />
              </label>
              <label>
                Upstream bearer
                <input
                  type="password"
                  value={adhoc.bearerToken}
                  onChange={(event) => updateAdhoc({ ...adhoc, bearerToken: event.target.value })}
                />
              </label>
              <button
                className="primary-button"
                disabled={!adhoc.endpoint || adhocToolsMutation.isPending}
                onClick={() => {
                  setSelectedTool('');
                  adhocToolsMutation.mutate();
                }}
              >
                <Search size={16} />
                Discover
              </button>
              {adhocToolsMutation.isError ? (
                <pre className="error-box">{String(adhocToolsMutation.error.message)}</pre>
              ) : null}
            </div>
          )}
        </aside>

        <section className="panel tools-panel">
          <div className="panel-heading">
            <div>
              <h2>Tools</h2>
              <p>{activeServer?.endpoint ?? 'Select or discover a server'}</p>
            </div>
            {mode === 'configured' && selectedServerId ? (
              <button className="icon-button" onClick={() => void configuredToolsQuery.refetch()} title="Refresh tools">
                <RefreshCw size={16} />
              </button>
            ) : null}
          </div>

          <div className="tool-list">
            {(tools ?? []).map((tool) => (
              <button
                key={tool.name}
                className={tool.name === selectedTool ? 'tool-row selected' : 'tool-row'}
                onClick={() => {
                  setSelectedTool(tool.name);
                  setArgumentsText('{}');
                }}
              >
                <span>{tool.name}</span>
                <small>{tool.description || 'No description'}</small>
              </button>
            ))}
          </div>

          {configuredToolsQuery.isError ? (
            <pre className="error-box">{String(configuredToolsQuery.error.message)}</pre>
          ) : null}
          {tools?.length === 0 ? <p className="empty-state">No tools returned</p> : null}

          {mode === 'configured' && selectedServerId ? (
            <div className="link-row">
              <button onClick={() => void copy(`${bridgeBase}/~help`)}>
                <Copy size={14} />
                {copied === `${bridgeBase}/~help` ? 'Copied' : '~help'}
              </button>
              <button onClick={() => void copy(`${bridgeBase}/~skill`)}>
                <FileText size={14} />
                {copied === `${bridgeBase}/~skill` ? 'Copied' : '~skill'}
              </button>
            </div>
          ) : null}
        </section>

        <section className="panel call-panel">
          <div className="panel-heading">
            <div>
              <h2>Call</h2>
              <p>{selectedTool || 'No tool selected'}</p>
            </div>
            <button
              className="primary-button compact"
              disabled={!selectedTool || callMutation.isPending}
              onClick={() => callMutation.mutate()}
            >
              <Play size={16} />
              Run
            </button>
          </div>

          <label className="code-label">
            Arguments
            <textarea value={argumentsText} onChange={(event) => setArgumentsText(event.target.value)} />
          </label>

          {selectedTool ? (
            <details className="schema-box">
              <summary>
                <Braces size={15} />
                Input schema
              </summary>
              <pre>{toolSchemaSummary((tools ?? []).find((tool) => tool.name === selectedTool) as McpTool)}</pre>
            </details>
          ) : null}

          {callMutation.isError ? <pre className="error-box">{String(callMutation.error.message)}</pre> : null}
          {callMutation.data ? <pre className="result-box">{pretty(callMutation.data.result)}</pre> : null}
        </section>
      </section>
    </main>
  );
}

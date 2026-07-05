import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Braces,
  ChevronDown,
  ChevronRight,
  Copy,
  KeyRound,
  Network,
  Play,
  RefreshCw,
  Search,
  Server,
  Shield,
  TerminalSquare,
  Trash2,
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
  source?: 'static' | 'dynamic';
}

interface McpTool {
  name: string;
  description?: string;
  inputSchema?: unknown;
  outputSchema?: unknown;
}

interface ServersResponse {
  servers: ServerSummary[];
  dynamicEnabled?: boolean;
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

interface ToolSpec {
  name: string;
  description?: string;
  inputSchema?: unknown;
  outputSchema?: unknown;
}

interface EndpointSpec {
  method: string;
  inputSchema?: unknown;
  outputSchema?: unknown;
  example?: unknown;
  tools?: ToolSpec[];
}

interface CrawlNode {
  kind: 'directory' | 'mcp' | 'http' | 'remote' | 'mount';
  path: string;
  title?: string;
  description?: string;
  helpUrl: string;
  children: CrawlNode[];
  endpoint?: EndpointSpec;
  error?: string;
  truncated?: boolean;
}

interface TreeResponse {
  tree: CrawlNode;
}

type DeviceTool = 'exec.run' | 'fs.read' | 'logs.tail';

interface EndpointRecord {
  id: string;
  tenantId?: string;
  kind: string;
  driver?: string;
  label?: string;
  capabilities: DeviceTool[];
  status: 'offline' | 'online' | 'revoked';
  ssh?: {
    host: string;
    port?: number;
    username: string;
    privateKeyEnv?: string;
    passphraseEnv?: string;
    passwordEnv?: string;
  };
}

interface EndpointsResponse {
  endpoints: EndpointRecord[];
}

interface EndpointResponse {
  endpoint: EndpointRecord;
}

interface SshEndpointDraft {
  id: string;
  tenantId: string;
  label: string;
  host: string;
  port: string;
  username: string;
  privateKeyEnv: string;
  passphraseEnv: string;
  passwordEnv: string;
  execRun: boolean;
  fsRead: boolean;
  logsTail: boolean;
}

const AUTH_TOKEN_KEY = 'toolBridge.authToken';
const ADHOC_KEY = 'toolBridge.adhocTarget';
const SSH_ENDPOINT_KEY = 'toolBridge.sshEndpointDraft';
const DEFAULT_ADHOC_TARGET: AdhocTarget = {
  name: 'context7',
  endpoint: 'https://mcp.context7.com/mcp',
  bearerToken: '',
};
const DEFAULT_SSH_ENDPOINT: SshEndpointDraft = {
  id: 'my-server',
  tenantId: '',
  label: '',
  host: '',
  port: '22',
  username: 'ubuntu',
  privateKeyEnv: '',
  passphraseEnv: '',
  passwordEnv: '',
  execRun: true,
  fsRead: true,
  logsTail: false,
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

function readSshEndpointDraft(): SshEndpointDraft {
  try {
    const raw = localStorage.getItem(SSH_ENDPOINT_KEY);
    if (!raw) {
      return DEFAULT_SSH_ENDPOINT;
    }
    const parsed = JSON.parse(raw) as Partial<SshEndpointDraft>;
    return {
      ...DEFAULT_SSH_ENDPOINT,
      ...parsed,
      execRun: parsed.execRun ?? DEFAULT_SSH_ENDPOINT.execRun,
      fsRead: parsed.fsRead ?? DEFAULT_SSH_ENDPOINT.fsRead,
      logsTail: parsed.logsTail ?? DEFAULT_SSH_ENDPOINT.logsTail,
    };
  } catch {
    return DEFAULT_SSH_ENDPOINT;
  }
}

function writeSshEndpointDraft(value: SshEndpointDraft): void {
  try {
    localStorage.setItem(SSH_ENDPOINT_KEY, JSON.stringify(value));
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

function toolSchemaSummary(tool: McpTool | undefined): string {
  if (!tool?.inputSchema) {
    return '{}';
  }
  return pretty(tool.inputSchema);
}

// Build a starter Arguments object from a tool's JSON Schema: every property
// gets a typed placeholder (required ones first). Beats an empty {} that always
// fails validation, and shows the caller exactly which fields to fill.
function argumentsSkeleton(tool: McpTool | undefined): string {
  const schema = tool?.inputSchema;
  if (!schema || typeof schema !== 'object') {
    return '{}';
  }
  const props = (schema as { properties?: Record<string, unknown> }).properties;
  if (!props || typeof props !== 'object') {
    return '{}';
  }
  const required = new Set(
    Array.isArray((schema as { required?: unknown }).required)
      ? ((schema as { required: unknown[] }).required.filter((r): r is string => typeof r === 'string'))
      : []
  );
  const names = Object.keys(props).sort((a, b) => Number(required.has(b)) - Number(required.has(a)));
  const skeleton: Record<string, unknown> = {};
  for (const name of names) {
    skeleton[name] = placeholderFor((props[name] as { type?: unknown })?.type);
  }
  return pretty(skeleton);
}

function placeholderFor(type: unknown): unknown {
  switch (type) {
    case 'number':
    case 'integer':
      return 0;
    case 'boolean':
      return false;
    case 'array':
      return [];
    case 'object':
      return {};
    default:
      return '';
  }
}

// MCP tool results carry isError when the upstream rejected the call.
function isToolError(result: unknown): boolean {
  return !!result && typeof result === 'object' && (result as { isError?: unknown }).isError === true;
}

function endpointCapabilities(draft: SshEndpointDraft): DeviceTool[] {
  const capabilities: DeviceTool[] = [];
  if (draft.execRun) {
    capabilities.push('exec.run');
  }
  if (draft.fsRead) {
    capabilities.push('fs.read');
  }
  if (draft.logsTail) {
    capabilities.push('logs.tail');
  }
  return capabilities.length > 0 ? capabilities : ['exec.run'];
}

function endpointPayload(draft: SshEndpointDraft): Record<string, unknown> {
  if (!draft.id.trim()) {
    throw new Error('Endpoint id is required.');
  }
  if (!draft.host.trim()) {
    throw new Error('Host is required.');
  }
  if (!draft.username.trim()) {
    throw new Error('Username is required.');
  }
  if (!draft.privateKeyEnv.trim() && !draft.passwordEnv.trim()) {
    throw new Error('Set privateKeyEnv or passwordEnv.');
  }
  const port = Number(draft.port || '22');
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error('Port must be 1-65535.');
  }
  return {
    id: draft.id.trim(),
    tenantId: draft.tenantId.trim() || undefined,
    label: draft.label.trim() || undefined,
    kind: 'ssh-host',
    driver: 'ssh',
    capabilities: endpointCapabilities(draft),
    ssh: {
      host: draft.host.trim(),
      port,
      username: draft.username.trim(),
      privateKeyEnv: draft.privateKeyEnv.trim() || undefined,
      passphraseEnv: draft.passphraseEnv.trim() || undefined,
      passwordEnv: draft.passwordEnv.trim() || undefined,
    },
  };
}

export function App() {
  const [authToken, setAuthToken] = useState(() => readSessionValue(AUTH_TOKEN_KEY));
  const [selectedServerId, setSelectedServerId] = useState<string>('');
  const [selectedTool, setSelectedTool] = useState<string>('');
  const [argumentsText, setArgumentsText] = useState('{}');
  const [adhoc, setAdhoc] = useState<AdhocTarget>(() => readAdhocTarget());
  const [sshDraft, setSshDraft] = useState<SshEndpointDraft>(() => readSshEndpointDraft());
  const [mode, setMode] = useState<'tree' | 'servers' | 'devices'>('tree');
  const [copied, setCopied] = useState('');
  const [docView, setDocView] = useState<string | null>(null);

  const queryClient = useQueryClient();

  const authQuery = useQuery({
    queryKey: ['auth-config'],
    queryFn: () => api<AuthConfig>('/api/auth/config', ''),
  });

  const serversQuery = useQuery({
    queryKey: ['servers', authToken],
    queryFn: () => api<ServersResponse>('/api/servers', authToken),
    enabled: authQuery.data?.mode === 'none' || authToken.length > 0,
  });

  const endpointsQuery = useQuery({
    queryKey: ['endpoints', authToken],
    queryFn: () => api<EndpointsResponse>('/api/endpoints', authToken),
    enabled: mode === 'devices' && authToken.length > 0,
  });

  const selectedServer = useMemo(
    () => serversQuery.data?.servers.find((server) => server.id === selectedServerId),
    [selectedServerId, serversQuery.data?.servers]
  );

  const configuredToolsQuery = useQuery({
    queryKey: ['tools', selectedServerId, authToken],
    queryFn: () => api<ToolsResponse>(`/api/servers/${encodeURIComponent(selectedServerId)}/tools`, authToken),
    enabled: mode === 'servers' && selectedServerId.length > 0,
  });

  // Discover an arbitrary endpoint without saving it: shows its tools as a
  // read-only preview. Saving it (Save to servers) makes it selectable by id.
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

  const saveServerMutation = useMutation({
    mutationFn: () =>
      api<{ server: ServerSummary }>('/api/servers', authToken, {
        method: 'POST',
        body: JSON.stringify({ name: adhoc.name, endpoint: adhoc.endpoint }),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['servers'] });
    },
  });

  const deleteServerMutation = useMutation({
    mutationFn: (id: string) =>
      api<unknown>(`/api/servers/${encodeURIComponent(id)}`, authToken, { method: 'DELETE' }),
    onSuccess: (_data, id) => {
      if (id === selectedServerId) {
        setSelectedServerId('');
        setSelectedTool('');
        setDocView(null);
      }
      void queryClient.invalidateQueries({ queryKey: ['servers'] });
    },
  });

  const createEndpointMutation = useMutation({
    mutationFn: () =>
      api<EndpointResponse>('/api/endpoints', authToken, {
        method: 'POST',
        body: JSON.stringify(endpointPayload(sshDraft)),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['endpoints'] });
      void queryClient.invalidateQueries({ queryKey: ['tree'] });
    },
  });

  const revokeEndpointMutation = useMutation({
    mutationFn: (id: string) =>
      api<EndpointResponse>(`/api/endpoints/${encodeURIComponent(id)}`, authToken, { method: 'DELETE' }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['endpoints'] });
      void queryClient.invalidateQueries({ queryKey: ['tree'] });
    },
  });

  const treeQuery = useQuery({
    queryKey: ['tree', authToken],
    queryFn: () => api<TreeResponse>('/api/tree', authToken),
    enabled: mode === 'tree' && (authQuery.data?.mode === 'none' || authToken.length > 0),
  });

  const callMutation = useMutation({
    mutationFn: async () => {
      const args = parseArguments(argumentsText);
      if (!selectedTool) {
        throw new Error('Select a tool first.');
      }
      if (!selectedServerId) {
        throw new Error('Select a saved server first.');
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

  // Tools come from the selected saved server; a freshly discovered (unsaved)
  // server shows its tools as a read-only preview from the discover mutation.
  const tools = selectedServerId ? configuredToolsQuery.data?.tools : adhocToolsMutation.data?.tools;
  const activeServer = selectedServerId ? selectedServer : adhocToolsMutation.data?.server;
  const authMode = authQuery.data?.mode ?? 'none';

  function updateAuthToken(value: string) {
    setAuthToken(value);
    writeSessionValue(AUTH_TOKEN_KEY, value);
  }

  function updateAdhoc(next: AdhocTarget) {
    setAdhoc(next);
    writeAdhocTarget(next);
  }

  function updateSshDraft(next: SshEndpointDraft) {
    setSshDraft(next);
    writeSshEndpointDraft(next);
  }

  async function copy(value: string) {
    await navigator.clipboard.writeText(value);
    setCopied(value);
    window.setTimeout(() => setCopied(''), 1200);
  }

  // Fetch and display the node's JSON ~help inline instead of only copying the URL.
  async function viewDoc() {
    if (!selectedServerId) {
      return;
    }
    const url = `/htbp/${encodeURIComponent(selectedServerId)}/~help`;
    try {
      const headers = new Headers({ Accept: 'application/json' });
      if (authToken) {
        headers.set('Authorization', `Bearer ${authToken}`);
      }
      const response = await fetch(url, { headers });
      const raw = await response.text();
      const body = response.headers.get('Content-Type')?.includes('application/json')
        ? pretty(JSON.parse(raw))
        : raw;
      setDocView(response.ok ? body : `HTTP ${response.status}\n\n${body}`);
    } catch (error) {
      setDocView(error instanceof Error ? error.message : String(error));
    }
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
          <label className="token-field">
            <KeyRound size={15} />
            <input
              type="password"
              value={authToken}
              onChange={(event) => updateAuthToken(event.target.value)}
              placeholder="Admin/API key"
            />
          </label>
        </div>
      </header>

      <section className="mode-tabs" aria-label="Bridge mode">
        <button className={mode === 'tree' ? 'active' : ''} onClick={() => setMode('tree')}>
          <Network size={16} />
          Tree
        </button>
        <button className={mode === 'servers' ? 'active' : ''} onClick={() => setMode('servers')}>
          <Server size={16} />
          Servers
        </button>
        <button className={mode === 'devices' ? 'active' : ''} onClick={() => setMode('devices')}>
          <TerminalSquare size={16} />
          Devices
        </button>
      </section>

      {mode === 'tree' ? (
        <section className="workspace tree-workspace">
          <section className="panel tree-panel">
            <div className="panel-heading">
              <div>
                <h2>Tree</h2>
                <p>Recursive HTBP walk from the root</p>
              </div>
              <button className="icon-button" onClick={() => void treeQuery.refetch()} title="Refresh tree">
                <RefreshCw size={16} />
              </button>
            </div>
            {treeQuery.isError ? <pre className="error-box">{String(treeQuery.error.message)}</pre> : null}
            {treeQuery.isLoading ? <p className="empty-state">Crawling…</p> : null}
            {treeQuery.data ? (
              <div className="tree-view">
                <TreeNodeRow node={treeQuery.data.tree} depth={0} onCopy={copy} copied={copied} authToken={authToken} />
              </div>
            ) : null}
          </section>
        </section>
      ) : mode === 'devices' ? (
        <section className="workspace">
          <div className="workspace-row device-row">
            <section className="panel device-form-panel">
              <div className="panel-heading">
                <div>
                  <h2>SSH Endpoint</h2>
                  <p>Register a remote host as /~device</p>
                </div>
              </div>
              <div className="device-form">
                <label>
                  ID
                  <input value={sshDraft.id} onChange={(event) => updateSshDraft({ ...sshDraft, id: event.target.value })} />
                </label>
                <label>
                  Tenant
                  <input
                    value={sshDraft.tenantId}
                    onChange={(event) => updateSshDraft({ ...sshDraft, tenantId: event.target.value })}
                    placeholder="optional"
                  />
                </label>
                <label>
                  Label
                  <input
                    value={sshDraft.label}
                    onChange={(event) => updateSshDraft({ ...sshDraft, label: event.target.value })}
                    placeholder="optional"
                  />
                </label>
                <label>
                  Host
                  <input
                    value={sshDraft.host}
                    onChange={(event) => updateSshDraft({ ...sshDraft, host: event.target.value })}
                    placeholder="203.0.113.10"
                  />
                </label>
                <label>
                  Port
                  <input value={sshDraft.port} onChange={(event) => updateSshDraft({ ...sshDraft, port: event.target.value })} />
                </label>
                <label>
                  Username
                  <input
                    value={sshDraft.username}
                    onChange={(event) => updateSshDraft({ ...sshDraft, username: event.target.value })}
                  />
                </label>
                <label>
                  Private key secret
                  <input
                    value={sshDraft.privateKeyEnv}
                    onChange={(event) => updateSshDraft({ ...sshDraft, privateKeyEnv: event.target.value })}
                    placeholder="MY_SERVER_SSH_KEY"
                  />
                </label>
                <label>
                  Passphrase secret
                  <input
                    value={sshDraft.passphraseEnv}
                    onChange={(event) => updateSshDraft({ ...sshDraft, passphraseEnv: event.target.value })}
                    placeholder="optional"
                  />
                </label>
                <label>
                  Password secret
                  <input
                    value={sshDraft.passwordEnv}
                    onChange={(event) => updateSshDraft({ ...sshDraft, passwordEnv: event.target.value })}
                    placeholder="MY_SERVER_SSH_PASSWORD"
                  />
                </label>
                <fieldset className="device-form-wide capability-fieldset">
                  <legend>Capabilities</legend>
                  <label>
                    <input
                      type="checkbox"
                      checked={sshDraft.execRun}
                      onChange={(event) => updateSshDraft({ ...sshDraft, execRun: event.target.checked })}
                    />
                    exec.run
                  </label>
                  <label>
                    <input
                      type="checkbox"
                      checked={sshDraft.fsRead}
                      onChange={(event) => updateSshDraft({ ...sshDraft, fsRead: event.target.checked })}
                    />
                    fs.read
                  </label>
                  <label>
                    <input
                      type="checkbox"
                      checked={sshDraft.logsTail}
                      onChange={(event) => updateSshDraft({ ...sshDraft, logsTail: event.target.checked })}
                    />
                    logs.tail
                  </label>
                </fieldset>
                <p className="empty-state device-form-wide">Secret values are created in Cloudflare; this form stores only their names.</p>
                <button
                  className="primary-button device-form-wide"
                  disabled={!authToken || createEndpointMutation.isPending}
                  onClick={() => createEndpointMutation.mutate()}
                >
                  <TerminalSquare size={16} />
                  Register endpoint
                </button>
                {createEndpointMutation.isError ? (
                  <pre className="error-box device-form-wide">{String(createEndpointMutation.error.message)}</pre>
                ) : null}
                {createEndpointMutation.data ? (
                  <pre className="result-box device-form-wide">{pretty(createEndpointMutation.data.endpoint)}</pre>
                ) : null}
              </div>
            </section>

            <aside className="panel device-list-panel">
              <div className="panel-heading">
                <div>
                  <h2>Endpoints</h2>
                  <p>{endpointsQuery.data?.endpoints.length ?? 0} registered</p>
                </div>
                <button className="icon-button" onClick={() => void endpointsQuery.refetch()} title="Refresh endpoints">
                  <RefreshCw size={16} />
                </button>
              </div>
              <div className="server-list">
                {(endpointsQuery.data?.endpoints ?? []).map((endpoint) => {
                  const execPath = `/htbp/~device/${encodeURIComponent(endpoint.id)}/exec.run`;
                  return (
                    <div key={endpoint.id} className="endpoint-row">
                      <div>
                        <span>{endpoint.label || endpoint.id}</span>
                        <small>
                          {endpoint.driver ?? 'tunnel'} · {endpoint.status} · {endpoint.capabilities.join(', ')}
                        </small>
                        {endpoint.ssh ? (
                          <small>
                            {endpoint.ssh.username}@{endpoint.ssh.host}:{endpoint.ssh.port ?? 22}
                          </small>
                        ) : null}
                      </div>
                      <div className="endpoint-actions">
                        <button className="icon-button" onClick={() => void copy(execPath)} title="Copy exec path">
                          <Copy size={14} />
                        </button>
                        {endpoint.status !== 'revoked' ? (
                          <button
                            className="icon-button"
                            onClick={() => revokeEndpointMutation.mutate(endpoint.id)}
                            title="Revoke endpoint"
                          >
                            <Trash2 size={14} />
                          </button>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
                {!authToken ? <p className="empty-state">Enter an admin/API key to manage endpoints.</p> : null}
                {endpointsQuery.isLoading ? <p className="empty-state">Loading endpoints…</p> : null}
                {endpointsQuery.isError ? <pre className="error-box">{String(endpointsQuery.error.message)}</pre> : null}
                {revokeEndpointMutation.isError ? (
                  <pre className="error-box">{String(revokeEndpointMutation.error.message)}</pre>
                ) : null}
                {endpointsQuery.data?.endpoints.length === 0 ? <p className="empty-state">No registered endpoints</p> : null}
                {copied ? <p className="empty-state">Copied {copied}</p> : null}
              </div>
            </aside>
          </div>
        </section>
      ) : (
      <section className="workspace">
        <div className="workspace-row select-row">
          <section className="panel discover-panel">
            <div className="panel-heading">
              <h2>Discover</h2>
            </div>
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
              <button
                className="primary-button"
                disabled={!adhoc.endpoint || adhocToolsMutation.isPending}
                onClick={() => {
                  setSelectedServerId('');
                  setSelectedTool('');
                  setDocView(null);
                  saveServerMutation.reset();
                  adhocToolsMutation.mutate();
                }}
              >
                <Search size={16} />
                Discover
              </button>
              {adhocToolsMutation.isError ? (
                <pre className="error-box">{String(adhocToolsMutation.error.message)}</pre>
              ) : null}
              {adhocToolsMutation.isSuccess ? (
                <button
                  className="primary-button"
                  disabled={saveServerMutation.isPending}
                  onClick={() => saveServerMutation.mutate()}
                >
                  <Server size={16} />
                  Save to servers
                </button>
              ) : null}
              {saveServerMutation.isError ? (
                <pre className="error-box">{String(saveServerMutation.error.message)}</pre>
              ) : null}
              {saveServerMutation.isSuccess ? (
                <p className="empty-state">Saved — may take a few seconds to appear in the list (KV).</p>
              ) : null}
            </div>
          </section>

          <aside className="panel server-panel">
            <div className="panel-heading">
              <h2>Servers</h2>
              <button className="icon-button" onClick={() => void serversQuery.refetch()} title="Refresh servers">
                <RefreshCw size={16} />
              </button>
            </div>

            <div className="server-list">
              {(serversQuery.data?.servers ?? []).map((server) => (
                <button
                  key={server.id}
                  className={server.id === selectedServerId ? 'server-row selected' : 'server-row'}
                  onClick={() => {
                    setSelectedServerId(server.id);
                    setSelectedTool('');
                    setDocView(null);
                  }}
                >
                  <span>{server.name}</span>
                  <small>{server.endpoint}</small>
                  {server.source === 'dynamic' ? (
                    <span
                      className="icon-button"
                      role="button"
                      title="Delete server"
                      onClick={(event) => {
                        event.stopPropagation();
                        deleteServerMutation.mutate(server.id);
                      }}
                    >
                      <Trash2 size={14} />
                    </span>
                  ) : null}
                </button>
              ))}
              {serversQuery.isError ? <pre className="error-box">{String(serversQuery.error.message)}</pre> : null}
              {deleteServerMutation.isError ? (
                <pre className="error-box">{String(deleteServerMutation.error.message)}</pre>
              ) : null}
              {serversQuery.data?.servers.length === 0 ? <p className="empty-state">No configured servers</p> : null}
            </div>
          </aside>
        </div>

        <div className="workspace-row use-row">
        <section className="panel tools-panel">
          <div className="panel-heading">
            <div>
              <h2>Tools</h2>
              <p>{activeServer?.endpoint ?? 'Select or discover a server'}</p>
            </div>
            {selectedServerId ? (
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
                  setArgumentsText(argumentsSkeleton(tool));
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
          {selectedServerId && configuredToolsQuery.isFetching ? (
            <p className="empty-state">Loading tools…</p>
          ) : null}
          {adhocToolsMutation.isPending ? <p className="empty-state">Discovering…</p> : null}
          {!selectedServerId && !adhocToolsMutation.data && !adhocToolsMutation.isPending ? (
            <p className="empty-state">Select or discover a server</p>
          ) : null}
          {tools?.length === 0 && !configuredToolsQuery.isFetching && !adhocToolsMutation.isPending ? (
            <p className="empty-state">No tools returned</p>
          ) : null}

          {selectedServerId ? (
            <>
              <div className="link-row">
                <button onClick={() => void viewDoc()}>
                  <Braces size={14} />
                  ~help
                </button>
              </div>
              {docView ? (
                <details className="schema-box" open>
                  <summary>
                    <Braces size={15} />
                    ~help (JSON)
                  </summary>
                  <pre>{docView}</pre>
                </details>
              ) : null}
            </>
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
              <pre>{toolSchemaSummary((tools ?? []).find((tool) => tool.name === selectedTool))}</pre>
            </details>
          ) : null}

          {callMutation.isError ? <pre className="error-box">{String(callMutation.error.message)}</pre> : null}
          {callMutation.data ? (
            <pre className={isToolError(callMutation.data.result) ? 'result-box result-error' : 'result-box'}>
              {isToolError(callMutation.data.result) ? '⚠ Tool returned an error:\n\n' : ''}
              {pretty(callMutation.data.result)}
            </pre>
          ) : null}
        </section>
        </div>
      </section>
      )}
    </main>
  );
}

interface TreeNodeRowProps {
  node: CrawlNode;
  depth: number;
  onCopy: (value: string) => void;
  copied: string;
  authToken: string;
}

function TreeNodeRow({ node, depth, onCopy, copied, authToken }: TreeNodeRowProps) {
  const expandable = node.children.length > 0 || !!node.endpoint;
  const [expanded, setExpanded] = useState(depth < 2);
  const [help, setHelp] = useState<string | null>(null);
  const kindLabel = node.kind === 'remote' ? 'remote ⇄' : node.kind;

  // Fetch this node's own ~help (every level — root / directory / leaf — has one).
  async function loadHelp() {
    if (help !== null) {
      setHelp(null);
      return;
    }
    try {
      const headers = new Headers({ Accept: 'application/json' });
      if (authToken) {
        headers.set('Authorization', `Bearer ${authToken}`);
      }
      const response = await fetch(node.helpUrl, { headers });
      const raw = await response.text();
      const body = response.headers.get('Content-Type')?.includes('application/json')
        ? pretty(JSON.parse(raw))
        : raw;
      setHelp(response.ok ? body : `HTTP ${response.status}\n\n${body}`);
    } catch (error) {
      setHelp(error instanceof Error ? error.message : String(error));
    }
  }

  return (
    <div className="tree-node">
      <div className="tree-row">
        <button
          className="tree-toggle"
          onClick={() => setExpanded((value) => !value)}
          disabled={!expandable}
          title={expandable ? 'Toggle' : 'Leaf'}
        >
          {expandable ? expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} /> : <span className="tree-dot" />}
        </button>
        <span className={`tree-kind tree-kind-${node.kind}`}>{kindLabel}</span>
        <span className="tree-title">{node.title || node.path}</span>
        <button className="tree-action" onClick={() => void loadHelp()} title="View this node's ~help">
          <Braces size={12} />
          ~help
        </button>
        <span className="tree-spacer" />
        {node.endpoint ? <span className="tree-method">{node.endpoint.method}</span> : null}
        {node.endpoint?.tools ? <span className="tree-flag">{node.endpoint.tools.length} tools</span> : null}
        {node.truncated ? <span className="tree-flag">truncated</span> : null}
        <button className="tree-copy" onClick={() => onCopy(node.helpUrl)} title="Copy ~help URL">
          <Copy size={13} />
          {copied === node.helpUrl ? 'Copied' : ''}
        </button>
      </div>
      {help !== null ? (
        <details className="schema-box" style={{ marginLeft: '28px' }} open>
          <summary>
            <Braces size={15} />
            {node.helpUrl}
          </summary>
          <pre>{help}</pre>
        </details>
      ) : null}
      {node.description ? (
        <p className="tree-desc" style={{ paddingLeft: '28px' }}>
          {node.description}
        </p>
      ) : null}
      {node.error ? (
        <pre className="error-box" style={{ marginLeft: '28px' }}>
          {node.error}
        </pre>
      ) : null}
      {expanded && node.endpoint?.tools ? (
        <div className="tree-tools" style={{ marginLeft: '28px' }}>
          {node.endpoint.tools.map((tool) => (
            <details key={tool.name} className="schema-box">
              <summary>
                <Braces size={15} />
                {tool.name}
              </summary>
              {tool.description ? <p className="tree-desc">{tool.description}</p> : null}
              <pre>{pretty(tool.inputSchema ?? {})}</pre>
            </details>
          ))}
          {node.endpoint.tools.length === 0 ? <p className="empty-state">No tools exposed</p> : null}
        </div>
      ) : null}
      {expanded && node.endpoint && !node.endpoint.tools ? (
        <details className="schema-box" style={{ marginLeft: '28px' }} open>
          <summary>
            <Braces size={15} />
            Input schema
          </summary>
          <pre>{pretty(node.endpoint.inputSchema ?? {})}</pre>
        </details>
      ) : null}
      {expanded && node.children.length > 0 ? (
        <div className="tree-children">
          {node.children.map((child) => (
            <TreeNodeRow key={child.path} node={child} depth={depth + 1} onCopy={onCopy} copied={copied} authToken={authToken} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

// MCP Streamable HTTP client.
//
// Migrated verbatim (behavior-preserving) from the original worker: the full
// initialize -> notifications/initialized -> request -> DELETE teardown
// handshake, including SSE response parsing, session id handling, and bounded
// reads. Used by the MCP adapter to list and call tools on an upstream server.

import { AppEnv, McpNode } from './types';
import { materializeHeaders, requireSecureUrl } from './materialize';
import {
  CLIENT_NAME,
  CLIENT_VERSION,
  MAX_JSON_BYTES,
  MAX_SSE_BYTES,
  MCP_PROTOCOL_VERSION,
  isRecord,
  readBoundedText,
  safeErrorText,
} from './util';

export interface McpTool {
  name: string;
  description?: string;
  inputSchema?: unknown;
  outputSchema?: unknown;
  annotations?: unknown;
}

export interface ResolvedMcpServer {
  id: string;
  endpoint: string;
  allowedTools?: string[];
  resolvedHeaders: Record<string, string>;
}

interface RpcPayload {
  jsonrpc: '2.0';
  id?: string;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

interface RpcResult {
  result: unknown;
  sessionId?: string;
}

export function resolveMcpServer(env: AppEnv, node: McpNode): ResolvedMcpServer {
  return {
    id: node.id,
    endpoint: requireSecureUrl(env, node.endpoint, `MCP endpoint for '${node.id}'`),
    allowedTools: node.allowedTools,
    resolvedHeaders: materializeHeaders(env, node.headers),
  };
}

export async function listMcpTools(server: ResolvedMcpServer): Promise<McpTool[]> {
  const result = await executeMcpRequest(server, 'tools/list', {});
  const tools = isRecord(result) && Array.isArray(result.tools) ? result.tools : [];
  const filtered = tools.map(normalizeTool).filter(Boolean) as McpTool[];
  if (!server.allowedTools || server.allowedTools.length === 0) {
    return filtered;
  }
  const allow = new Set(server.allowedTools);
  return filtered.filter((tool) => allow.has(tool.name));
}

export async function callMcpTool(server: ResolvedMcpServer, toolName: string, args: unknown): Promise<unknown> {
  if (server.allowedTools && server.allowedTools.length > 0 && !server.allowedTools.includes(toolName)) {
    throw new Error(`Tool '${toolName}' is not allowed for server '${server.id}'.`);
  }
  return executeMcpRequest(server, 'tools/call', {
    name: toolName,
    arguments: isRecord(args) ? args : {},
  });
}

async function executeMcpRequest(server: ResolvedMcpServer, method: string, params: unknown): Promise<unknown> {
  const initialized = await initializeMcpSession(server);
  try {
    await sendMcpNotification(server, initialized.sessionId, 'notifications/initialized', {});
    const response = await sendMcpRequest(server, initialized.sessionId, method, params);
    return response.result;
  } finally {
    if (initialized.sessionId) {
      await terminateMcpSession(server, initialized.sessionId).catch(() => {});
    }
  }
}

async function initializeMcpSession(server: ResolvedMcpServer): Promise<{ sessionId?: string }> {
  const response = await sendMcpRequest(server, undefined, 'initialize', {
    protocolVersion: MCP_PROTOCOL_VERSION,
    capabilities: {},
    clientInfo: { name: CLIENT_NAME, version: CLIENT_VERSION },
  });
  return { sessionId: response.sessionId };
}

async function sendMcpNotification(
  server: ResolvedMcpServer,
  sessionId: string | undefined,
  method: string,
  params: unknown
): Promise<void> {
  const response = await fetch(server.endpoint, {
    method: 'POST',
    headers: mcpHeaders(server, sessionId),
    body: JSON.stringify({ jsonrpc: '2.0', method, params }),
  });
  if (response.status === 202) {
    return;
  }
  if (!response.ok) {
    throw new Error(`MCP notification '${method}' failed with HTTP ${response.status}.`);
  }
}

async function sendMcpRequest(
  server: ResolvedMcpServer,
  sessionId: string | undefined,
  method: string,
  params: unknown
): Promise<RpcResult> {
  const id = crypto.randomUUID();
  const response = await fetch(server.endpoint, {
    method: 'POST',
    headers: mcpHeaders(server, sessionId),
    body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
  });
  if (!response.ok) {
    throw new Error(`MCP request '${method}' failed with HTTP ${response.status}: ${await safeErrorText(response)}`);
  }
  const payload = await readRpcResponse(response, id);
  if (payload.error) {
    throw new Error(`MCP error ${payload.error.code}: ${payload.error.message}`);
  }
  return {
    result: payload.result,
    sessionId: response.headers.get('MCP-Session-Id') ?? undefined,
  };
}

function mcpHeaders(server: ResolvedMcpServer, sessionId: string | undefined): Headers {
  const headers = new Headers(server.resolvedHeaders);
  headers.set('Accept', 'application/json, text/event-stream');
  headers.set('Content-Type', 'application/json');
  headers.set('MCP-Protocol-Version', MCP_PROTOCOL_VERSION);
  if (sessionId) {
    headers.set('MCP-Session-Id', sessionId);
  }
  return headers;
}

async function readRpcResponse(response: Response, id: string): Promise<RpcPayload> {
  const contentType = response.headers.get('Content-Type') ?? '';
  if (contentType.includes('text/event-stream')) {
    return readSseRpcResponse(response, id);
  }
  const textValue = await readBoundedText(response, MAX_JSON_BYTES);
  const payload = JSON.parse(textValue) as RpcPayload;
  if (payload.id !== id) {
    throw new Error(`Unexpected MCP response id '${String(payload.id)}'.`);
  }
  return payload;
}

async function readSseRpcResponse(response: Response, id: string): Promise<RpcPayload> {
  if (!response.body) {
    throw new Error('MCP server returned an empty SSE response.');
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let eventData: string[] = [];
  let bytes = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    bytes += value.byteLength;
    if (bytes > MAX_SSE_BYTES) {
      throw new Error('MCP SSE response exceeded the maximum size.');
    }
    buffer += decoder.decode(value, { stream: true });
    let newlineIndex = buffer.indexOf('\n');
    while (newlineIndex >= 0) {
      const rawLine = buffer.slice(0, newlineIndex);
      buffer = buffer.slice(newlineIndex + 1);
      const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
      if (line === '') {
        const payload = parseSseData(eventData);
        eventData = [];
        if (payload && payload.id === id) {
          return payload;
        }
      } else if (line.startsWith('data:')) {
        eventData.push(line.slice(5).trimStart());
      }
      newlineIndex = buffer.indexOf('\n');
    }
  }

  const payload = parseSseData(eventData);
  if (payload && payload.id === id) {
    return payload;
  }
  throw new Error(`MCP SSE stream ended before response '${id}' was received.`);
}

function parseSseData(lines: string[]): RpcPayload | undefined {
  if (lines.length === 0) {
    return undefined;
  }
  const data = lines.join('\n').trim();
  if (!data.startsWith('{')) {
    return undefined;
  }
  return JSON.parse(data) as RpcPayload;
}

async function terminateMcpSession(server: ResolvedMcpServer, sessionId: string): Promise<void> {
  await fetch(server.endpoint, {
    method: 'DELETE',
    headers: mcpHeaders(server, sessionId),
  });
}

function normalizeTool(value: unknown): McpTool | undefined {
  if (!isRecord(value) || typeof value.name !== 'string') {
    return undefined;
  }
  return {
    name: value.name,
    description: typeof value.description === 'string' ? value.description : undefined,
    inputSchema: value.inputSchema,
    outputSchema: value.outputSchema,
    annotations: value.annotations,
  };
}

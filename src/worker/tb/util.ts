// Shared utilities for the Tool Bridge worker host and the TB SDK modules.
// Extracted from the original single-file worker so adapters/registry/help can reuse them.

export const MCP_PROTOCOL_VERSION = '2025-11-25';
export const CLIENT_NAME = 'tool-bridge';
export const CLIENT_VERSION = 'draft';
export const MAX_JSON_BYTES = 1_000_000;
export const MAX_SSE_BYTES = 4_000_000;
export const REMOTE_FETCH_TIMEOUT_MS = 5_000;

export type JsonObject = Record<string, unknown>;

export function json(data: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set('Content-Type', 'application/json; charset=utf-8');
  return new Response(JSON.stringify(data, null, 2), { ...init, headers });
}

export function text(data: string, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set('Content-Type', headers.get('Content-Type') ?? 'text/plain; charset=utf-8');
  return new Response(data, { ...init, headers });
}

export function errorResponse(status: number, code: string, message: string, details?: unknown): Response {
  return json({ error: { code, message, details } }, { status });
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

export function stringField(value: Record<string, unknown>, key: string): string | undefined {
  const raw = value[key];
  return typeof raw === 'string' && raw.length > 0 ? raw : undefined;
}

export function recordOfStrings(value: unknown): Record<string, string> | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const result: Record<string, string> = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === 'string') {
      result[key] = item;
    }
  }
  return result;
}

export function arrayOfStrings(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  return value.filter((item): item is string => typeof item === 'string');
}

export function oneLine(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function readBoundedText(response: Response, maxBytes: number): Promise<string> {
  if (!response.body) {
    return '';
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let result = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      return result + decoder.decode();
    }
    bytes += value.byteLength;
    if (bytes > maxBytes) {
      throw new Error('Response body exceeded the maximum size.');
    }
    result += decoder.decode(value, { stream: true });
  }
}

export async function safeErrorText(response: Response): Promise<string> {
  try {
    return await readBoundedText(response, 8_000);
  } catch {
    return '';
  }
}

// Thrown when a path/tool does not resolve to a node; the host maps it to 404.
export class NotFoundError extends Error {}

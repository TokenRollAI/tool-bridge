import { Buffer } from 'buffer';
import { BadRequestError, EndpointUnavailableError, UpstreamError } from './errors';
import { safeErrorText } from './util';
import type { CloudflareSandboxEndpointConfig, DeviceTool, ExecutionDriver, ExecutionDriverRequest } from './device';

export interface CloudflareSandboxExecutionDriverOptions {
  fetch?: typeof fetch;
}

export interface CloudflareSandboxExecResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  stdoutTruncated?: boolean;
  stderrTruncated?: boolean;
  durationMs: number;
}

export function createCloudflareSandboxExecutionDriver(options: CloudflareSandboxExecutionDriverOptions = {}): ExecutionDriver {
  const fetcher = options.fetch ?? fetch;
  return {
    async dispatch(request) {
      if (request.endpoint.driver !== 'cloudflare-sandbox' || !request.endpoint.cloudflareSandbox) {
        throw new BadRequestError(`Endpoint '${request.endpoint.id}' is not configured for cloudflare-sandbox.`);
      }
      return runWithTimeout(request.deadlineMs, () => dispatchSandbox(request, request.endpoint.cloudflareSandbox!, fetcher));
    },
  };
}

async function dispatchSandbox(
  request: ExecutionDriverRequest,
  config: CloudflareSandboxEndpointConfig,
  fetcher: typeof fetch
): Promise<unknown> {
  if (request.tool === 'exec.run') {
    return runExec(request, config, fetcher);
  }
  if (request.tool === 'fs.read') {
    return runFsRead(request, config, fetcher);
  }
  return unsupportedTool(request.tool);
}

async function runExec(
  request: ExecutionDriverRequest,
  config: CloudflareSandboxEndpointConfig,
  fetcher: typeof fetch
): Promise<CloudflareSandboxExecResult> {
  const argv = Array.isArray(request.input.argv) ? request.input.argv : undefined;
  if (!argv || argv.length === 0 || !argv.every((part): part is string => typeof part === 'string' && part.length > 0)) {
    throw new BadRequestError('exec.run requires non-empty argv: string[].');
  }
  const startedAt = Date.now();
  const res = await fetcher(sandboxUrl(request.env, config, `/v1/sandbox/${encodeURIComponent(config.sandboxId)}/exec`), {
    method: 'POST',
    headers: requestHeaders(request.env, config),
    body: JSON.stringify({
      argv,
      cwd: typeof request.input.cwd === 'string' ? request.input.cwd : undefined,
      timeout_ms: typeof request.input.timeoutMs === 'number' ? request.input.timeoutMs : request.deadlineMs,
    }),
  });
  if (!res.ok) {
    throw new UpstreamError(`Cloudflare sandbox exec failed (${res.status}): ${await safeErrorText(res)}`);
  }
  const parsed = parseSandboxSse(await res.text(), request.maxOutputBytes);
  return { ...parsed, durationMs: Date.now() - startedAt };
}

async function runFsRead(
  request: ExecutionDriverRequest,
  config: CloudflareSandboxEndpointConfig,
  fetcher: typeof fetch
): Promise<unknown> {
  const path = typeof request.input.path === 'string' ? request.input.path : undefined;
  if (!path) {
    throw new BadRequestError('fs.read requires path.');
  }
  const res = await fetcher(sandboxUrl(request.env, config, `/v1/sandbox/${encodeURIComponent(config.sandboxId)}/file/${filePath(path)}`), {
    method: 'GET',
    headers: requestHeaders(request.env, config, false),
  });
  if (!res.ok) {
    throw new UpstreamError(`Cloudflare sandbox file read failed (${res.status}): ${await safeErrorText(res)}`);
  }
  const content = await boundedText(res, Math.min(typeof request.input.maxBytes === 'number' ? request.input.maxBytes : request.maxOutputBytes, request.maxOutputBytes));
  return {
    path,
    content,
    bytes: Buffer.byteLength(content),
  };
}

function parseSandboxSse(text: string, maxBytes: number): Omit<CloudflareSandboxExecResult, 'durationMs'> {
  const output = new OutputCapture(maxBytes);
  let event = 'message';
  let data: string[] = [];
  let exitCode: number | null = null;

  const dispatch = () => {
    if (data.length === 0 && event === 'message') {
      return;
    }
    const value = data.join('\n');
    if (event === 'stdout') {
      output.append('stdout', Buffer.from(value, 'base64'));
    } else if (event === 'stderr') {
      output.append('stderr', Buffer.from(value, 'base64'));
    } else if (event === 'exit') {
      const parsed = JSON.parse(value) as { exit_code?: unknown; exitCode?: unknown };
      const code = typeof parsed.exit_code === 'number' ? parsed.exit_code : parsed.exitCode;
      exitCode = typeof code === 'number' ? code : null;
    } else if (event === 'error') {
      const parsed = JSON.parse(value) as { error?: unknown; code?: unknown };
      throw new UpstreamError(`Cloudflare sandbox exec error: ${String(parsed.error ?? parsed.code ?? value)}`);
    }
  };

  for (const line of text.split(/\r?\n/)) {
    if (line.length === 0) {
      dispatch();
      event = 'message';
      data = [];
      continue;
    }
    if (line.startsWith(':')) {
      continue;
    }
    if (line.startsWith('event:')) {
      event = line.slice('event:'.length).trim();
      continue;
    }
    if (line.startsWith('data:')) {
      data.push(line.slice('data:'.length).trimStart());
    }
  }
  dispatch();

  return {
    exitCode,
    stdout: output.stdout,
    stderr: output.stderr,
    stdoutTruncated: output.stdoutTruncated || undefined,
    stderrTruncated: output.stderrTruncated || undefined,
  };
}

function requestHeaders(env: unknown, config: CloudflareSandboxEndpointConfig, json = true): Headers {
  const headers = new Headers();
  headers.set('Authorization', `Bearer ${envString(env, config.apiKeyEnv, 'cloudflareSandbox.apiKeyEnv')}`);
  if (json) {
    headers.set('Content-Type', 'application/json');
  }
  if (config.sessionId) {
    headers.set('Session-Id', config.sessionId);
  }
  return headers;
}

function sandboxUrl(env: unknown, config: CloudflareSandboxEndpointConfig, path: string): string {
  const baseUrl = envString(env, config.baseUrlEnv, 'cloudflareSandbox.baseUrlEnv').replace(/\/+$/, '');
  return `${baseUrl}${path}`;
}

function filePath(path: string): string {
  return path
    .replace(/^\/+/, '')
    .split('/')
    .filter((part) => part.length > 0)
    .map(encodeURIComponent)
    .join('/');
}

async function boundedText(response: Response, maxBytes: number): Promise<string> {
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
      throw new UpstreamError('Cloudflare sandbox file response exceeded maxOutputBytes.');
    }
    result += decoder.decode(value, { stream: true });
  }
}

function unsupportedTool(tool: DeviceTool): never {
  throw new BadRequestError(`cloudflare-sandbox driver does not support '${tool}' yet.`);
}

async function runWithTimeout<T>(timeoutMs: number, fn: () => Promise<T>): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      fn(),
      new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => reject(new EndpointUnavailableError(`Cloudflare sandbox operation timed out after ${timeoutMs}ms.`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

function envString(env: unknown, key: string, label: string): string {
  const value = (env as Record<string, unknown>)[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new BadRequestError(`${label} references missing environment variable '${key}'.`);
  }
  return value;
}

class OutputCapture {
  stdout = '';
  stderr = '';
  stdoutTruncated = false;
  stderrTruncated = false;
  private bytes = 0;

  constructor(private readonly maxBytes: number) {}

  append(target: 'stdout' | 'stderr', data: Buffer): void {
    const remaining = Math.max(this.maxBytes - this.bytes, 0);
    if (remaining === 0) {
      this.markTruncated(target);
      return;
    }
    const accepted = data.length > remaining ? data.subarray(0, remaining) : data;
    this.bytes += accepted.length;
    this[target] += accepted.toString('utf8');
    if (accepted.length < data.length) {
      this.markTruncated(target);
    }
  }

  private markTruncated(target: 'stdout' | 'stderr'): void {
    if (target === 'stdout') {
      this.stdoutTruncated = true;
    } else {
      this.stderrTruncated = true;
    }
  }
}

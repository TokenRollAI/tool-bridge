// Shared SDK request core: attach the credential, parse the platform error
// envelope into a typed error, and expose the M0 retryable classification.
// Every SDK call is a plain HTTP request — reproducible with curl (§8.1: no
// SDK lock-in; conformance runs the same assertions against raw requests).

import { isRetryable } from '../worker/tb/errors';
import { Transport } from './transport';

// A platform error as an SDK consumer sees it: the wire envelope's code and
// message plus the HTTP status and the code-derived retryable flag.
export class TBApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details?: unknown;
  readonly retryable: boolean;

  constructor(code: string, status: number, message: string, details?: unknown) {
    super(message);
    this.code = code;
    this.status = status;
    this.details = details;
    this.retryable = isRetryable(code);
  }
}

export interface RequestOptions {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
  accept?: string;
}

// Perform one authenticated JSON request. Non-2xx responses are parsed as the
// {error:{code,message,details?}} envelope and thrown as TBApiError; bodies
// that are not an envelope become an `internal_error`-coded TBApiError so the
// caller always gets one error type.
export async function requestJson<T>(
  transport: Transport,
  credential: string | undefined,
  path: string,
  options: RequestOptions = {}
): Promise<T> {
  const response = await rawRequest(transport, credential, path, options);
  if (!response.ok) {
    throw await errorFrom(response);
  }
  return (await response.json()) as T;
}

export async function rawRequest(
  transport: Transport,
  credential: string | undefined,
  path: string,
  options: RequestOptions = {}
): Promise<Response> {
  const headers = new Headers(options.headers);
  if (credential && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${credential}`);
  }
  if (options.accept && !headers.has('Accept')) {
    headers.set('Accept', options.accept);
  }
  const hasBody = options.body !== undefined;
  if (hasBody && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  return transport.fetch(path, {
    method: options.method ?? (hasBody ? 'POST' : 'GET'),
    headers,
    body: hasBody ? JSON.stringify(options.body) : undefined,
  });
}

export async function errorFrom(response: Response): Promise<TBApiError> {
  let code = 'internal_error';
  let message = `HTTP ${response.status}`;
  let details: unknown;
  try {
    const body = (await response.json()) as { error?: { code?: unknown; message?: unknown; details?: unknown } };
    if (body?.error && typeof body.error.code === 'string') {
      code = body.error.code;
      message = typeof body.error.message === 'string' ? body.error.message : message;
      details = body.error.details;
    }
  } catch {
    // Non-envelope body: keep the status-derived defaults.
  }
  return new TBApiError(code, response.status, message, details);
}

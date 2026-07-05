// Platform error contract (SPEC-001 §6.8/§10, TASK-M0).
//
// Every error the platform emits uses one typed envelope:
//
//   { "error": { "code": string, "message": string, "details"?: unknown } }
//
// Wire compatibility: the pre-existing lowercase codes (not_found,
// unauthorized, bad_request, ...) keep their exact strings. The codes the spec
// introduces keep the spec's spelling: `UpstreamError → 502` (any upstream
// transport/provider failure), and — reserved for Tunnel/Device work without
// implementing it — `EndpointUnavailable → 503` and `Forbidden → 403`.
//
// Retryable semantics are code-based (RETRYABLE_CODES) so SDKs can classify
// errors without any change to the wire envelope: a code either names a
// transient transport-level condition (retry with backoff) or it does not.

export interface ErrorEnvelope {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

// Codes an SDK may retry with backoff. Everything else is not retryable:
// 4xx are caller errors and internal_error may sit after a side effect.
export const RETRYABLE_CODES: ReadonlySet<string> = new Set(['UpstreamError', 'EndpointUnavailable']);

export function isRetryable(code: string): boolean {
  return RETRYABLE_CODES.has(code);
}

// Base class for typed platform errors: carries the wire code + HTTP status so
// hosts and routes map an exception to the envelope without inspecting adapter
// internals.
export class TBError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details?: unknown;

  constructor(code: string, status: number, message: string, details?: unknown) {
    super(message);
    this.code = code;
    this.status = status;
    this.details = details;
  }

  get retryable(): boolean {
    return isRetryable(this.code);
  }
}

// Thrown when a path/tool does not resolve to a node; mapped to 404. Hidden and
// unauthorized resources intentionally share this shape (deny == not found).
export class NotFoundError extends TBError {
  constructor(message: string, details?: unknown) {
    super('not_found', 404, message, details);
  }
}

// Any upstream transport or provider failure (MCP server, HTTP API, remote TB
// instance): unreachable, non-2xx, malformed or oversized response.
export class UpstreamError extends TBError {
  constructor(message: string, details?: unknown) {
    super('UpstreamError', 502, message, details);
  }
}

// Reserved for Tunnel/Device (M2): a known endpoint that is offline. No route
// throws this yet; the code/status pair is fixed here so M2 only consumes it.
export class EndpointUnavailableError extends TBError {
  constructor(message: string, details?: unknown) {
    super('EndpointUnavailable', 503, message, details);
  }
}

// Authenticated principal is not allowed to perform this action (e.g. a
// provider key writing outside its own provider namespace).
export class ForbiddenError extends TBError {
  constructor(message: string, details?: unknown) {
    super('Forbidden', 403, message, details);
  }
}

export class BadRequestError extends TBError {
  constructor(message: string, details?: unknown) {
    super('bad_request', 400, message, details);
  }
}

export function errorEnvelope(code: string, message: string, details?: unknown): ErrorEnvelope {
  return { error: { code, message, details } };
}

export function errorResponse(status: number, code: string, message: string, details?: unknown): Response {
  return new Response(JSON.stringify(errorEnvelope(code, message, details), null, 2), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

// Map any thrown value to its envelope response: typed platform errors carry
// their own status/code; everything else is an opaque 500 internal_error.
export function errorResponseOf(error: unknown): Response {
  if (error instanceof TBError) {
    return errorResponse(error.status, error.code, error.message, error.details);
  }
  const message = error instanceof Error ? error.message : String(error);
  return errorResponse(500, 'internal_error', message);
}

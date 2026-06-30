// Header value materialization and https enforcement.
// Resolves `${VAR}` and `$env:VAR` references against the worker env, and
// guards that upstream/remote endpoints use https (unless explicitly allowed).

import { AppEnv } from './types';

export function materializeHeaders(
  env: AppEnv,
  headers: Record<string, string> | undefined
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers ?? {})) {
    result[key] = materializeHeaderValue(env, value);
  }
  return result;
}

function materializeHeaderValue(env: AppEnv, value: string): string {
  if (value.startsWith('$env:')) {
    return stringEnv(env, value.slice('$env:'.length));
  }
  return value.replace(/\$\{([A-Z0-9_]+)\}/g, (_match, name: string) => stringEnv(env, name));
}

function stringEnv(env: AppEnv, key: string): string {
  const value = (env as unknown as Record<string, unknown>)[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Environment variable '${key}' is required for header substitution.`);
  }
  return value;
}

// Enforce https (allow http only under ALLOW_INSECURE_MCP_HTTP=true). Returns
// the canonicalized URL string.
export function requireSecureUrl(env: AppEnv, rawUrl: string, label: string): string {
  const url = new URL(rawUrl);
  if (url.protocol !== 'https:' && env.ALLOW_INSECURE_MCP_HTTP !== 'true') {
    throw new Error(`${label} must use https://.`);
  }
  return url.toString();
}

// Optional SSRF allowlist: when HTBP_REMOTE_ALLOWLIST is set (comma-separated
// host suffixes), refuse remote hosts that are not on it.
export function assertRemoteHostAllowed(env: AppEnv, rawUrl: string): void {
  const allowlist = (env.HTBP_REMOTE_ALLOWLIST || '')
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.length > 0);
  if (allowlist.length === 0) {
    return;
  }
  const host = new URL(rawUrl).hostname.toLowerCase();
  const allowed = allowlist.some((suffix) => host === suffix || host.endsWith(`.${suffix}`));
  if (!allowed) {
    throw new Error(`Remote host '${host}' is not in HTBP_REMOTE_ALLOWLIST.`);
  }
}

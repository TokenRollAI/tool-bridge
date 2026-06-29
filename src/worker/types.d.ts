interface Env {
  ASSETS: Fetcher;
  MCP_SERVERS_JSON?: string;
  OAUTH_REQUIRED_AUDIENCE?: string;
  // Optional comma-separated host-suffix allowlist for remote TB federation (SSRF guard).
  HTBP_REMOTE_ALLOWLIST?: string;
  // Optional KV namespace for multi-tenancy + runtime-added (dynamic) servers.
  TENANTS?: KVNamespace;
  // Set to "true" to enable tenant mode (require Secret Key auth + per-tenant
  // trees). KV presence alone no longer forces this, so KV-backed dynamic
  // servers work without locking the whole instance behind Secret Keys.
  TENANT_MODE?: string;
}

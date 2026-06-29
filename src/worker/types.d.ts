interface Env {
  ASSETS: Fetcher;
  MCP_SERVERS_JSON?: string;
  OAUTH_REQUIRED_AUDIENCE?: string;
  // Optional comma-separated host-suffix allowlist for remote TB federation (SSRF guard).
  HTBP_REMOTE_ALLOWLIST?: string;
  // Optional KV namespace for multi-tenancy. Its presence enables tenant mode:
  // the bearer token is treated as a Secret Key resolved to a tenant + tree.
  TENANTS?: KVNamespace;
}

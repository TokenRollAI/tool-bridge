interface Env {
  ASSETS: Fetcher;
  MCP_SERVERS_JSON?: string;
  OAUTH_REQUIRED_AUDIENCE?: string;
  // Optional comma-separated host-suffix allowlist for remote TB federation (SSRF guard).
  HTBP_REMOTE_ALLOWLIST?: string;
}

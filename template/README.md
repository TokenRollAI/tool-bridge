# tool-bridge one-click deploy template

Deploy your own [tool-bridge](https://github.com/TokenRollAI/tool-bridge) gateway — a self-describing, reverse-registrable tool & context gateway (HTBP reference implementation) — to Cloudflare Workers in one click.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/TokenRollAI/tool-bridge/tree/main/template)

The button copies this template into a new repo in your GitHub account, provisions everything in **your** Cloudflare account, and deploys:

| Resource | Binding | Purpose |
|---|---|---|
| D1 database | `TB_STATE` | authoritative state: node tree config, SecretKey hashes, encrypted secrets, plugin manifests |
| D1 database (same DB) | `TB_SEARCH` | global tool-search index (`~search`) |
| R2 bucket | `TB_R2` | context objects, large `$ref` payloads |
| Durable Object | `TB_DEVICE` | one `DeviceSession` per connected device (WebSocket hibernation) |

The Worker itself is a thin shell over the published [`@tool-bridge/gateway`](https://www.npmjs.com/package/@tool-bridge/gateway) package — it imports the `@tool-bridge/gateway/full` entry, which ships the **same fully-assembled gateway as a source deploy** (built-in integration catalog included); the dashboard UI ships prebuilt in [`@tool-bridge/dashboard`](https://www.npmjs.com/package/@tool-bridge/dashboard).

## Before deploying: create the two trust-root secrets

The Deploy Button reads [`.dev.vars.example`](.dev.vars.example) and asks for both values **before the first build**. Generate them locally; do not reuse the examples or share them:

```sh
# Save this Admin SK in a password manager; the gateway stores only its hash after bootstrap.
node -e "console.log('tbk_'+require('crypto').randomBytes(32).toString('base64url'))"

# SecretStore encryption root (you normally do not need to use it directly).
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

Paste the first value into `TB_BOOTSTRAP_ADMIN_SK` and the second into `TB_SECRET_ENCRYPTION_KEY` on Cloudflare's setup form. Cloudflare stores both as encrypted Worker secrets rather than plaintext variables. A new Worker without the Admin secret fails closed, and tool-bridge never writes its plaintext to Worker logs.

## After deploying

1. Copy the generated `*.workers.dev` URL from the deployment result.
2. In Cloudflare Dashboard, open `D1 → tool-bridge-db → Settings` and enable **Read Replication**. The gateway already uses request-scoped D1 Sessions; replicas are only used after this database setting is enabled.
3. Verify with the Admin SK you saved:

```sh
curl https://<your-worker>.workers.dev/healthz
curl -H "Authorization: Bearer <your-admin-sk>" \
  https://<your-worker>.workers.dev/~help
```

Authenticated responses include `Server-Timing: tb-d1;dur=..., tb-worker;dur=...`. Requests taking at least 500ms emit a structured `tool_bridge_slow_request` warning in Workers Logs with D1 wall/SQL time and primary/replica regions, but never SQL, keys, credentials, or response data. Smart Placement is enabled for API latency; because `/ui` currently runs Worker-first, this may trade a little static-asset TTFB for fewer cross-region D1 round trips.

The dashboard lives at `https://<your-worker>.workers.dev/ui`. You can also save the target locally with `tb login --base-url https://<your-worker>.workers.dev --profile default`; enter the Admin SK at the prompt so it does not appear in shell history.

## Optional configuration

- **Presigned R2 links** — without them, large payload `$ref` URLs are proxied through the Worker (`/~ref`), which just works. To hand out direct presigned R2 URLs instead, add to `wrangler.jsonc` `vars`:

  - `TB_R2_S3_ENDPOINT`: `https://<your-account-id>.r2.cloudflarestorage.com`
  - `TB_R2_BUCKET`: `tool-bridge`

  and store an R2 API token via the gateway's secret registry under the reserved name `r2-presign` (or set `TB_R2_ACCESS_KEY_ID` / `TB_R2_SECRET_ACCESS_KEY` secrets).
- **Custom domains** — add a [`routes`](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/) entry to `wrangler.jsonc`, set `TB_CANONICAL_ORIGIN` to the one canonical `https://...` origin used for OAuth callbacks, and keep Preview URLs disabled.
- **Remote gateway federation** — set `TB_REMOTE_ALLOWLIST` (comma-separated host suffixes) to allow proxying to other tool-bridge instances.

## Local development

```sh
npm install
npm run dev        # copies the dashboard into ./public, then wrangler dev
```

## Deploy from the CLI instead

```sh
npm create cloudflare@latest my-tool-bridge -- --template=TokenRollAI/tool-bridge/template
cd my-tool-bridge
npm install
cp .dev.vars.example .dev.vars
# Fill both generated values in .dev.vars; the file is gitignored.
npm run deploy -- --secrets-file .dev.vars
```

`wrangler deploy --secrets-file` injects the secrets in the same deployment that creates the Worker, avoiding the new-Worker chicken-and-egg problem of running `wrangler secret put` before a Worker exists.

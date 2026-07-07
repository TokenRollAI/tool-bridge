# tool-bridge one-click deploy template

Deploy your own [tool-bridge](https://github.com/TokenRollAI/tool-bridge) gateway — a self-describing, reverse-registrable tool & context gateway (HTBP reference implementation) — to Cloudflare Workers in one click.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/TokenRollAI/tool-bridge/tree/main/template)

The button copies this template into a new repo in your GitHub account, provisions everything in **your** Cloudflare account, and deploys:

| Resource | Binding | Purpose |
|---|---|---|
| Workers KV | `TB_KV` | node tree config, SecretKey hashes, plugin manifests |
| R2 bucket | `TB_R2` | context objects, large `$ref` payloads |
| Durable Object | `TB_DEVICE` | one `DeviceSession` per connected device (WebSocket hibernation) |

The Worker itself is a thin shell over the published [`@tool-bridge/gateway`](https://www.npmjs.com/package/@tool-bridge/gateway) package; the dashboard UI ships prebuilt in [`@tool-bridge/dashboard`](https://www.npmjs.com/package/@tool-bridge/dashboard).

## After deploying

1. **Get your Admin SecretKey.** On the very first request the gateway bootstraps itself and logs the Admin SK **once**. Open your Worker's live logs (Cloudflare dashboard → your Worker → Logs), hit `https://<your-worker>.workers.dev/healthz`, and copy the SK from the log line.

   Prefer a key you choose yourself? Set it as a secret *before* the first request:

   ```sh
   npx wrangler secret put TB_BOOTSTRAP_ADMIN_SK
   ```

2. **(Recommended) Set an encryption key** for upstream credentials stored in the gateway:

   ```sh
   npx wrangler secret put TB_SECRET_ENCRYPTION_KEY
   ```

3. **Verify:**

   ```sh
   curl https://<your-worker>.workers.dev/healthz    # → {"healthy":true,...}
   curl -H "Authorization: Bearer <your-admin-sk>" \
     https://<your-worker>.workers.dev/~help         # → htbp 0.1 ...
   ```

   The dashboard lives at `https://<your-worker>.workers.dev/ui`.

## Optional configuration

- **Presigned R2 links** — without them, large payload `$ref` URLs are proxied through the Worker (`/~ref`), which just works. To hand out direct presigned R2 URLs instead, add to `wrangler.jsonc` `vars`:
  - `TB_R2_S3_ENDPOINT`: `https://<your-account-id>.r2.cloudflarestorage.com`
  - `TB_R2_BUCKET`: `tool-bridge`

  and store an R2 API token via the gateway's secret registry under the reserved name `r2-presign` (or set `TB_R2_ACCESS_KEY_ID` / `TB_R2_SECRET_ACCESS_KEY` secrets).
- **Custom domain** — add a [`routes`](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/) entry to `wrangler.jsonc`.
- **Remote gateway federation** — set `TB_REMOTE_ALLOWLIST` (comma-separated host suffixes) to allow proxying to other tool-bridge instances.

## Local development

```sh
npm install
npm run dev        # copies the dashboard into ./public, then wrangler dev
```

## Deploy from the CLI instead

```sh
npm create cloudflare@latest my-tool-bridge -- --template=TokenRollAI/tool-bridge/template
# or, inside this directory:
npm install && npm run deploy
```

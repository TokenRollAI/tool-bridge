<div align="center">

<img src="tool-bridge.png" alt="tool-bridge" width="160" />

# tool-bridge

**A self-describing, reverse-registrable, protocol-open tool & context gateway**

Any agent that can do an HTTP fetch can discover and use all of an organization's tools, contexts, and devices — with nothing but a Secret Key and a BaseURL.

[简体中文](README.md) | English

[![npm: cli](https://img.shields.io/npm/v/@tool-bridge/cli?label=%40tool-bridge%2Fcli)](https://www.npmjs.com/package/@tool-bridge/cli)
[![npm: sdk](https://img.shields.io/npm/v/@tool-bridge/sdk?label=%40tool-bridge%2Fsdk)](https://www.npmjs.com/package/@tool-bridge/sdk)
[![license](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

</div>

---

tool-bridge is the reference implementation of [HTBP](https://github.com/TokenRollAI/HTBP) (HTTP ToolBridge Protocol). The core idea: **if you can fetch a URL, you can learn to use the tool behind it**.

<div align="center">
<table><tr><td>

```
┌──────────────────────────────────────────────────────┐
│  Any Agent / CLI / Dashboard (just SK + BaseURL)      │  ← GET /~help progressive discovery
├──────────────────────────────────────────────────────┤
│                    tool-bridge                        │
│   HTBP Tree · Tool Layer · Context Layer              │
│   Device Gateway (reverse registration) · Auth (SK)   │
├──────────────────────────────────────────────────────┤
│  Upstream: MCP servers (Streamable HTTP) · HTTP APIs  │
│  Sources: R2 / S3 / File / custom providers (plugins) │
│  Devices: any machine that can run the CLI/SDK (WS)   │
└──────────────────────────────────────────────────────┘
```

</td></tr></table>
</div>

## The problem

Getting an agent to use "what the organization already has" (tools, docs, machines) means wiring things up one by one today:

1. **Tool access is limited by runtime** — edge functions, browsers, and restricted sandboxes can't run an MCP client;
2. **Context is fragmented** — knowledge lives in R2/S3, filesystems, and internal systems with no unified read/write/search surface;
3. **Machines are out of reach** — the shell and filesystem of an intranet server are invisible to cloud agents;
4. **Discovery drifts from docs** — every integrated tool needs a hand-written usage doc that inevitably drifts from the implementation;
5. **Permissions are all-or-nothing** — there is no ready way to express "this agent may only read `docs/` and only call `search/`".

tool-bridge collapses all five into **one self-describing tree**: every capability (tool, context, device, federated service) is a node on the tree; every path level answers `~help`; `~help` is the documentation, the contract, and the permission-trimmed visible surface; every Secret Key has an explicit scope, and nodes outside it simply don't exist for that caller.

## Capabilities

| Capability | Details |
|---|---|
| **HTBP tree & progressive discovery** | Drill down from the root `/~help`; `~tree?depth=N` for a bounded overview; `~help` defaults to a compact, LLM-oriented Help DSL (`text/plain`), and `Accept: application/json` returns the semantically equivalent JSON (with real JSON Schema — directly renderable as forms) |
| **Tool layer** | Mount MCP servers (Streamable HTTP, official SDK with session reuse) and arbitrary HTTP APIs (declarative HttpToolDef); **tool virtualization** (prefix / rename / hide / description override) — only virtual names are exposed |
| **Remote federation** | Mount another HTBP service as a subtree with `~help`/`~tree`/call passthrough; https enforced + host allowlist + `X-TB-Via` cycle detection; the caller's SK never leaves the gateway — outbound credentials are re-issued via `skRef` |
| **Context layer** | Mount R2 / S3 as namespaces behind unified `List/Get/Update/Write` verbs + `Search`; optimistic concurrency (`ifVersion`); entries >1 MiB return a presigned `$ref` URL (gateway-relayed fallback when no credential), keeping large payloads off the gateway |
| **Device reverse registration** | An intranet machine runs `tb connect` to open a WebSocket and mount its own shell and fs onto the tree; the shell denies everything by default with an explicit allowlist; disconnects return 503 retryable and reconnects self-heal; cloud side uses Durable Object WebSocket Hibernation — near-zero idle cost |
| **SK permission model** | Every Secret Key = owner + scope list (path glob × action set; deny wins, no match denies); **visibility is permission**: unauthorized nodes are absent from `~help`/`~tree` (404, not 403); revocation propagates globally within 60s (0.3s measured) |
| **Credential custody** | Upstream AK/SKs are stored encrypted in the SecretStore (AES-256-GCM, write-only); node configs hold only reference names — credentials never leave the gateway and never appear in any `~help` or response |
| **Plugin system** | Third parties implement Tool/Context providers as plain HTTP services; registration performs health checks + contract validation; plugins are peers of built-in providers |
| **SDK** | Embed a TB instance in your own Node process, register local functions as tools, and optionally reverse-`connect` to a remote gateway — your local functions appear on the remote tree |
| **Three equal entry points** | Agent (raw HTTP), CLI (`tb`, `--json` everywhere), and Dashboard behave identically against the same tree — no management side-channels |

## Usage

### As an agent: just fetch

No SDK required — that's the whole point:

```sh
# Progressive discovery from the root (~help returns a compact, LLM-oriented Help DSL)
curl -H "Authorization: Bearer $TB_SK" https://your-tb.example.com/~help

# Drill into a node to see its tools and how to call them
curl -H "Authorization: Bearer $TB_SK" https://your-tb.example.com/tools/search/~help

# Call a tool
curl -X POST -H "Authorization: Bearer $TB_SK" \
  -d '{"tool":"query","arguments":{"q":"hello"}}' \
  https://your-tb.example.com/tools/search

# Read a context entry
curl -X POST -H "Authorization: Bearer $TB_SK" \
  -d '{"tool":"Get","arguments":{"path":"notes/readme.md"}}' \
  https://your-tb.example.com/ctx/docs
```

### CLI: `tb`

```sh
npm install -g @tool-bridge/cli
```

```sh
tb login                                    # interactively save BaseURL + SK (multi-profile)
tb status --json                            # gateway health summary
tb tree --depth 3                           # tree view
tb help tools/search                        # ~help of any node

# ── Mount tools ───────────────────────────────────────
tb tool mount tools/docs --kind mcp --url https://mcp.example.com/mcp
tb tool mount tools/echo --kind http --endpoint https://postman-echo.com \
  --tools-file ./echo-tools.json
tb call tools/echo --tool get --args '{"foo":"bar"}'

# ── Mount contexts ────────────────────────────────────
tb secret set --name s3-cred                         # credential read from stdin into the write-only SecretStore
tb ctx mount ctx/docs --provider s3 --endpoint https://... --bucket docs --auth-ref s3-cred
tb ctx put ctx/docs notes/hello.md --content '# hi'
tb ctx cat ctx/docs notes/hello.md
tb ctx search ctx/docs hi

# ── Reverse-register this machine ─────────────────────
tb connect --allow 'echo' --allow 'uname' --fs ~/shared   # long-running; shell allowlist + fs exposure
tb device ls                                              # from another terminal: device online status
tb call device/<id>/shell --tool exec --args '{"command":"echo hi"}'

# ── Federate another HTBP service ─────────────────────
tb server add fed/team-b --base-url https://tb.team-b.example.com --sk-ref team-b-sk

# ── Permissions ───────────────────────────────────────
tb sk create --owner agent:reader --scope 'ctx/docs/**:read' --scope 'tools/search:call'
tb sk list && tb sk rm <id>

# ── Plugins ───────────────────────────────────────────
tb plugin register ./manifest.json && tb plugin health my-plugin
```

All 17 subcommands support `--json` and cover the full management surface (the CLI is a pure API client — there are no dedicated endpoints).

### Dashboard

After deploying, open `https://your-tb.example.com/ui` and enter your SK + BaseURL:

- tree navigation + form-based calls on any node (forms auto-rendered from the JSON Schema in `~help`) + markdown result display;
- context entry browsing (List drill-down / Search / Get preview / Write editing);
- SK issuance & revocation, registry management, device online status, credential management;
- ⌘K command palette with fuzzy jump across the whole tree.

The Dashboard has no dedicated backend — it is just a generic `~help` renderer; the SK stays in your browser.

### SDK: embed a TB instance

```sh
npm install @tool-bridge/sdk
```

```ts
import { serve } from '@hono/node-server'
import { createToolBridge, MemoryStateStore } from '@tool-bridge/sdk'

const tb = createToolBridge({ state: new MemoryStateStore() })

// Register a local function as a tool on the tree
tb.registerTool('tools/echo', {
  List: () => [{ name: 'echo', description: 'echo the text back' }],
  Get: () => ({ name: 'echo' }),
  Call: (_name, args) => ({ content: { echoed: args.text } }),
})

// Serve as a standalone HTBP service
serve({ fetch: (req) => tb.fetch(req), port: 8787 })

// Or: reverse-connect to a remote gateway — the local tool appears on the remote tree
const conn = await tb.connect('https://your-tb.example.com', process.env.TB_SK!)
await conn.ready
```

See [packages/sdk/README.md](packages/sdk/README.md) for details.

## Deployment

### Cloudflare (default path, near-zero idle cost)

Runtime shape: a single Worker (API + Dashboard together) + KV (tree config / SKs) + R2 (contexts / large objects) + one Durable Object per device (WS hibernation).

```sh
git clone https://github.com/TokenRollAI/tool-bridge && cd tool-bridge
pnpm install

# 1. Configure: fill in CLOUDFLARE_ACCOUNT_ID / TB_DOMAIN / TB_BASE_URL,
#    and generate TB_SECRET_ENCRYPTION_KEY (the template includes the command)
cp .env.example .env

# 2. Verify locally (typecheck + lint + unit tests + real-workerd integration tests)
pnpm verify

# 3. Inject production secrets (Admin SK plaintext + SecretStore master key)
cd packages/gateway
npx wrangler secret put TB_BOOTSTRAP_ADMIN_SK
npx wrangler secret put TB_SECRET_ENCRYPTION_KEY
cd ../..

# 4. Deploy: idempotently create KV/R2 → build the Dashboard → deploy the gateway
pnpm deploy:all

# 5. Smoke-test
TB_BASE_URL=https://your-tb.example.com TB_SK=... pnpm smoke
tb login && tb status --json
```

On first request the gateway bootstraps itself: it materializes the `system/*` management subtree (sk / secret / registry / status / plugin) and generates the Admin SK (full-tree, all-action scope, used to issue finer-grained SKs; plaintext printed exactly once).

Local development: `pnpm gen-dev-vars` (generates .dev.vars from .env), then `npx wrangler dev`.

### Docker (self-hosting, on the roadmap)

The same core runs on a Node host (SQLite + local FS) as a single container with a `/data` volume. The host-neutral assembly surface (the same one the SDK uses) is already in place; the image is on the roadmap. You can also spin up a Node instance today with the SDK + `@hono/node-server` (see the SDK section above).

## Repository layout (pnpm monorepo)

| Package | Responsibility |
|---|---|
| `packages/core` | Pure-logic kernel: tree / auth (SK scope checks) / HTBP encoding / context·device·plugin pure logic / SecretStore / builtin modules; zero host dependencies |
| `packages/gateway` | Cloudflare Workers gateway: Hono routing + mcp/http/remote/plugin/r2/s3 providers + Durable Object device channel + Dashboard static hosting |
| `packages/cli` | The `tb` command line (citty), a pure API client — npm package [`@tool-bridge/cli`](https://www.npmjs.com/package/@tool-bridge/cli) |
| `packages/sdk` | npm package [`@tool-bridge/sdk`](https://www.npmjs.com/package/@tool-bridge/sdk): embedded TB instance, programmatic registration, reverse connect |
| `packages/dashboard` | Web management UI: a generic `~help` renderer + admin forms, no dedicated backend |
| `llmdoc/` | Project knowledge base (architecture boundaries, protocol contract, production pitfalls, workflows) |
| `archive/` | Archived bootstrap-era spec & process docs (historical reference only) |

## Development

```sh
pnpm verify              # one-shot: typecheck + lint + all tests
pnpm test:unit           # core / cli / sdk unit tests
pnpm test:integration    # gateway integration tests (real workerd)
pnpm lint:fix            # biome auto-fix
```

Engineering rule: **the code is the source of truth for behavior**; the lookup docs for the interface contract, module boundaries, and production pitfalls live in [llmdoc/](llmdoc/index.md) (contract entry point: `llmdoc/reference/protocol-contract.md`).

## Status

Under active development (pre-release). All core capabilities have landed and are verified in production on Cloudflare: SK auth with scopes, the HTBP tree with content negotiation, the tool layer (mcp / http / remote federation + virtualization), the four context verbs plus `$ref` large objects, device reverse registration (WebSocket hibernation), the SDK and plugin system, and the Dashboard. `@tool-bridge/cli` and `@tool-bridge/sdk` are published to npm. Roadmap: a `tb init` one-shot deployment wizard, the Docker self-hosting path, and systematic end-to-end acceptance across the seven user cases.

## License

[MIT](LICENSE)

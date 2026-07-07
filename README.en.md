# tool-bridge

[简体中文](README.md) | English

> tool-bridge is a **self-describing, reverse-registrable, protocol-open tool & context gateway**. Any agent that can do an HTTP fetch can discover and use all of an organization's tools, contexts, and devices — with nothing but a Secret Key and a BaseURL.

tool-bridge is the reference implementation of [HTBP](https://github.com/TokenRollAI/HTBP) (HTTP ToolBridge Protocol). The core idea: **if you can fetch a URL, you can learn to use the tool behind it**.

```
┌──────────────────────────────────────────────────────┐
│  Any Agent / CLI / Dashboard (just SK + BaseURL)      │  ← GET /~help progressive discovery
├──────────────────────────────────────────────────────┤
│                    tool-bridge                        │
│   HTBP Tree · Tool Layer · Context Layer              │
│   Device Gateway (reverse registration) · Auth (SK)   │
├──────────────────────────────────────────────────────┤
│  Upstream: MCP servers (Streamable HTTP) · HTTP APIs  │
│  Sources: R2 / S3 / File / custom Providers           │
│  Devices: any machine that can run the CLI/SDK (WS)   │
└──────────────────────────────────────────────────────┘
```

## Why

Getting an agent to use "what the organization already has" (tools, docs, machines) means wiring things up one by one today:

1. **Tool access is limited by runtime** — edge functions, browsers, and restricted sandboxes can't run an MCP client;
2. **Context is fragmented** — knowledge lives in R2/S3, filesystems, and internal systems with no unified read/write/search surface;
3. **Machines are out of reach** — the shell and filesystem of an intranet server are invisible to cloud agents;
4. **Discovery drifts from docs** — every integrated tool needs a hand-written usage doc that inevitably drifts from the implementation;
5. **Permissions are all-or-nothing** — there is no ready way to express "this agent may only read `docs/` and only call `search/`".

## Core Ideas

- **One tree, one entry point**: tools, contexts, and devices are all nodes on a single HTBP tree; agents progressively discover everything from the root `/~help`.
- **Self-describing**: every path level on the tree answers `~help`; `~help` is the documentation, the contract, and the permission-trimmed visible surface.
- **Open upstream supply**: MCP (Streamable HTTP), any HTTP API, built-in capabilities, and other HTBP services (remote federation) can all be mounted; context sources include R2 / S3 / custom Providers.
- **Device reverse registration**: an intranet machine runs `tb connect` to establish a WebSocket and mount its own shell and fs onto the tree — cloud agents can finally reach any machine.
- **SK is the permission**: every Secret Key has an explicit scope (which paths, which actions); nodes outside the scope simply don't exist for that caller.
- **Cheap cloud hosting**: Cloudflare by default (Workers + Durable Objects + KV + R2), near-zero idle cost; the same core also self-hosts via Docker.
- **Three equal entry points**: Agent (raw HTTP), CLI (`tb`), and Dashboard behave identically against the same tree — no management side-channels.

## Quick Start

### As an agent: just fetch

```sh
# Progressive discovery from the root (~help returns a compact, LLM-oriented Help DSL, text/plain)
curl -H "Authorization: Bearer $TB_SK" https://your-tb.example.com/~help

# Drill into a node
curl -H "Authorization: Bearer $TB_SK" https://your-tb.example.com/tools/echo/~help

# Call a tool
curl -X POST -H "Authorization: Bearer $TB_SK" \
  -d '{"tool":"echo","arguments":{"text":"hi"}}' \
  https://your-tb.example.com/tools/echo
```

### CLI: `tb`

```sh
tb login                    # save BaseURL + SK
tb status --json            # gateway status
tb tree                     # tree view
tb call tools/echo --tool echo --args '{"text":"hi"}'
tb connect                  # reverse-register this machine's shell/fs onto the tree
```

Every subcommand supports `--json`, maps one-to-one onto the Proto interfaces, and covers the full management surface.

### SDK: embed a TB instance

```ts
import { serve } from '@hono/node-server'
import { createToolBridge, MemoryStateStore } from '@tool-bridge/sdk'

const tb = createToolBridge({ state: new MemoryStateStore() })

tb.registerTool('tools/echo', {
  List: () => [{ name: 'echo', description: 'echo the text back' }],
  Get: () => ({ name: 'echo' }),
  Call: (_name, args) => ({ content: { echoed: args.text } }),
})

serve({ fetch: (req) => tb.fetch(req), port: 8787 })
```

See [packages/sdk/README.md](packages/sdk/README.md) for details.

### Deploy to Cloudflare

```sh
pnpm install
cp .env.example .env        # fill in CLOUDFLARE_ACCOUNT_ID / TB_DOMAIN etc.
pnpm verify                 # typecheck + lint + unit tests + integration tests
pnpm deploy:all             # idempotent provisioning (KV/R2) + gateway deploy
TB_BASE_URL=https://your-tb.example.com TB_SK=... pnpm smoke
```

The full walkthrough and troubleshooting live in `llmdoc/guides/deploy-and-verify.md`.

## Repository Layout (pnpm monorepo)

| Package | Responsibility |
|---|---|
| `packages/core` | Pure-logic kernel: tree / auth (SK scope checks) / HTBP encoding / SecretStore / builtin modules; zero host dependencies |
| `packages/gateway` | Cloudflare Workers gateway: Hono routing + mcp/http/remote providers + Durable Object device channel |
| `packages/cli` | The `tb` command line (citty), a pure API client |
| `packages/sdk` | `@tool-bridge/sdk`: embedded TB instance, programmatic registration, reverse connect |
| `packages/dashboard` | Web management UI: a generic `~help` renderer + admin forms, no dedicated backend |
| `docs/` | Source of truth for the spec: Vision / Architecture / Proto / Plugin / Reference |
| `llmdoc/` | Compressed, LLM-oriented retrieval layer over the docs |

## Development

```sh
pnpm verify              # one-shot: typecheck + lint + all tests
pnpm test:unit           # core / cli / sdk unit tests
pnpm test:integration    # gateway integration tests (real workerd)
pnpm lint:fix            # biome auto-fix
```

Engineering rule: **when implementation and docs disagree, `docs/` wins**; the single normative interface spec is [docs/Proto.md](docs/Proto.md).

## Status

Under active development (pre-release). The core path — SK auth, the HTBP tree, the mcp/http/remote tool layer, the four context verbs plus `$ref` large objects, and device reverse registration (WebSocket hibernation) — has been verified in production on Cloudflare. The SDK / plugin system, the Dashboard, and the Docker self-hosting path are in progress.

## License

[MIT](LICENSE)

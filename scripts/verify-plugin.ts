/**
 * Plugin 全流程验收:对 TB_BASE_URL
 * 端到端验证示例 context-provider 的注册→挂载→四动词消费→调试清单 1~6→注销。
 *
 * 流程:
 *   1. 起 stub-provider 子进程(packages/gateway/scripts/stub-provider.ts;或设
 *      TB_TEST_PLUGIN_URL 用预先起好的实例,此时跳过 spawn 与 token 钉扎);
 *   2. `tb plugin register --file <manifest>` → 断言契约校验通过、pluginToken 仅注册
 *      响应出现一次(list/get 不回显);
 *   3. 用 pluginToken 重启 stub(STUB_PROVIDER_TOKEN 钉扎)→ 平台→Plugin 调用凭证
 *      端到端闭环(platform-token 语义);
 *   4. `tb plugin list/health`;
 *   5. 挂载(system/registry write,kind:'context',provider=<plugin-id>)→ 四动词经树:
 *      put→ls→cat→patch→search(`tb ctx *`);
 *   6. 调试清单逐条断言:
 *      ① ~help 列全方法(DSL 与 HelpJson 双表现);② ~describe 与 manifest 一致;
 *      ③ Write 同 Request-Id 重放幂等 + Update 不存在 → not_found;
 *      ④ 错误 TBError 形状 {code,message,retryable};
 *      ⑤ List 分页 cursor 往返(>1 页);⑥ 无/错凭证 401;
 *   7. teardown(幂等):unmount + `tb plugin rm` + 杀子进程。
 *
 * 用法:先起本地网关(须放行 http 出站与固定 Admin SK):
 *   `cd packages/gateway && wrangler dev --var TB_ALLOW_INSECURE_HTTP:true --var TB_BOOTSTRAP_ADMIN_SK:$TB_SK`
 * 再 `TB_BASE_URL=http://127.0.0.1:8787 TB_SK=tbk_... pnpm tsx scripts/verify-plugin.ts`
 * (需先 `pnpm --filter @tool-bridge/cli build` 产出 CLI dist。)
 *
 * 打生产 TB_BASE_URL 时 stub 须公网可达:预先部署并设 TB_TEST_PLUGIN_URL(https)。
 * 退出码:0=全过;1=任一断言失败或超时。
 */
import assert from 'node:assert/strict'
import { type ChildProcess, spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const baseUrl = (process.argv[2] ?? process.env.TB_BASE_URL)?.replace(/\/+$/, '')
const adminSk = process.env.TB_ADMIN_SK ?? process.env.TB_SK

if (!baseUrl) {
  console.error('error: missing base URL. Set TB_BASE_URL or pass as argv[2].')
  process.exit(1)
}
if (!adminSk) {
  console.error('error: missing admin SK. Set TB_SK (admin-scoped SK).')
  process.exit(1)
}

const CLI = fileURLToPath(new URL('../packages/cli/dist/index.js', import.meta.url))
if (!existsSync(CLI)) {
  console.error(
    `error: CLI dist not found at ${CLI}. Run \`pnpm --filter @tool-bridge/cli build\`.`,
  )
  process.exit(1)
}

const TSX = fileURLToPath(new URL('../node_modules/.bin/tsx', import.meta.url))
const STUB_SCRIPT = fileURLToPath(
  new URL('../packages/gateway/scripts/stub-provider.ts', import.meta.url),
)
const STUB_PORT = Number(process.env.STUB_PROVIDER_PORT ?? 39004)
/** 预先起好的 stub(生产验收时的公网部署);未设则本地 spawn + token 钉扎。 */
const externalStubUrl = process.env.TB_TEST_PLUGIN_URL?.replace(/\/+$/, '')
const stubUrl = externalStubUrl ?? `http://127.0.0.1:${STUB_PORT}`

const CLI_TIMEOUT_MS = 60_000
const STUB_READY_TIMEOUT_MS = 15_000

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

interface CliResult {
  code: number | null
  stdout: string
  stderr: string
}

/** 跑一条一次性 tb 命令(凭证经环境变量传入,不落 argv;verify-device 同款)。 */
function runCli(args: string[], sk: string = adminSk as string): Promise<CliResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CLI, ...args], {
      env: { ...process.env, TB_BASE_URL: baseUrl, TB_SK: sk },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (c) => {
      stdout += String(c)
    })
    child.stderr.on('data', (c) => {
      stderr += String(c)
    })
    const timer = setTimeout(() => child.kill('SIGKILL'), CLI_TIMEOUT_MS)
    child.on('error', reject)
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ code, stdout, stderr })
    })
  })
}

/** 跑 tb 命令并要求成功 + 解析 --json 输出。 */
async function cliJson<T>(args: string[]): Promise<T> {
  const res = await runCli([...args, '--json'])
  assert.equal(
    res.code,
    0,
    `tb ${args.join(' ')} 预期退出码 0,实际 ${res.code}\nstdout: ${res.stdout}\nstderr: ${res.stderr}`,
  )
  return JSON.parse(res.stdout) as T
}

// ---------- stub-provider 子进程管理 ----------

let stubChild: ChildProcess | undefined

async function waitStubHealthy(): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < STUB_READY_TIMEOUT_MS) {
    try {
      const res = await fetch(`${stubUrl}/healthz`)
      if (res.ok) return
    } catch {
      // 未就绪:继续轮询
    }
    await sleep(300)
  }
  throw new Error(`stub-provider 在 ${STUB_READY_TIMEOUT_MS / 1000}s 内未就绪(${stubUrl}/healthz)`)
}

async function stopStub(): Promise<void> {
  const child = stubChild
  stubChild = undefined
  if (child === undefined || child.exitCode !== null || child.killed) return
  const closed = new Promise<void>((resolve) => child.once('close', () => resolve()))
  child.kill('SIGTERM')
  const done = await Promise.race([closed.then(() => true), sleep(3_000).then(() => false)])
  if (!done) {
    child.kill('SIGKILL')
    await closed
  }
}

/** 起(或带钉扎 token 重启)本地 stub;外部 stub(TB_TEST_PLUGIN_URL)时跳过。 */
async function startStub(pinnedToken?: string): Promise<void> {
  if (externalStubUrl !== undefined) return
  await stopStub()
  stubChild = spawn(TSX, [STUB_SCRIPT], {
    env: {
      ...process.env,
      STUB_PROVIDER_PORT: String(STUB_PORT),
      ...(pinnedToken !== undefined ? { STUB_PROVIDER_TOKEN: pinnedToken } : {}),
    },
    stdio: ['ignore', 'inherit', 'inherit'],
  })
  await waitStubHealthy()
}

// ---------- 直连 stub 的 envelope 调用(调试清单 ③/④/⑥ 用) ----------

interface EnvelopeResult {
  status: number
  body: unknown
}

async function envelope(
  tool: string,
  args: Record<string, unknown>,
  opts: { token?: string; requestId?: string } = {},
): Promise<EnvelopeResult> {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    accept: 'application/json',
  }
  if (opts.token !== undefined) headers.authorization = `Bearer ${opts.token}`
  if (opts.requestId !== undefined) headers['x-tb-request-id'] = opts.requestId
  const res = await fetch(stubUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify({ tool, arguments: args }),
  })
  return { status: res.status, body: await res.json().catch(() => null) }
}

/** TBError 形状断言:{code,message,retryable} 三字段类型齐。 */
function assertTBErrorShape(body: unknown, what: string): { code: string } {
  assert.ok(body !== null && typeof body === 'object', `${what}:错误响应须为 JSON 对象`)
  const e = body as { code?: unknown; message?: unknown; retryable?: unknown }
  assert.equal(typeof e.code, 'string', `${what}:错误须有 string code,实际 ${JSON.stringify(body)}`)
  assert.equal(typeof e.message, 'string', `${what}:错误须有 string message`)
  assert.equal(typeof e.retryable, 'boolean', `${what}:错误须有 boolean retryable`)
  return e as { code: string }
}

// ---------- 主流程 ----------

interface PluginRegistration {
  id: string
  kind: string
  enabled: boolean
  pluginToken?: string
}

async function main(): Promise<void> {
  const rand = randomBytes(4).toString('hex')
  const pluginId = `stub-${rand}`
  const mountPath = `docs/stub-${rand}`
  const requiredMethods = ['List', 'Get', 'Update', 'Write']
  const allMethods = [...requiredMethods, 'Search', 'Delete']

  // 逐条收集失败:一条失败不阻断其余断言,最后统一汇总(verify-device 同款)。
  const failures: string[] = []
  const step = async (name: string, fn: () => Promise<void>): Promise<boolean> => {
    try {
      await fn()
      console.log(`PASS ${name}`)
      return true
    } catch (err) {
      console.error(`FAIL ${name}: ${err instanceof Error ? err.message : String(err)}`)
      failures.push(name)
      return false
    }
  }

  const tmpDir = await mkdtemp(join(tmpdir(), 'tb-verify-plugin-'))
  let registered = false
  let mounted = false

  try {
    // 0) 起 stub(未钉扎:平台注册探活/契约抓取无凭证,envelope 接受任意非空 Bearer)。
    await startStub()
    console.log(`ok  stub-provider up at ${stubUrl}`)

    // 1) 注册:tb plugin register --file <manifest>。失败则后续无意义,直接抛。
    const manifestFile = join(tmpDir, 'manifest.json')
    await writeFile(
      manifestFile,
      JSON.stringify({
        id: pluginId,
        kind: 'context-provider',
        interfaceVersion: 'context-provider/v1',
        endpoint: stubUrl,
        auth: { kind: 'platform-token' },
        healthPath: '/healthz',
        enabled: true,
      }),
    )
    const reg = await cliJson<PluginRegistration>(['plugin', 'register', '--file', manifestFile])
    registered = true
    assert.equal(reg.id, pluginId)
    assert.match(
      reg.pluginToken ?? '',
      /^tbk_/,
      'platform-token 注册响应须携带 pluginToken(仅此一次)',
    )
    const pluginToken = reg.pluginToken as string
    console.log(`ok  registered plugin ${pluginId}(探活 + 契约校验通过,pluginToken 已签发)`)

    // 2) pluginToken 只出现一次:list/get 均不回显。
    await step('pluginToken 仅注册响应出现一次(list/get 不回显)', async () => {
      const page = await cliJson<{ items: Array<Record<string, unknown>> }>(['plugin', 'list'])
      const item = page.items.find((p) => p.id === pluginId)
      assert.ok(item !== undefined, `plugin list 未见 ${pluginId}`)
      assert.ok(!('pluginToken' in item), 'list 不得回显 pluginToken')
      assert.ok(!('tokenSkId' in item), 'list 不得回显 tokenSkId')
      const got = await cliJson<Record<string, unknown>>(['plugin', 'get', pluginId])
      assert.ok(!('pluginToken' in got), 'get 不得回显 pluginToken')
    })

    // 3) 用 pluginToken 钉扎重启 stub:此后 envelope 凭证须逐字等于平台 mint 的 token
    //    (外部 stub 无法钉扎,跳过;stub 数据在内存,重启回种子态,尚未写入无损失)。
    await startStub(pluginToken)
    if (externalStubUrl === undefined) {
      console.log('ok  stub 已用 pluginToken 钉扎重启(platform-token 凭证闭环)')
    }

    // 4) tb plugin health:钉扎后按需探活仍 healthy。
    await step('tb plugin health → healthy', async () => {
      const h = await cliJson<{ healthy: boolean; checkedAt: string }>([
        'plugin',
        'health',
        pluginId,
      ])
      assert.equal(h.healthy, true, `health 预期 healthy,实际 ${JSON.stringify(h)}`)
    })

    // 5) 挂载:NodeRegistry.Write{kind:'context', provider:<plugin-id>}。
    //    tb ctx mount 只收 r2|s3(内置 provider),plugin 挂载走管理面 system/registry。
    await step('挂载 plugin-backed context 节点', async () => {
      await cliJson([
        'call',
        'system/registry',
        '--tool',
        'write',
        '--args',
        JSON.stringify({
          path: mountPath,
          kind: 'context',
          description: 'verify-plugin stub mount',
          config: { kind: 'context', provider: pluginId },
        }),
      ])
      mounted = true
    })
    if (!mounted) throw new Error('挂载失败,后续树上断言无意义')

    // 6) 四动词经树:put → ls → cat → patch → search(tb ctx *)。
    const entryPath = `verify/hello-${rand}.md`
    const content = `# hello\n\nverify-plugin ${rand}`
    await step('四动词经树:put→ls→cat→patch→search', async () => {
      const written = await cliJson<{ uri: string; version: string }>([
        'ctx',
        'put',
        mountPath,
        entryPath,
        '--content',
        content,
        '--content-type',
        'text/markdown',
      ])
      assert.ok(written.uri.endsWith(entryPath), `put 返回 uri 预期含 ${entryPath}`)

      const listed = await cliJson<{ items: Array<{ uri: string }> }>([
        'ctx',
        'ls',
        mountPath,
        'verify/',
      ])
      assert.ok(
        listed.items.some((m) => m.uri.endsWith(entryPath)),
        `ls 预期含 ${entryPath},实际 ${JSON.stringify(listed.items.map((m) => m.uri))}`,
      )

      const got = await cliJson<{ content: string; version: string }>([
        'ctx',
        'cat',
        mountPath,
        entryPath,
      ])
      assert.equal(got.content, content, 'cat 内容与 put 不符')

      const patched = await cliJson<{ version: string }>([
        'ctx',
        'patch',
        mountPath,
        entryPath,
        '--content',
        `${content}\n\npatched`,
      ])
      assert.notEqual(patched.version, got.version, 'patch 后 version 应递增')

      const found = await cliJson<{ items: Array<{ uri: string }> }>([
        'ctx',
        'search',
        mountPath,
        `verify-plugin ${rand}`,
      ])
      assert.ok(
        found.items.some((m) => m.uri.endsWith(entryPath)),
        `search 预期命中 ${entryPath}(capability 'search' 已声明)`,
      )
    })

    // ---------- 调试清单 1~6 ----------

    await step('清单① ~help 列全方法(DSL 与 HelpJson 双表现)', async () => {
      const dsl = await (await fetch(`${stubUrl}/~help`)).text()
      for (const m of allMethods) {
        assert.match(dsl, new RegExp(`^cmd ${m} `, 'm'), `~help DSL 缺 cmd ${m}`)
      }
      const jsonRes = await fetch(`${stubUrl}/~help`, {
        headers: { accept: 'application/json' },
      })
      assert.match(jsonRes.headers.get('content-type') ?? '', /application\/json/)
      const helpJson = (await jsonRes.json()) as { cmds: Array<{ name: string; scope: string }> }
      assert.deepEqual(
        helpJson.cmds.map((c) => c.name).sort(),
        [...allMethods].sort(),
        'HelpJson cmds 与 DSL 应同集合',
      )
      assert.ok(
        helpJson.cmds.every((c) => c.scope === 'read' || c.scope === 'write'),
        '每个 cmd 应声明 scope',
      )
    })

    await step('清单② ~describe 与 manifest/实现一致', async () => {
      const describe = (await (await fetch(`${stubUrl}/~describe`)).json()) as {
        kind: string
        interfaceVersion: string
        capabilities: string[]
      }
      assert.equal(describe.kind, 'context-provider')
      assert.equal(describe.interfaceVersion, 'context-provider/v1')
      assert.deepEqual([...describe.capabilities].sort(), ['delete', 'search'])
      // 网关侧一致性:挂载节点 ~describe 回注册时缓存的 capabilities。
      const nodeDescribe = await fetch(`${baseUrl}/${mountPath}/~describe`, {
        headers: { authorization: `Bearer ${adminSk}`, accept: 'application/json' },
      })
      assert.equal(nodeDescribe.status, 200)
      const nd = (await nodeDescribe.json()) as { kind: string; capabilities: string[] }
      assert.deepEqual([...nd.capabilities].sort(), ['delete', 'search'])
    })

    await step('清单③ Write 同 Request-Id 重放幂等 + Update 不存在 → not_found', async () => {
      // 直连 stub:同 X-TB-Request-Id 重放,首次结果原样重放(version 不再递增)。
      const requestId = `verify-${rand}-replay`
      const writeArgs = {
        path: `verify/replay-${rand}.md`,
        entry: { contentType: 'text/markdown', content: 'replay me' },
      }
      const first = await envelope('Write', writeArgs, { token: pluginToken, requestId })
      assert.equal(first.status, 200, `Write 首发预期 200,实际 ${first.status}`)
      const second = await envelope('Write', writeArgs, { token: pluginToken, requestId })
      assert.equal(second.status, 200)
      assert.deepEqual(second.body, first.body, '同 Request-Id 重放应返回首次结果(幂等)')
      // 经树:Update 不存在的 path → not_found(HTTP 404 原样透传)。
      const missing = await runCli([
        'ctx',
        'patch',
        mountPath,
        `verify/nope-${rand}.md`,
        '--content',
        'x',
        '--json',
      ])
      assert.notEqual(missing.code, 0, 'Update 不存在的 path 应失败')
      assert.match(missing.stderr + missing.stdout, /not_found/, 'Update 缺失应报 not_found')
    })

    await step('清单④ 错误 TBError 形状 {code,message,retryable}', async () => {
      const res = await envelope('Get', { path: `verify/ghost-${rand}.md` }, { token: pluginToken })
      assert.equal(res.status, 404, `Get 缺失预期 404,实际 ${res.status}`)
      const err = assertTBErrorShape(res.body, 'Get 缺失')
      assert.equal(err.code, 'not_found')
      const bad = await envelope('Frobnicate', {}, { token: pluginToken })
      assert.equal(bad.status, 400, `未知方法预期 400,实际 ${bad.status}`)
      assert.equal(assertTBErrorShape(bad.body, '未知方法').code, 'invalid_argument')
    })

    await step('清单⑤ List 分页 cursor 往返(>1 页)', async () => {
      // 种子 5 条 + 树上写入的 2 条(put + replay)= 7 条;limit 2 → 4 页。
      const uris: string[] = []
      let cursor: string | undefined
      let pages = 0
      do {
        const page = await cliJson<{ items: Array<{ uri: string }>; cursor?: string }>([
          'ctx',
          'ls',
          mountPath,
          '--limit',
          '2',
          ...(cursor !== undefined ? ['--cursor', cursor] : []),
        ])
        uris.push(...page.items.map((m) => m.uri))
        cursor = page.cursor
        pages += 1
        assert.ok(pages <= 20, 'cursor 未收敛(>20 页)')
      } while (cursor !== undefined)
      assert.ok(pages > 1, `预期 >1 页,实际 ${pages} 页`)
      assert.equal(new Set(uris).size, uris.length, 'cursor 往返不应重复条目')
      // 本轮写入的 2 条(put + replay)必须都被翻到;总量种子 5 + 2(外部 stub 复跑会累积,不设上限)。
      assert.ok(uris.length >= 7, `预期 ≥7 条,实际 ${uris.length}:${JSON.stringify(uris)}`)
      assert.ok(
        uris.some((u) => u.endsWith(entryPath)) &&
          uris.some((u) => u.endsWith(`verify/replay-${rand}.md`)),
        '分页聚合应包含本轮写入的两条 entry',
      )
    })

    await step('清单⑥ 无/错凭证被拒(401 TBError)', async () => {
      const missing = await envelope('List', { path: '' }, {})
      assert.equal(missing.status, 401, `无凭证预期 401,实际 ${missing.status}`)
      assertTBErrorShape(missing.body, '无凭证')
      if (externalStubUrl === undefined) {
        // 钉扎模式:非空但错误的 token 同样 401。
        const wrong = await envelope('List', { path: '' }, { token: 'tbk_wrong-token' })
        assert.equal(wrong.status, 401, `错凭证预期 401,实际 ${wrong.status}`)
        assertTBErrorShape(wrong.body, '错凭证')
      } else {
        console.log('..  外部 stub 未钉扎 token,错凭证用例跳过(仅验无凭证)')
      }
    })

    if (failures.length > 0) throw new Error(`断言未全过:${failures.join(' / ')}`)
    console.log(`\nverify-plugin passed against ${baseUrl} (plugin ${pluginId})`)
  } finally {
    // teardown(幂等,失败不掩盖主错误):unmount → plugin rm → 杀 stub → 清临时目录。
    if (mounted) {
      await runCli(['ctx', 'unmount', mountPath, '--json']).catch(() => null)
    }
    if (registered) {
      await runCli(['plugin', 'rm', pluginId, '--json']).catch(() => null)
    }
    await stopStub().catch(() => null)
    await rm(tmpDir, { recursive: true, force: true })
  }
}

main().catch((err) => {
  console.error(`verify-plugin FAILED: ${err instanceof Error ? err.message : String(err)}`)
  void stopStub().finally(() => process.exit(1))
})

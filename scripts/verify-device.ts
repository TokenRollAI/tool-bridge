import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createInterface } from 'node:readline'
import { spawn } from 'node:child_process'
import { basename, join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { fileURLToPath } from 'node:url'
/**
 * 设备网关验收:对已部署的 TB_BASE_URL 端到端验证
 * 反向注册全链路——tb connect 长驻接入、shell/fs 数据面、registerPaths 越界拒绝。
 *
 * 流程:
 *   1. spawn `tb connect --device-id verify-dev-<rand> --allow echo --fs <tmp>`,等 ready 事件;
 *   2. 断言①:`tb call device/<id>/shell --tool exec` → stdout 含 hi-p4;
 *   3. 断言②:`tb ctx cat device/<id>/fs <root>/hello.txt` → 读到临时文件真实内容;
 *   4. 断言③:admin SK 签发 registerPaths=[device/allowed-<rand>] 的受限 SK →
 *      越界 `--device-id outside-<rand>` 被拒(网关发 error 帧关连接:进程退出不重连、
 *      从未 ready、registry 无该节点)→ 前缀内 `--device-id allowed-<rand>` 连接 ready;
 *   5. teardown(幂等可重跑):杀 connect 子进程、registry delete 注册节点(各设备用
 *      注册它的 SK 删;回收 alarm 默认 24h 不等它)、吊销受限 SK、删临时目录。
 *
 * 用法:`TB_BASE_URL=https://... TB_SK=tbk_... pnpm tsx scripts/verify-device.ts`
 *   (需先 `pnpm --filter @tool-bridge/cli build` 产出 CLI dist。)
 * 可选:`TB_VERIFY_HIBERNATION=1` 追加跨休眠窗口用例(空闲 155s 后再调用,验证 DO
 *   hibernation 唤醒恢复,见 llmdoc/guides/do-websocket-hibernation.md;总时长 +~3min)。
 *
 * **消耗生产资源**:真实设备注册 + SK 签发/吊销,故只在显式运行时跑,不进 `pnpm verify`。
 * 退出码:0=全过;1=任一断言失败或超时。
 */
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'

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

const READY_TIMEOUT_MS = 30_000
const REJECT_TIMEOUT_MS = 30_000
const CLI_TIMEOUT_MS = 90_000 // 设备调用超时 60s(DEVICE_CALL_TIMEOUT_MS)+ 余量
const SK_PROPAGATION_TIMEOUT_MS = 60_000 // KV 官方传播窗口上限(同 verify-revocation)
const HIBERNATION_IDLE_MS = 155_000 // 边缘空闲掐断 ~100s + DO 休眠,>150s 才算跨窗口

const sleep = (ms: number): Promise<void> => new Promise(r => setTimeout(r, ms))

async function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timeout after ${ms / 1000}s: ${what}`)), ms)
  })
  try {
    return await Promise.race([p, timeout])
  } finally {
    clearTimeout(timer)
  }
}

interface CliResult {
  code: number | null
  stderr: string
  stdout: string
}

/** 跑一条一次性 tb 命令(凭证经环境变量传入,不落 argv)。 */
function runCli(args: string[], sk: string): Promise<CliResult> {
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
async function cliJson<T>(args: string[], sk: string): Promise<T> {
  const res = await runCli([...args, '--json'], sk)
  assert.equal(
    res.code,
    0,
    `tb ${args.join(' ')} 预期退出码 0,实际 ${res.code}\nstdout: ${res.stdout}\nstderr: ${res.stderr}`,
  )
  return JSON.parse(res.stdout) as T
}

interface ConnectHandle {
  deviceId: string
  exit: Promise<CliResult>
  /** ready 事件(resolve 为 mountPath);被拒的连接永不 resolve。 */
  ready: Promise<string>
  stop(): Promise<CliResult>
}

/** 起 `tb connect` 长驻子进程,解析 --json 事件流。 */
function startConnect(deviceId: string, extraArgs: string[], sk: string): ConnectHandle {
  const child = spawn(
    process.execPath,
    [CLI, 'connect', '--device-id', deviceId, ...extraArgs, '--json'],
    {
      env: { ...process.env, TB_BASE_URL: baseUrl, TB_SK: sk },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  )
  let stdout = ''
  let stderr = ''
  let resolveReady: (mountPath: string) => void = () => {}
  const ready = new Promise<string>((resolve) => {
    resolveReady = resolve
  })
  // printJson 输出多行缩进 JSON:按顶层 `}` 行分块解析事件流。
  let chunk = ''
  const rl = createInterface({ input: child.stdout })
  rl.on('line', (line) => {
    stdout += `${line}\n`
    chunk += `${line}\n`
    if (line !== '}' && line !== '{}') return
    const text = chunk
    chunk = ''
    try {
      const evt = JSON.parse(text) as { event?: string, mountPath?: string }
      if (evt.event === 'ready') resolveReady(String(evt.mountPath))
    } catch {
      // 未闭合/非 JSON 块:继续累积由后续行闭合;最终原文都在 stdout 供失败诊断。
      chunk = text
    }
  })
  child.stderr.on('data', (c) => {
    stderr += String(c)
  })
  const exit = new Promise<CliResult>((resolve) => {
    child.on('close', code => resolve({ code, stdout, stderr }))
  })
  return {
    deviceId,
    ready,
    exit,
    async stop() {
      if (child.exitCode === null && !child.killed) child.kill('SIGTERM')
      const res = await Promise.race([exit, sleep(5_000).then(() => null)])
      if (res !== null) return res
      child.kill('SIGKILL')
      return exit
    },
  }
}

/** 等 ready;子进程提前退出或超时 → 抛错(带完整输出)。 */
async function waitReady(h: ConnectHandle, ms: number): Promise<string> {
  const exited = h.exit.then((res): never => {
    throw new Error(
      `tb connect(${h.deviceId}) 提前退出 code=${res.code}\nstdout: ${res.stdout}\nstderr: ${res.stderr}`,
    )
  })
  exited.catch(() => {}) // ready 先到时进程仍长驻,防 teardown 阶段悬空 rejection
  return withTimeout(Promise.race([h.ready, exited]), ms, `tb connect(${h.deviceId}) ready`)
}

/** 轮询 ~help 直到新签发的 SK 生效(KV 最终一致,同 verify-revocation 的探测手法)。 */
async function waitSkUsable(sk: string): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < SK_PROPAGATION_TIMEOUT_MS) {
    const res = await fetch(`${baseUrl}/~help`, { headers: { authorization: `Bearer ${sk}` } })
    if (res.status === 200) return
    await sleep(2_000)
  }
  throw new Error(`restricted SK 在 ${SK_PROPAGATION_TIMEOUT_MS / 1000}s 内未生效(KV 传播)`)
}

/**
 * teardown:删设备注册节点(子节点在前;not_found 等失败静默,保证幂等可重跑)。
 * sk 须是注册该设备的 SK——他人注册的节点 delete 得 conflict,admin 也不例外。
 * 设备断开时 DO 的 markDisconnected 会 setOnline(false) 回写主节点,与本删除存在竞态,
 * 故删后校验:节点仍在(被回写)则再删一轮。
 */
async function cleanupDeviceNodes(deviceId: string, sk: string): Promise<void> {
  const paths = [`device/${deviceId}/shell`, `device/${deviceId}/fs`, `device/${deviceId}`]
  for (let round = 0; round < 3; round++) {
    for (const path of paths) {
      await runCli(
        [
          'call',
          'system/registry',
          '--tool',
          'delete',
          '--args',
          JSON.stringify({ path }),
          '--json',
        ],
        sk,
      )
    }
    await sleep(2_000)
    const got = await runCli(
      [
        'call',
        'system/registry',
        '--tool',
        'get',
        '--args',
        JSON.stringify({ path: `device/${deviceId}` }),
        '--json',
      ],
      adminSk,
    )
    if (got.code !== 0) return // not_found:删净
  }
  console.error(`warn: device/${deviceId} 节点删除后仍存在(断线回写竞态),请手动清理`)
}

interface ExecResult {
  exitCode: number
  stderr: string
  stdout: string
}

function callShell(deviceId: string, command: string): Promise<ExecResult> {
  return cliJson<ExecResult>(
    ['call', `device/${deviceId}/shell`, '--tool', 'exec', '--args', JSON.stringify({ command })],
    adminSk,
  )
}

async function main(): Promise<void> {
  const rand = randomBytes(4).toString('hex')
  const deviceId = `verify-dev-${rand}`
  const fileContent = `p4-fs-${rand}\n`

  const tmpRoot = await mkdtemp(join(tmpdir(), 'tb-verify-fs-'))
  await writeFile(join(tmpRoot, 'hello.txt'), fileContent)
  const fsKey = `${basename(tmpRoot)}/hello.txt` // fs entry 首段 = root basename

  const handles: ConnectHandle[] = []
  /** teardown 清单:节点只能由注册它的 SK 删除(admin 也会得 conflict)。 */
  const cleanups: Array<{ deviceId: string, sk: string }> = [{ deviceId, sk: adminSk }]
  let restrictedSkId: string | undefined

  // 逐断言收集失败:一条失败不阻断其余断言,最后统一汇总(退出码 0=全过)。
  const failures: string[] = []
  const step = async (name: string, fn: () => Promise<void>): Promise<boolean> => {
    try {
      await fn()
      return true
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`FAIL ${name}: ${msg}`)
      failures.push(name)
      return false
    }
  }

  try {
    // 1) 主设备接入:shell 白名单仅 echo + fs 暴露临时目录。接不上则后续无意义,直接抛。
    const dev = startConnect(deviceId, ['--allow', 'echo', '--fs', tmpRoot], adminSk)
    handles.push(dev)
    const mountPath = await waitReady(dev, READY_TIMEOUT_MS)
    assert.equal(mountPath, `device/${deviceId}`, `mountPath 预期 device/${deviceId}`)
    console.log(`ok  device connected: ${mountPath}`)

    // 2) 断言①:shell exec 经 HTTP 返回 stdout。
    await step('① shell exec', async () => {
      const exec = await callShell(deviceId, 'echo hi-p4')
      assert.equal(exec.exitCode, 0, `shell exec 预期 exitCode 0,实际 ${exec.exitCode}`)
      assert.match(
        exec.stdout,
        /hi-p4/,
        `shell stdout 预期含 hi-p4,实际 ${JSON.stringify(exec.stdout)}`,
      )
      console.log('ok  ① shell exec → stdout 含 hi-p4')
    })

    // 3) 断言②:fs 读到临时文件真实内容。
    await step('② fs cat', async () => {
      const entry = await cliJson<{ content: unknown }>(
        ['ctx', 'cat', `device/${deviceId}/fs`, fsKey],
        adminSk,
      )
      assert.equal(
        entry.content,
        fileContent,
        `fs cat 内容不符,实际 ${JSON.stringify(entry.content)}`,
      )
      console.log('ok  ② fs cat → 读到临时文件真实内容')
    })

    // 3+) opt-in:跨休眠窗口调用(hibernation 唤醒恢复,guides/do-websocket-hibernation.md)。
    if (process.env.TB_VERIFY_HIBERNATION === '1') {
      await step('①+ 跨休眠窗口 shell exec', async () => {
        console.log(`..  hibernation 用例:空闲 ${HIBERNATION_IDLE_MS / 1000}s 后再调用`)
        await sleep(HIBERNATION_IDLE_MS)
        const again = await callShell(deviceId, 'echo hi-p4-hib')
        assert.match(again.stdout, /hi-p4-hib/, '跨休眠窗口 stdout 预期含 hi-p4-hib')
        console.log('ok  ①+ 跨休眠窗口(≥150s 空闲)shell exec 仍成功')
      })
    }

    // 4) 断言③:registerPaths 收紧(段级前缀,scope 给足以隔离变量)。
    const issued = await step('③ 签发受限 SK', async () => {
      const created = await cliJson<{ key: { id: string }, secret: string }>(
        [
          'sk',
          'create',
          '--owner',
          'agent:verify-device',
          '--scope',
          // read 供 ~help 探活与 teardown 的 registry 可见性;register 供反向注册。
          // 注意只传一个 --scope:citty 对重复 string flag 是 last-wins(已知 CLI bug)。
          '**:read,register',
          '--register-path',
          `device/allowed-${rand}`,
          '--description',
          'temporary SK for verify-device.ts (safe to revoke)',
        ],
        adminSk,
      )
      restrictedSkId = created.key.id
      console.log(
        `ok  issued restricted SK id=${restrictedSkId} registerPaths=[device/allowed-${rand}]`,
      )
      await waitSkUsable(created.secret)

      // 4a) 越界 deviceId → 网关 error 帧关连接:进程自行退出(不重连)、从未 ready、
      //     registry 不出现该节点。
      //     注:已知 CLI bug——onRejected 里 socket.close(1008) 同步派发 close 事件,
      //     resolveClosed 抢先于 rejectClosed,拒绝被吞、退出码 0 且无错误输出;
      //     故此处不断言退出码/错误文案,以"未 ready + 节点不存在"为拒绝证据。
      await step('③a 越界注册被拒', async () => {
        const outsideId = `outside-${rand}`
        cleanups.push({ deviceId: outsideId, sk: created.secret })
        const outside = startConnect(outsideId, ['--allow', 'echo'], created.secret)
        handles.push(outside)
        let outsideReady = false
        outside.ready.then(() => {
          outsideReady = true
        })
        await withTimeout(outside.exit, REJECT_TIMEOUT_MS, `tb connect(${outsideId}) 被拒退出`)
        assert.equal(outsideReady, false, '越界注册不应达到 ready')
        const got = await runCli(
          [
            'call',
            'system/registry',
            '--tool',
            'get',
            '--args',
            JSON.stringify({ path: `device/${outsideId}` }),
            '--json',
          ],
          adminSk,
        )
        assert.notEqual(got.code, 0, `越界节点不应注册成功,registry get 输出:${got.stdout}`)
        assert.match(got.stdout, /not_found/, `registry get 预期 not_found,实际:${got.stdout}`)
        console.log('ok  ③a 越界 deviceId 注册被拒(未 ready + 节点未出现)')
      })

      // 4b) 前缀内 deviceId → 正常 ready。
      await step('③b 前缀内注册成功', async () => {
        const allowedId = `allowed-${rand}`
        cleanups.push({ deviceId: allowedId, sk: created.secret })
        const allowed = startConnect(allowedId, ['--allow', 'echo'], created.secret)
        handles.push(allowed)
        await waitReady(allowed, READY_TIMEOUT_MS)
        console.log('ok  ③b 前缀内 deviceId 注册成功(ready)')
      })
    })
    if (!issued) failures.push('③a 越界注册被拒(未执行)', '③b 前缀内注册成功(未执行)')

    if (failures.length > 0) {
      throw new Error(`断言未全过:${failures.join(' / ')}`)
    }
    console.log(`\nverify-device passed against ${baseUrl}`)
  } finally {
    for (const h of handles) await h.stop()
    for (const c of cleanups) await cleanupDeviceNodes(c.deviceId, c.sk)
    // 受限 SK 最后吊销:teardown 里它还要自删所注册节点。
    if (restrictedSkId !== undefined) await runCli(['sk', 'rm', restrictedSkId, '--json'], adminSk)
    await rm(tmpRoot, { recursive: true, force: true })
  }
}

main().catch((err) => {
  console.error(`verify-device FAILED: ${err instanceof Error ? err.message : String(err)}`)
  process.exit(1)
})

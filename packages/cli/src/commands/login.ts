import { createInterface } from 'node:readline/promises'
import { defineCommand } from 'citty'
import { globalArgs } from '../args'
import { readConfig, writeConfig } from '../config'
import { apiFetch, CliError } from '../http'
import { guard, printJson, printLine } from '../output'

/** 交互式读取一行(仅在缺 flag 且为 TTY 时用;SK 明文回显,见交付说明的偏差项)。 */
async function prompt(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  try {
    return (await rl.question(question)).trim()
  } finally {
    rl.close()
  }
}

/**
 * `tb login` —— 存 BaseURL + SK 到本地 profile(Proto 附A:纯本地,无服务端接口)。
 *
 * 输入:`--base-url`/`--sk`(缺省则交互式提问);`--profile` 命名(默认 "default")。
 * 验证:`GET /~help` 带 Bearer——401 视为 SK 被拒;其它状态(含 403 无根读权但已认证)
 *       都视为 SK 被网关接受,写入配置并设为 current。文件权限 0600。
 */
export const loginCommand = defineCommand({
  meta: { name: 'login', description: 'Store gateway base URL + SK to a local profile' },
  args: {
    ...globalArgs,
    profile: { type: 'string', description: 'Profile name', default: 'default' },
  },
  async run({ args }) {
    const asJson = Boolean(args.json)
    await guard(asJson, async () => {
      const profile = String(args.profile ?? 'default')
      let baseUrl = args['base-url'] ?? process.env.TB_BASE_URL
      let sk = args.sk ?? process.env.TB_SK
      if (!baseUrl && process.stdin.isTTY) baseUrl = await prompt('Gateway base URL: ')
      if (!sk && process.stdin.isTTY) sk = await prompt('Secret Key (SK): ')
      if (!baseUrl) throw new CliError('base URL is required (pass --base-url or set TB_BASE_URL)')
      if (!sk) throw new CliError('SK is required (pass --sk or set TB_SK)')

      const normalized = baseUrl.replace(/\/+$/, '')
      const res = await apiFetch({ baseUrl: normalized, sk }, { path: '/~help', accept: 'text' })
      if (res.status === 401) {
        throw new CliError('SK rejected by gateway (401): check the key', 'permission_denied')
      }

      const config = readConfig()
      config.profiles[profile] = { baseUrl: normalized, sk }
      config.current = profile
      writeConfig(config)

      if (asJson) printJson({ ok: true, profile, baseUrl: normalized })
      else printLine(`logged in: profile "${profile}" → ${normalized}`)
    })
  },
})

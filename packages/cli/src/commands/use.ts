import { defineCommand } from 'citty'
import { readConfig, writeConfig } from '../config'
import { CliError } from '../http'
import { guard, printJson, printLine } from '../output'

/**
 * `tb use <profile>` —— 切换当前 profile(纯本地;多 server 配置切换,Arch:215)。
 * 无参数时列出全部 profile 并标注当前。
 */
export const useCommand = defineCommand({
  meta: { name: 'use', description: 'Switch the current profile (or list profiles)' },
  args: {
    json: { type: 'boolean', description: 'Output parseable JSON', default: false },
    profile: { type: 'positional', description: 'Profile name to switch to', required: false },
  },
  async run({ args }) {
    const asJson = Boolean(args.json)
    await guard(asJson, async () => {
      const config = readConfig()
      const profile = args.profile as string | undefined

      if (!profile) {
        const names = Object.keys(config.profiles)
        if (asJson) printJson({ current: config.current ?? null, profiles: names })
        else if (names.length === 0) printLine('no profiles yet; run `tb login`')
        else for (const n of names) printLine(`${n === config.current ? '* ' : '  '}${n}`)
        return
      }

      if (!config.profiles[profile]) {
        throw new CliError(
          `unknown profile "${profile}"; run \`tb login --profile ${profile}\` first`,
        )
      }
      config.current = profile
      writeConfig(config)
      if (asJson) printJson({ ok: true, current: profile })
      else printLine(`switched to profile "${profile}"`)
    })
  },
})

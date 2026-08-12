/**
 * 上游 schema 的指纹。等价闸门比对的基准。
 *
 * 全部 provider 的指纹存在**一份** `migration-fingerprints.json` 里,不是每个 provider 目录
 * 各放一个:后者会让每次迁移都在 `src/<service>/` 里多出一个与业务代码无关的文件,读目录时
 * 分不清哪些是要维护的源码。合并后 `src/<service>/` 只剩 schema.ts / api.ts / index.ts
 * (加可选的 handwritten.json + schema.handwritten.ts)。
 *
 * 为什么是指纹而不是完整 schema:最初落盘的是上游 schema 原样拷贝,clerk 一个就 197 KB,
 * 15 个产物合计 446 KB —— 1329 个全迁完会是 ~40 MB 的仓库重量,而它与 `schema.ts` 本就是
 * **同一份信息的两种表示**(闸门做的正是"两者应该等价"的比对)。指纹留住了闸门的全部作用
 * (schema.ts 被手改而没登记豁免时红灯),体积降到 ~1/30。
 *
 * 指纹取在 **normalize 之后**:那些可论证保语义的等价写法(`additionalProperties:true` ↔ `{}`、
 * `z.int()` 的安全整数边界……)不该让指纹白白不匹配。这也意味着改动 normalize 规则会让全部
 * 指纹失效 —— 那是**正确**的:归一化规则本身就是契约的一部分,改了它就该重新对齐一次。
 */

/** SHA-256 十六进制(Web Crypto,与插件面同一套 API)。 */
async function sha256(text) {
  const bytes = new TextEncoder().encode(text)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('')
}

/**
 * 一个 action 的指纹。`description` 也纳入 —— 它是给 agent 读的,迁移不得悄悄改写。
 * @param normalize 归一化函数(由调用方注入,保证与闸门用同一份规则)
 */
export async function fingerprintAction(action, normalize) {
  const of = async value => (value === undefined ? undefined : sha256(JSON.stringify(normalize(value))))
  return {
    description: await sha256(action.description ?? ''),
    ...(action.inputSchema === undefined ? {} : { inputSchema: await of(action.inputSchema) }),
    ...(action.outputSchema === undefined ? {} : { outputSchema: await of(action.outputSchema) }),
  }
}

/** 归一化规则版本:改了 parity.mjs 的 normalize 就该 +1,提示全部指纹需重新对齐。 */
export const NORMALIZE_VERSION = 1

/** 一个 provider 的指纹条目(进全局清单的 providers[service])。 */
export async function fingerprintProvider(provider, normalize) {
  const actions = {}
  for (const action of provider.actions ?? []) {
    actions[action.name] = await fingerprintAction(action, normalize)
  }
  return {
    displayName: provider.displayName,
    authTypes: provider.authTypes,
    actions,
  }
}

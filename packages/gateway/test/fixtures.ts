// 集成测试与 vitest.config 共用的常量(独立文件:不引入任何 node/插件依赖,
// 可安全被 workerd 内的测试文件 import)。miniflare bindings 由 vitest.config 注入,
// 引导时用 TEST_ADMIN_SK 作 Admin SK 明文。
export const TEST_ADMIN_SK = 'tbk_test_admin_key_0000000000'
export const TEST_ENCRYPTION_KEY = '3ZwpbBkSrp3eT9ylcZedfN33yq9fJLlmeusH98qNbt8'

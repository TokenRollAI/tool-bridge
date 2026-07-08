/// <reference types="@cloudflare/vitest-pool-workers/types" />

// vitest-pool-workers 0.18 把 `cloudflare:test` 模块声明(SELF、env 等)移到 /types 子路径。
// 此引用让 test/ 下的 `import { SELF } from 'cloudflare:test'` 获得类型。

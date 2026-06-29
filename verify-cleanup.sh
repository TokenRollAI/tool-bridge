#!/usr/bin/env bash
# 清理验证产生的临时文件(不影响已提交的源码)
cd "$(dirname "$0")"
rm -f .dev.vars wrangler.verify.jsonc /tmp/intro.md /tmp/setup.md /tmp/readme.txt
echo "已清理 .dev.vars / wrangler.verify.jsonc / /tmp 临时文件"
echo "提示:本地 R2/KV 模拟数据在 .wrangler/ 下,已被 gitignore;如需彻底清空可删 .wrangler/state"

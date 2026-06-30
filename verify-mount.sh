#!/usr/bin/env bash
# 手动验证:Mount adapter(FS/S3 as TB,基于 R2 本地模拟)
# 用法:bash verify-mount.sh        然后按提示在另一个终端跑 curl
set -euo pipefail
cd "$(dirname "$0")"

PORT=8787

echo "==> 1. 生成带 R2 binding 的临时 wrangler 配置"
python3 - <<'PY'
lines=[l for l in open('wrangler.jsonc').read().split('\n') if not l.strip().startswith('//')]
s='\n'.join(lines).rstrip().rstrip('}').rstrip().rstrip(',')
s+=',\n  "r2_buckets": [{ "binding": "TB_FILES", "bucket_name": "tool-bridge-files" }]\n}\n'
open('wrangler.verify.jsonc','w').write(s)
print("   写好 wrangler.verify.jsonc")
PY

echo "==> 2. 配置 mount 节点(.dev.vars,单行 JSON)"
python3 - <<'PY'
import json
cfg={'type':'directory','id':'root','title':'Catalog','children':[
  {'type':'mount','id':'files','title':'Files','bucket':'TB_FILES'}]}
open('.dev.vars','w').write('MCP_SERVERS_JSON='+json.dumps(cfg))
print("   写好 .dev.vars")
PY

echo "==> 3. 向本地 R2 种几个文件"
printf '# Intro\nhello docs' > /tmp/intro.md
printf 'setup steps'        > /tmp/setup.md
printf 'top readme'         > /tmp/readme.txt
npx wrangler r2 object put tool-bridge-files/docs/intro.md       --file=/tmp/intro.md  --local -c wrangler.verify.jsonc >/dev/null 2>&1
npx wrangler r2 object put tool-bridge-files/docs/guide/setup.md --file=/tmp/setup.md  --local -c wrangler.verify.jsonc >/dev/null 2>&1
npx wrangler r2 object put tool-bridge-files/readme.txt          --file=/tmp/readme.txt --local -c wrangler.verify.jsonc >/dev/null 2>&1
echo "   种好 docs/intro.md, docs/guide/setup.md, readme.txt"

cat <<EOF

==> 4. 现在启动服务(这个命令会一直运行,Ctrl-C 退出):

    npm run build && npx wrangler dev --ip 127.0.0.1 --port $PORT -c wrangler.verify.jsonc

==> 5. 另开一个终端,逐条验证:

  # 根:应列出 ./docs(folder)和 ./readme.txt(file)
  curl -s -H 'Accept: application/json' http://127.0.0.1:$PORT/htbp/files/~help

  # 进入 docs/:应列出 ./guide 和 ./intro.md
  curl -s -H 'Accept: application/json' http://127.0.0.1:$PORT/htbp/files/docs/~help

  # 文件叶子:应是 GET 的 end-path
  curl -s -H 'Accept: application/json' http://127.0.0.1:$PORT/htbp/files/docs/intro.md/~help

  # 读文件内容
  curl -s -X POST http://127.0.0.1:$PORT/htbp/files/docs/intro.md --data '{}'

  # 整树 crawl(应递归走完 docs/guide/setup.md 等)
  curl -s http://127.0.0.1:$PORT/api/tree

==> 6. 验证完清理:

    bash verify-cleanup.sh
EOF

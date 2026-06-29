#!/usr/bin/env bash
# 手动验证:多租户(Secret Key + KV 隔离,基于本地 KV 模拟)
# 用法:bash verify-tenant.sh        然后按提示在另一个终端跑 curl
set -euo pipefail
cd "$(dirname "$0")"

PORT=8787

echo "==> 1. 生成带 KV binding 的临时 wrangler 配置"
python3 - <<'PY'
lines=[l for l in open('wrangler.jsonc').read().split('\n') if not l.strip().startswith('//')]
s='\n'.join(lines).rstrip().rstrip('}').rstrip().rstrip(',')
s+=',\n  "kv_namespaces": [{ "binding": "TENANTS", "id": "tenants_local" }]\n}\n'
open('wrangler.verify.jsonc','w').write(s)
print("   写好 wrangler.verify.jsonc")
PY

echo "==> 2. 计算两把 Secret Key 的 sha256"
HA=$(node -e "console.log(require('crypto').createHash('sha256').update('key-A').digest('hex'))")
HB=$(node -e "console.log(require('crypto').createHash('sha256').update('key-B').digest('hex'))")
echo "   key-A -> $HA"
echo "   key-B -> $HB"

echo "==> 3. 向本地 KV 种两个租户的树 + 两把 key 映射"
TREE_A='{"type":"directory","id":"root","title":"Tenant A","children":[{"type":"http","id":"alpha","title":"Alpha API","endpoints":[{"name":"ping","method":"GET","url":"https://a.example.com/ping"}]}]}'
TREE_B='{"type":"directory","id":"root","title":"Tenant B","children":[{"type":"http","id":"bravo","title":"Bravo API","endpoints":[{"name":"pong","method":"GET","url":"https://b.example.com/pong"}]}]}'
KV() { npx wrangler kv key put --binding=TENANTS --local -c wrangler.verify.jsonc "$@" >/dev/null 2>&1; }
KV "tenant:a" "$TREE_A"
KV "tenant:b" "$TREE_B"
KV "apikey:$HA" '{"tenantId":"a"}'
KV "apikey:$HB" '{"tenantId":"b"}'
echo "   种好 tenant:a / tenant:b / 两把 apikey"

cat <<EOF

==> 4. 启动服务(一直运行,Ctrl-C 退出):

    npm run build && npx wrangler dev --ip 127.0.0.1 --port $PORT -c wrangler.verify.jsonc

==> 5. 另开终端,逐条验证隔离:

  # 无 token -> 401(租户模式要求 Secret Key)
  curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:$PORT/htbp/~help

  # 错 key -> 401
  curl -s -o /dev/null -w '%{http_code}\n' -H 'Authorization: Bearer nope' http://127.0.0.1:$PORT/htbp/~help

  # key-A:只看到 Tenant A / ./alpha
  curl -s -H 'Authorization: Bearer key-A' http://127.0.0.1:$PORT/htbp/~help

  # key-B:只看到 Tenant B / ./bravo
  curl -s -H 'Authorization: Bearer key-B' http://127.0.0.1:$PORT/htbp/~help

  # key-A 访问 B 独有节点 bravo -> 404(隔离)
  curl -s -o /dev/null -w '%{http_code}\n' -H 'Authorization: Bearer key-A' http://127.0.0.1:$PORT/htbp/bravo/~help

  # key-A 访问自己的 alpha -> 200
  curl -s -o /dev/null -w '%{http_code}\n' -H 'Authorization: Bearer key-A' http://127.0.0.1:$PORT/htbp/alpha/~help

  # 各自 crawl 只含自己的树
  curl -s -H 'Authorization: Bearer key-A' http://127.0.0.1:$PORT/api/tree
  curl -s -H 'Authorization: Bearer key-B' http://127.0.0.1:$PORT/api/tree

==> 6. 验证完清理:

    bash verify-cleanup.sh
EOF

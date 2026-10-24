#!/usr/bin/env bash
# 一条命令自检：仓库规范与应用门禁
# 用法：bash scripts/check.sh
# 约定：任何一步失败，退出码非 0 —— 可以直接挂 CI。
#
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1

NODE="${NODE:-node}"
COMMIT_RANGE="${COMMIT_RANGE:-HEAD~1..HEAD}"
fail=0

echo "== 1/3 全仓库噪声扫描 =="
if "$NODE" scripts/scan-noise.mjs; then echo "  → 通过"; else echo "  → 失败"; fail=1; fi

echo
echo "== 2/3 提交信息检查（$COMMIT_RANGE）=="
if "$NODE" --test scripts/lint-commit.test.mjs && "$NODE" scripts/lint-commit.mjs --range "$COMMIT_RANGE"; then
  echo "  → 通过"
else
  echo "  → 失败"
  fail=1
fi

echo "== 3/3 类型、lint、业务与数据库测试、生产构建 =="
if pnpm check; then echo "  → 通过"; else echo "  → 失败"; fail=1; fi

echo
if [ "$fail" -ne 0 ]; then
  echo "✗ 自检未通过"
  exit 1
fi
echo "✓ 全部通过"

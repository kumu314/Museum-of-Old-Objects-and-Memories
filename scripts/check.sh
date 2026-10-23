#!/usr/bin/env bash
# 一条命令自检：噪声扫描 + 提交规范自测
# 用法：bash scripts/check.sh
# 约定：任何一步失败，退出码非 0 —— 可以直接挂 CI。
#
# 选题定下、有了测试之后，在这里加第 3 步（你自己的测试命令），
# 并同步加到 .github/workflows/ci.yml。

set -uo pipefail
cd "$(dirname "$0")/.." || exit 1

NODE="${NODE:-node}"
fail=0

echo "== 1/2 全仓库噪声扫描 =="
if "$NODE" scripts/scan-noise.mjs; then echo "  → 通过"; else echo "  → 失败"; fail=1; fi

echo
echo "== 2/2 提交信息检查（最近 1 条）=="
if "$NODE" scripts/lint-commit.mjs --range HEAD~1..HEAD; then
  echo "  → 通过"
else
  echo "  → 失败"
  fail=1
fi

echo
if [ "$fail" -ne 0 ]; then
  echo "✗ 自检未通过"
  exit 1
fi
echo "✓ 全部通过"

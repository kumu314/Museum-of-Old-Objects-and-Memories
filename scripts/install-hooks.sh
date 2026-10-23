#!/usr/bin/env bash
# 装提交钩子。每个队友克隆仓库后跑一次。
# 用法：bash scripts/install-hooks.sh

set -e
cd "$(dirname "$0")/.." || exit 1

if [ ! -d .githooks ]; then
  echo "✗ 找不到 .githooks 目录，请在仓库根目录运行"
  exit 1
fi

git config core.hooksPath .githooks
chmod +x .githooks/* 2>/dev/null || true

echo "✓ 钩子已启用（core.hooksPath = .githooks）"
echo ""
echo "  提交时会检查："
echo "    · 提交信息格式（type(scope): 简述，scope 可省略）"
echo "    · 空壳文件 / console.log / debugger"
echo "    · 敏感文件 / 生成物目录"
echo ""
echo "  卸载：git config --unset core.hooksPath"

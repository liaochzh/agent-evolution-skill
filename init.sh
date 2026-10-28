#!/usr/bin/env bash
set -euo pipefail

SKILL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "🔧 初始化 agent-evolution skill..."

# init 幂等：已存在 state 时不会覆盖，只提示路径
if node "$SKILL_DIR/scripts/evolution.js" init; then
  echo ""
  echo "存储路径: Git 仓库根目录下的 .opencode/agent-evolution/state.json"
  echo "（非 Git 仓库时回退到当前目录；可用 AGENT_EVOLUTION_STATE 指定）"
  echo ""
  echo "常用命令："
  echo "  node $SKILL_DIR/scripts/evolution.js recall \"任务描述\""
  echo "  node $SKILL_DIR/scripts/evolution.js lesson-add L-001 \"触发条件\" \"动作\" --domain workflow --confidence 0.7"
  echo "  node $SKILL_DIR/scripts/evolution.js lesson-feedback L-001 helpful \"验证有效\""
  echo "  node $SKILL_DIR/scripts/evolution.js review-task \"任务\" 90 \"亮点\" \"改进\""
  echo "  node $SKILL_DIR/scripts/evolution.js report"
  echo "  node $SKILL_DIR/scripts/evolution.js dedupe"
  echo "  node $SKILL_DIR/scripts/evolution.js crystallize --min-confidence 0.8"
  echo "  node $SKILL_DIR/scripts/evolution.js export --format md --out playbook.md"
  echo ""
  echo "注意：init 不会覆盖已有数据；确需重置请用 init --force"
else
  echo "❌ 初始化失败"
  exit 1
fi

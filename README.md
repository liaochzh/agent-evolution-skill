# agent-evolution

一个用于 **Agent 行为固化与进化** 的 opencode skill：把纠错、踩坑、复盘沉淀成**带置信度与证据的原子经验**，按任务召回，靠反馈衰减。

> 面向 opencode / Claude 一类支持 `SKILL.md` 的 agent 运行时。Node.js ≥ 18 实现，唯一依赖 `js-yaml`。

## 它解决什么问题

| 常见失败 | 本 skill 的做法 |
|---|---|
| 「记住这个教训」写在对话里，下个会话就没了 | 经验落到 `<git-root>/.opencode/agent-evolution/state.json`，跨会话持久；`AGENT_EVOLUTION_STATE` 可覆盖 |
| 记忆越攒越多，召回时全是噪声 | 每条经验有**置信度**（默认 0.5，`>= 0.6` 才会被召回）与**时间衰减**（半衰期 30 天） |
| 记下来就永远为真，被推翻也不下线 | `lesson-feedback helpful +0.08 / harmful -0.20`；`< 0.2` 且 2 次 harmful 自动 retired |
| 记成整段对话，下次看不懂也用不上 | 一条经验 = **一个触发条件 + 一个动作**，超过两句要求拆开 |
| 换项目等于从零开始 | `export` / `import`（默认封顶 0.6 防污染）；`lesson-promote --global` 提升到全局库 |
| 经验攒够了还是没变成能力 | `crystallize` 生成 skill 草稿，人工审核后 `--write` |

## 何时触发

任务开始时召回、被纠正或踩坑后记录、任务结束时复盘、经验多了要体检去重、想把经验结晶成 skill。

**不适用于**：代码审查（用 `review`）、代码提交（用 `commit`）。`description` 里已写明这些排除关系。

## 安装

```bash
git clone https://github.com/liaochzh/agent-evolution-skill.git
ln -s "$(pwd)/agent-evolution-skill" ~/.config/opencode/skills/agent-evolution
```

首次使用：

```bash
cd <你的项目>
node ~/.config/opencode/skills/agent-evolution/scripts/evolution.js init
```

不同运行时的 skills 目录不同（例如 Claude Code 的 `~/.claude/skills/`），把本目录放进去即可，`SKILL.md` 的 frontmatter（`name` / `description`）就是触发依据。

## 标准闭环

```bash
# 1. 任务开始：召回 + 体检提醒 + 上次复盘的待改进（只读，不写 state）
node <S>/scripts/evolution.js bootstrap "修改登录接口"

# 2. 任务中：记录一条原子经验
node <S>/scripts/evolution.js lesson-add L-001 "修改共享代码前" "先 grep 调用方" \
  --domain workflow --confidence 0.7 --evidence "上次漏改调用方导致回归"

# 3. 经验生效或误导：反馈
node <S>/scripts/evolution.js lesson-feedback L-001 helpful "这次避免了回归"

# 4. 任务结束：复盘 + 经验一次写入（校验失败不落盘）
node <S>/scripts/evolution.js wrap-up "实现登录" 90 "核心逻辑完成" "需补错误处理" \
  --lessons '[{"trigger":"改认证代码前","action":"先查 token 来源","confidence":0.7}]'

# 5. 定期体检
node <S>/scripts/evolution.js doctor --days 30
```

`<S>` = 本 skill 的 base directory（加载时由系统给出绝对路径）。

## 结构

```
SKILL.md                # 主体：何时激活 → 标准闭环 → 常用命令 → 置信度与生命周期 → 安全边界
references/cli.md       # 完整命令参数与输出示例
references/design.md    # 数据模型、评分公式、设计取舍
scripts/evolution.js    # CLI 入口，按注册表分发；22 个模块 + 21 个测试文件（162 用例）
docs/                   # 本地方案 / 审查 / 接力棒（留在项目内，不入库）
```

## 数据模型速览

| 实体 | 用途 |
|---|---|
| `lessons` | 原子经验：`trigger` + `action` + `domain` + `confidence` + `evidence` |
| `errors` / `insights` | 错误档案与提炼出的洞察，可被经验引用 |
| `reviews` | 任务复盘：完成度、亮点、待改进 |
| `rules` / `patterns` | 规则执行与违规追踪（`check` / `violation` / `stats`） |
| `events` | 审计流水：所有写操作留痕 |

## 安全边界

- `crystallize` 默认只打印草稿，`--write` 才落盘，需人工审核。
- `prune` / `rule-remove` / `init-rules` 默认 dry-run，`--apply`（`init-rules` 为 `--dry-run`）才生效。
- `doctor --fix` 先备份 `<state>.<ts>.doctor.bak`，在副本上预演，检测到会删条目即中止。
- `bootstrap` 只读：不迁移、不写 `.bak`。
- 日志与 `export` 默认脱敏（token / 邮箱 / 家目录）。

## 测试

```bash
npm install
npm test        # node --test scripts/*.test.js
```

## 关于本仓库的 docs

`docs/`（方案 / 审查 / 接力棒）留在项目内但不入库：其中含本机路径与门禁内部细节，跨版本不可复现。运行时数据（`.opencode/`、`*.bak`、`logs/`）同样不入库。

## License

[MIT](LICENSE) © 2026 liaochzh

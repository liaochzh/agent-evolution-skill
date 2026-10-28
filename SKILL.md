---
name: agent-evolution
description: Agent 行为固化与进化系统 v3.0。把纠错、踩坑、复盘沉淀为带置信度与证据的原子经验，支持按任务召回、衰减淘汰、去重审计、导出导入与结晶为 skill。Use when 需要记录/召回经验、复盘任务、追踪规则执行、踩坑后防止重犯、跨项目迁移记忆或把经验固化成技能；不用于代码审查（review）、不用于代码提交（commit）。
---

# Agent Evolution v3.0

> `<S>` = 本 skill 的 base directory（加载时由系统给出绝对路径）。
> 项目存储：`<git-root>/.opencode/agent-evolution/state.json`；可用 `AGENT_EVOLUTION_STATE` 覆盖。
> 全局存储：`~/.local/share/agent-evolution/global.json`；可用 `AGENT_EVOLUTION_GLOBAL_STATE` 覆盖。

## 何时激活

| 时机 | 动作 |
|---|---|
| 任务开始 | `bootstrap "<任务描述>"`：召回 + 体检提醒 + 上次复盘待改进（只读） |
| 任务开始，只想拿召回 | `recall "<任务描述>"`，把输出当作上下文提示 |
| 怀疑以前踩过同类坑 / 找历史方案 | `search "<关键词>"`，跨错误档案、洞察、复盘、经验检索 |
| 用户纠正你 / 踩坑 / 发现更优做法 | `lesson-add`，一次只记一条原子经验 |
| 某条经验再次生效或再次误导 | `lesson-feedback <id> helpful|harmful` |
| 任务结束 | `wrap-up`：复盘 + 经验一次写入 |
| 记忆变多、出现重复 / 状态可疑 | `doctor` 体检 → `dedupe` / `prune` / `rule-remove` |
| 经验稳定、值得跨项目复用 | `lesson-promote <id> --global`（需 confidence ≥ 0.8，只复制 trigger/action） |
| 经验稳定，想固化成技能 | `crystallize`，人工审核草稿后再落盘 |
| 换项目 / 分享给他人 | `export` / `import` |

**不要记录**：一次性 typo、外部服务抖动、代码里一眼可见的常识、整段对话。
一条经验 = 一个触发条件 + 一个动作，超过两句就拆开。

## 标准闭环

```bash
# 1. 任务开始：召回 + 体检提醒 + 上次复盘待改进（只读，不写 state）
node <S>/scripts/evolution.js bootstrap "修改登录接口"

# 1b. 找历史方案：跨错误/洞察/复盘/经验检索
node <S>/scripts/evolution.js search "token 过期"

# 2. 任务中：记录原子经验（confidence 默认 0.5，0.6 起才会被 recall）
node <S>/scripts/evolution.js lesson-add L-001 "修改共享代码前" "先 grep 调用方" \
  --domain workflow --confidence 0.7 --evidence "上次漏改调用方导致回归"

# 3. 验证后反馈：helpful +0.08，harmful -0.20
node <S>/scripts/evolution.js lesson-feedback L-001 helpful "这次避免了回归"

# 4. 任务结束：复盘 + 经验一次写入（校验失败不落盘）
node <S>/scripts/evolution.js wrap-up "实现登录" 90 "核心逻辑完成" "需补错误处理" \
  --lessons '[{"trigger":"改认证代码前","action":"先查 token 来源","confidence":0.7}]'

# 5. 定期体检（--fix 先备份再归一 config，不会删条目）
node <S>/scripts/evolution.js doctor --days 30
```

## 常用命令

| 目的 | 命令 |
|---|---|
| 初始化（幂等，不覆盖已有数据） | `init [--force]` |
| 闭环入口 | `bootstrap [query] [--limit] [--domain] [--threshold] [--no-doctor] [--json]`（只读） |
| 闭环出口 | `wrap-up <task> <completion> <highlights> <improvements> [--lessons json] [--link-error ids] [--link-insight ids] [--dry-run]` |
| 体检 | `doctor [--days 90] [--fix] [--json]`；`--fix` 先备份再归一 config，不删条目 |
| 召回 | `recall [query] [--limit 8] [--threshold 0.5] [--domain d] [--no-rules] [--touch] [--json]` |
| 历史检索 | `search "<query>" [--kind all\|errors\|insights\|lessons\|reviews\|rules] [--limit 10] [--min-score 0.15] [--json]` |
| 经验 | `lesson-add / lesson-feedback / lesson-promote [--global] / lesson-retire / lesson-edit / lesson-list [--global] / lesson-show / lesson-merge` |
| 复盘 | `review-task / review-list / review-detail <id\|index> / review-link / review-learning` |
| 错误与洞察 | `error-add / error-update / error-analyze / insight-add / insight-update / insight-migrate / insight-similar` |
| 规则与身份 | `add-rule / check / violation / stats / identity / identity-update / evolve` |
| 维护 | `dedupe / prune [--apply] / rule-remove [--apply] / events / report / heartbeat / detect` |
| 迁移与结晶 | `export [--format json\|md] [--out path]` / `import <bundle.json> [--dry-run] [--cap 0.6]` / `crystallize [--write]` |

完整参数、数据模型与示例见 `references/cli.md`；设计取舍与评分公式见 `references/design.md`。

## 置信度与生命周期

- 默认 `0.5`（pending）；`>= 0.6` 自动 active，才会被 `recall` 召回。
- `helpful +0.08`，`harmful -0.20`（纠错是更强证据）；上限 `0.95`。
- `< 0.2` 且累计 2 次 harmful → 自动 retired；`lesson-promote` 可复活。
- `recall` 排序 = 相关度 + 置信度 + 时间衰减（半衰期 30 天）；默认只取 8 条经验。
- 置信度只由反馈驱动，不要手工写 `--confidence 0.95` 冒充已验证经验。
- `lesson-promote <id> --global` 把经验写入全局库（默认 `~/.local/share/agent-evolution/global.json`，可用 `AGENT_EVOLUTION_GLOBAL_STATE` 覆盖），`recall` 会自动合并，全局项标 `[G]`。

## 输出与错误约定

- 普通命令输出单行 JSON；`recall` / `bootstrap` / `doctor` / `crystallize` / `export --format md` 输出原始 markdown。
- 失败时 stderr 输出 `{"error":{"code":"...","message":"..."}}`，退出码 1。
- 所有写入为临时文件 + rename 原子替换；2.0 状态首次读取会生成 `state.json.v2.0.bak` 备份。

## 安全边界

- `crystallize` 默认只打印草稿，`--write` 才落盘，且需人工审核后才作为正式 skill 使用。
- `prune` 默认 dry-run，`--apply` 才删除。
- `rule-remove` / `init-rules` 默认 dry-run（`init-rules` 用 `--dry-run`），变更写审计事件。
- `doctor --fix` 先备份 `<state>.<ts>.doctor.bak`，再在副本上预演；检测到会删条目即中止，原文件不动。
- `bootstrap` 只读：不迁移、不写 `.bak`、忽略 `--touch`。
- 日志默认脱敏（token / 邮箱 / 家目录）；`export` 默认脱敏。
- `import` 默认把置信度封顶 0.6，避免跨项目污染；确认来源可信再用 `--no-cap`。
- `lesson-promote --global` 只复制 trigger / action / domain 与置信度，不复制可能含项目细节的 evidence note。

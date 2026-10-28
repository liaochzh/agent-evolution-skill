# CLI 参考（v3.0）

所有命令：`node <S>/scripts/evolution.js <command> [args]`。
可选参数统一用 `--flag value` 或 `--flag=value`；布尔开关用 `--flag` / `--no-flag`。

存储：
- 项目：`<git-root>/.opencode/agent-evolution/state.json`（`AGENT_EVOLUTION_STATE` 覆盖）
- 全局：`~/.local/share/agent-evolution/global.json`（`AGENT_EVOLUTION_GLOBAL_STATE` 覆盖）

## 命令表

### 初始化与查询

| 命令 | 说明 |
|---|---|
| `init [--force]` | 初始化 state.json。已存在时返回 `created:false` 且不覆盖；`--force` 才重置 |
| `version` | 输出版本号 |
| `help` | 输出帮助 |
| `report` | 综合报告（规则/经验/错误/洞察/复盘/健康度/告警） |
| `events [--limit 50]` | 最近审计事件（倒序） |

### 闭环入口（推荐日常使用）

| 命令 | 说明 |
|---|---|
| `bootstrap [query] [--limit 8] [--domain d] [--threshold x] [--rules-limit n] [--no-doctor] [--json]` | 任务开始：召回 + 体检提醒（前 3 条）+ 上次复盘的待改进。只读 |
| `wrap-up <task> <completion> <highlights> <improvements> [--lessons json] [--link-error ids] [--link-insight ids] [--dry-run]` | 任务结束：复盘 + 经验单事务写入 |
| `doctor [--days 90] [--fix] [--json]` | 状态体检；`--fix` 备份后按 migrate 语义归一 config/version，不删条目 |

`bootstrap` 只读保证：

- 用原始 JSON + 内存归一，不触发迁移与 `.bak`；
- 忽略 `--touch` 等写型 flag；
- 空 state 也能用（输出「暂无经验」）。

`wrap-up` 校验（任一失败零落盘）：

- `completion` 必须是 0-100 的整数（与 `review-task` 的静默 clamp 不同）；
- `--lessons` 必须是合法 JSON 数组；元素 `trigger` / `action` 非空，`id` 不与已有经验冲突且批内唯一，`confidence ∈ [0.05, config.lifecycle.maxConfidence]`；
- `--link-error` / `--link-insight` 的 id 必须已存在；
- 返回 `duplicateHints`（相似度 ≥ 0.6 的前 3 条），仅提示不阻断。

`doctor` 检查项：

| code | level | 含义 | 建议 |
|---|---|---|---|
| `state_missing` | info | state 不存在 | `init` |
| `state_corrupt` | error | JSON 解析失败 | 从 `.bak` 恢复 |
| `schema_version_drift` | warn | 版本不是 3.0 | `doctor --fix` |
| `config_drift` | warn | config 缺键或类型不符 | `doctor --fix` |
| `duplicate_rules` / `duplicate_lessons` | warn | 归一相似度 ≥ 0.55 | `dedupe --kind ...` |
| `orphan_refs` | warn | 复盘引用不存在的 error/insight | `review-link` 修正 |
| `stale_patterns` / `stale_lessons` | warn | 超过 `--days`（默认 90）未更新 | `prune --days N --apply` / `lesson-retire` |
| `no_evidence_lessons` | warn | active 但无证据 | `lesson-feedback` |
| `near_limit` | warn | 某集合 ≥90% 上限（save 会裁剪） | `prune` / `export` 归档 |
| `unused_state` | info | 经验或事件为空 | 先跑 `bootstrap` / `wrap-up` |
| `global_unreadable` | warn | 全局库解析失败 | 手工修复或删除 |
| `state_shape` | warn | config/rules/reviews 类型不符预期 | 从 `.bak` 恢复 |

`--fix` 流程：备份 `<state>.<ts>.doctor.bak` → 在副本上跑 `enforceLimits` → 逐集合比对身份集合 → 有删除即中止（原文件不动）→ 通过才写。

```json
// doctor --json
{ "ok": true, "counts": { "rules": 6, "lessons": 0, "logs": 1, "reviews": 1 },
  "issues": [ { "level": "warn", "code": "config_drift", "message": "config 缺 1 个键：config.lifecycle.globalMinConfidence", "fix": "doctor --fix" } ],
  "days": 90, "statePath": "...", "fix": null }

// bootstrap --json
{ "recall": { "query": "...", "fallback": false, "lessons": [], "rules": [], "minConfidence": 0.5 },
  "issues": [ ... ], "lastReview": { "id": "REV-...", "task": "...", "improvements": ["..."] } }
```

### 规则追踪

| 命令 | 说明 |
|---|---|
| `add-rule <id> <desc> <source>` | 添加声明式规则（如来自 AGENTS.md） |
| `check <id>` | 记录一次遵守 |
| `violation <id> <context>` | 记录一次违反 |
| `stats` | 规则成功率与权重 |

权重算法保持 v2：`weight = executions / (executions + violations) * 0.95`，无记录时为 1。

### 原子经验（核心）

| 命令 | 说明 |
|---|---|
| `lesson-add <id> <trigger> <action> [domain] [confidence]` | 新增经验。可选 `--domain`、`--confidence`、`--evidence` |
| `lesson-feedback <id> <helpful\|harmful> [note]` | 反馈：`+0.08` / `-0.20`，写入证据 |
| `lesson-promote <id> [--global] [--force]` | 提升为 active（可复活 retired）；`--global` 写入跨项目经验库 |
| `lesson-retire <id> [reason] [--global]` | 手工退役（可指定全局库） |
| `lesson-edit <id> <trigger\|action\|domain> <value>` | 修改字段 |
| `lesson-list [--status active\|pending\|retired] [--domain d] [--min-confidence 0] [--limit 50] [--global]` | 列表 + 状态统计 |
| `lesson-show <id>` | 详情（含证据） |
| `lesson-merge <keepId> <dropId>` | 合并重复经验，保留较高置信度并合并证据 |

状态机：

```
add(0.5) ──helpful×2──▶ active(0.66)
   │                      │
   │                   harmful×2
   ▼                      ▼
retired ◀──(<0.2 且 harmful>=2)── pending/active
   └──── lesson-promote ────▶ active
```

### 全局经验（跨项目）

| 操作 | 说明 |
|---|---|
| `lesson-promote <id> --global` | 要求 `confidence >= 0.8`；`--force` 可绕过（不推荐） |
| `lesson-list --global` | 查看全局库 |
| `lesson-retire <id> --global` | 退役全局经验 |
| `recall` | 自动合并全局经验，项目同名 ID 覆盖全局，全局项标 `[G]` |

- 全局库默认 `~/.local/share/agent-evolution/global.json`，用 `AGENT_EVOLUTION_GLOBAL_STATE` 覆盖。
- 只复制 `trigger / action / domain / confidence`，不复制 evidence note，避免项目细节外泄。
- 不做自动 promote：是否值得全局复用由人判断。

### 召回

| 命令 | 说明 |
|---|---|
| `recall` | 无查询：按置信度 + 新近度返回经验与规则 |
| `recall "任务描述"` | 按文本相关度排序，过滤无关项 |
| `--limit N` | 经验条数，默认 8 |
| `--threshold X` | 经验置信度下限，默认 0.5 |
| `--domain d` | 只看某领域 |
| `--no-rules` | 不返回规则 |
| `--touch` | 记录本次召回（更新 `last_used`，影响衰减） |
| `--json` | 输出结构化结果而非 markdown |

默认 markdown 形如：

```markdown
<!-- agent-evolution recall | query="修改登录" | 2 lessons / 1 rules -->
## 规则（必须遵守）
- [no-guess] 禁止猜测，先读代码 (w=1.00)
## 已学经验
- [L-001] 当 修改共享代码前 → 先 grep 调用方 (c=0.90, e=1)
```

无字面匹配时会回退到置信度排序，并在输出末尾标注「未找到字面相关内容」。

### 历史检索

| 命令 | 说明 |
|---|---|
| `search "<query>"` | 跨错误档案、洞察、经验、规则、复盘做统一检索 |
| `--kind all\|errors\|insights\|lessons\|reviews\|rules` | 限定范围，默认全部（retired 经验自动排除） |
| `--limit N` | 返回条数，默认 10 |
| `--min-score X` | 最终得分下限，默认 0.15 |
| `--json` | 结构化输出 |

排序：`kind_weight * (0.75 * 相关度 + 0.15 * 质量 + 0.10 * 90天衰减)`。
复盘权重 0.75，避免历史复盘刷屏；错误档案、经验权重 1.0。
输出按「错误档案 → 洞察 → 经验 → 复盘 → 规则」分组。

### 复盘

| 命令 | 说明 |
|---|---|
| `review-task <task> <completion 0-100> <highlights> <improvements>` | 数组可用 JSON 或逗号分隔 |
| `review-list [limit]` | 最近复盘 |
| `review-detail <id\|index>` | 稳定 ID 或数组下标（0 起） |
| `review-link <id\|index> <error\|insight> <refId>` | 关联错误/洞察 |
| `review-learning <id\|index> <learning>` | 追加学习点 |

### 错误与洞察

| 命令 | 说明 |
|---|---|
| `error-add <id> <title> <root_cause> <solution> <prevention>` | 新增错误档案，返回相近档案 `similar` |
| `error-update <id> <field> <value>` | 字段：`title/root_cause/solution/prevention` |
| `error-list` | 全部错误 |
| `error-analyze <id>` | 用 bigram 余弦找相关错误并写回 `related` |
| `insight-add <id> <problem> <pattern> <solution>` | 新增举一反三，返回相近洞察 |
| `insight-update <id> <field> <value>` | 字段：`problem/pattern/solution` |
| `insight-list` | 全部洞察 |
| `insight-migrate <id> <application>` | 添加可应用场景 |
| `insight-similar <id> <problem>` | 添加相似问题 |

### 维护

| 命令 | 说明 |
|---|---|
| `dedupe [--kind all\|lessons\|errors\|insights\|rules] [--threshold 0.55]` | 只报告重复簇，不删除 |
| `prune [--days 90] [--pending-days 30] [--apply] [--global]` | 默认 dry-run；清理过期 retired / 低置信 pending / 陈旧 pattern；`--global` 作用于全局库 |
| `rule-remove <id> [reason] [--apply]` | 默认 dry-run；`--apply` 删除并写 `rule-remove` 事件，返回 `undo` 命令 |
| `init-rules [--agents f] [--soul f] [--extra f] [--dry-run]` | 从 AGENTS/SOUL 等文件抽取规则；按「精确键 + 归一包含」去重；`--dry-run` 不写盘且返回 `hint`（删除后重跑可能以新 id 复活）；0 新增也不写盘 |
| `log <action_type> <detail>` | 行为日志（默认脱敏，保留最近 1000 条） |
| `detect` | 重复行为 + 角色偏离检测 |
| `reset <pattern_id>` | 清除某个 pattern |
| `heartbeat` | 轻量告警检查 |
| `identity` / `identity-update <role\|traits> <value>` / `evolve <change> <trigger>` | 身份与进化事件 |

### 迁移与结晶

| 命令 | 说明 |
|---|---|
| `export [--format json\|md] [--kind all\|lessons\|rules\|errors\|insights] [--out path] [--no-redact]` | 无 `--out` 时输出到 stdout |
| `import <bundle.json> [--dry-run] [--cap 0.6] [--no-cap]` | 冲突 ID 跳过并报告；新经验置信度默认封顶 0.6 |
| `crystallize [--domain d] [--min-confidence 0.8] [--write] [--name slug]` | 高置信经验 → SKILL.md 草稿；`--write` 写入 `<state目录>/evolved/<name>/SKILL.md` |

## 数据模型

```json
{
  "version": "3.0",
  "rules": {
    "<id>": {
      "description": "", "source": "", "weight": 1,
      "executions": 0, "violations": 0,
      "createdAt": "", "lastChecked": "", "lastViolation": {}
    }
  },
  "lessons": {
    "<id>": {
      "trigger": "修改共享代码前",
      "action": "先 grep 调用方",
      "domain": "workflow",
      "confidence": 0.7,
      "status": "active",
      "scope": "project",
      "evidence": [{ "type": "helpful", "note": "", "at": "" }],
      "helpful": 0, "harmful": 0,
      "created_at": "", "updated_at": "", "last_used": null
    }
  },
  "identity": { "role": "", "traits": [], "version": 1, "history": [], "updatedAt": "" },
  "patterns": { "<id>": { "type": "repeat|drift", "count": 0, "last_seen": "", "details": {} } },
  "logs": [{ "timestamp": "", "action_type": "", "detail": "", "session_id": "" }],
  "events": [{ "timestamp": "", "op": "", "target": "", "summary": "" }],
  "errors": {
    "<id>": { "title": "", "root_cause": "", "solution": "", "prevention": "", "related": [], "created_at": "", "updated_at": "" }
  },
  "insights": {
    "<id>": { "problem": "", "pattern": "", "similar": [], "solution": "", "applications": [], "created_at": "", "updated_at": "" }
  },
  "assessments": { "updated_at": "" },
  "reviews": [{ "id": "REV-<ts>", "task": "", "completion": 0, "highlights": [], "improvements": [], "learnings": [], "error_ids": [], "insight_ids": [], "created_at": "" }],
  "config": {
    "thresholds": { "repeatCount": 5, "repeatWindowMinutes": 10, "driftMatchScore": 0.3 },
    "limits": { "maxLogs": 1000, "maxErrors": 500, "maxInsights": 500, "maxReviews": 200, "maxLessons": 500, "maxEvents": 1000 },
    "recall": { "defaultLimit": 8, "minConfidence": 0.5, "rulesLimit": 5 },
    "lifecycle": { "activateConfidence": 0.6, "retireConfidence": 0.2, "maxConfidence": 0.95, "halfLifeDays": 30, "maxEvidence": 20 },
    "privacy": { "redactLogs": true }
  }
}
```

## 错误码

| 代码 | 说明 |
|---|---|
| `UNKNOWN_COMMAND` | 未知命令 |
| `EXECUTION_ERROR` | 参数错误、资源不存在、文件不可读等 |

## 示例

```bash
node evolution.js init
node evolution.js recall "重构支付模块"
node evolution.js search "token 过期"
node evolution.js lesson-add L-001 "改公共函数前" "先查所有调用方" --domain refactor --confidence 0.7
node evolution.js lesson-feedback L-001 helpful
node evolution.js dedupe --kind lessons
node evolution.js lesson-merge L-001 L-004
node evolution.js export --format md --out docs/playbook.md
node evolution.js crystallize --min-confidence 0.85
node evolution.js prune --days 120          # 先看候选
node evolution.js prune --days 120 --apply  # 再删除
```

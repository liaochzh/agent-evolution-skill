# 接力棒：agent-evolution

> 全局 skill：仓库 `~/Projects/agent-evolution-skill`，`~/.config/opencode/skills/agent-evolution` 为目录级软链。各会话只读写本文件。

## 仓库与安装

- 仓库：`~/Projects/agent-evolution-skill`，远端 `https://github.com/liaochzh/agent-evolution-skill`（public，main）。
- 安装方式：**目录级软链** `~/.config/opencode/skills/agent-evolution -> ~/Projects/agent-evolution-skill`（与其他 skill 一致）。
- `docs/`（plan / review / baton）留在仓库根目录内，但被 `.gitignore` 排除：含本机路径与门禁内部细节，不发布。
- 运行时 state 落在 `.opencode/agent-evolution/state.json`（已 gitignore）；`node_modules/` 亦不入库。
- 迁移时旧目录整体备份在 `~/.config/opencode/.backups/20261028-agent-evolution-migration/agent-evolution`（含迁移前 state 快照，确认无碍后可删）。

## 结构

- `scripts/evolution.js`：CLI 入口，遍历 `register(registry, storage)` 注册所有命令，按 `registry[command]` 分发。
- `scripts/shared.js`：分词/相似度/parseArgs/recordEvent/raw/id 生成。
- `scripts/storage.js`：状态模型、迁移、limits、项目/全局路径。
- 核心模块：`lesson` / `recall` / `search` / `dedupe` / `portability` / `crystallize` / `review`。
- 闭环模块：`doctor`（体检 + `--fix`）/ `bootstrap`（只读入口）/ `wrapup`（单事务出口）。
- 文档：`SKILL.md`、`references/cli.md`、`references/design.md`；方案与审查在 `docs/plan`、`docs/review`。

## 关键约束（踩过坑）

1. **`Storage.load()` 有副作用**：内存 `migrate` 会补 config/version（抹平漂移），版本不符还写 `.bak`。诊断/只读命令必须用 `readRaw` + `migrate`。
2. **`Storage.save()` 会跑 `enforceLimits`**：超限静默裁剪。带删除语义的 `--fix`/`--apply` 必须先备份、克隆预演、按身份集合比对。
3. **`parseArgs` 语义**：`--no-x` 映射为 `flags.x === false`（不会出现 `'no-x'` 键）；`--x` 后跟非 `--` 字符串会被当成值，布尔判定统一 `flags.x === true`。
4. **`init-rules` 同源双抽**：标题分支与列表分支会各抽一次同一行，去重需「精确键 ∪ 归一包含（长度比 ≥0.6）」。
5. **lesson 字段**：新增经验一律走 `buildLesson`，缺 `helpful/harmful/scope` 会让 feedback 产出 NaN。

## 已完成

- v3.0：原子经验、置信度生命周期、recall、dedupe、export/import、crystallize、prune、events、CJK 相似度、3.0 迁移备份、init 幂等。
- 统一检索 `search`（跨 errors/insights/lessons/reviews/rules）。
- 全局经验 `lesson-promote --global`、`recall` 合并 `[G]`、`lesson-list/retire/prune --global`。
- 闭环：`doctor`（12 类检查、`--fix` 预演）、`bootstrap`（只读）、`wrap-up`（单事务）、`rule-remove`、`init-rules --dry-run` + 双键去重。
- 测试：21 个测试文件 / 162 用例全绿；`node --check` 全通过。

## 真实 state 现状（`.opencode/agent-evolution/state.json`）

- `rules=1 patterns=0 errors=1 insights=1 lessons=13 logs=1 events=25 reviews=5`
- `doctor --days 30` → 1 条 warn：6 条 active 经验缺证据（`no_evidence_lessons`），其余 0 问题。
- 已做：`--fix` 补 `config.lifecycle.globalMinConfidence`（备份 `state.json.*.doctor.bak`）；删 `rule-1`，再删 `rule-0/2/3/4`（陈旧且与 AGENTS.md 重复，曾把 `no-guess` 挤到末位）；清 `drift-edit-test`。
- 迁移时 state 已随仓库走（软链前后是同一物理文件，未丢数据）。

## 未完成 / 待授权

- `doctor --global`：**明确暂不做**——全局库 `~/.local/share/agent-evolution/` 尚不存在，0 条数据；等 `lesson-promote --global` 真实用过再考虑。
- `rule-*` 的 `source`：不再改指向（4 条已删，「改 source」无意义）。
- 并发写无锁（load-modify-save，方案明示保留）。
- `init-rules` 归一包含去重有理论误杀窗口（已用 `duplicates.reason` 留痕）。

## 下一步建议

AGENTS.md 已加 2 行记忆闭环入口（`bootstrap` / `wrap-up` / `lesson-add` / `search`）。下一步是在真实任务里跑起来，并用 `lesson-feedback` 产生真实置信度；skill 内不再加功能，等使用数据暴露问题。

**提交约定**：改完 `npm test` 全绿 → `git add -A && git commit && git push`（远端 `origin/main`）。`docs/` 与 `.opencode/` 已被 gitignore，`git add -A` 不会带上。

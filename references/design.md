# 设计说明（v3.0）

## 为什么升级

v2.0 解决了「有没有记录」，没解决「记了会不会用」：

- `report` 是整包 JSON，几百条规则无法直接放进上下文；
- 规则只有 weight，没有置信度和证据，错的教训和验证过的教训一样重；
- 中文内容按空格分词，`error-analyze` 实际只能匹配整句；
- `init` 会覆盖已有 state，`init.sh` 一跑就清空历史数据；
- 记忆只进不出，没有去重、衰减、迁移和结晶。

v3.0 的目标是让记忆**能被召回、能被证伪、能被淘汰、能带走**。

## 参考的开源实现

| 项目 | 关键做法 | 本 skill 的取舍 |
|---|---|---|
| [ECC `continuous-learning-v2`](https://github.com/affaan-m/ECC/blob/main/skills/continuous-learning-v2/SKILL.md) | 原子 instinct（一个 trigger + 一个 action）、confidence 0.3–0.9、evidence、project/global 作用域、阈值注入、promote/export/import | 采用原子经验、置信度、证据、状态机、阈值召回、导入封顶；**不采用** hook 自动观察（opencode 无对应 hook 契约，且容易把噪声写进记忆） |
| [EvoMap `evolver`](https://github.com/EvoMap/evolver)（GEP） | 每次进化产出可审计 Event；只生成 prompt 不直接改代码；本地资产升级不覆盖；review 模式 | 采用 `events` 追加审计、`crystallize` 只出草稿、`init` 幂等、迁移前备份 |
| [GenericAgent](https://github.com/lsdefine/GenericAgent) | 「探索 → 结晶为技能 → 下次直接召回」 | 采用 `crystallize`：高置信经验生成 SKILL.md 草稿 |
| [Anthropic skills](https://github.com/anthropics/skills) | description 写触发条件、主文件精简、细节放 `references/` | SKILL.md 只留工作流，命令与模型移入 `references/` |

论文层面的同名思想（Reflexion 的语言化反思、Voyager 的技能库、ACE 的 playbook delta）都指向同一件事：
**把一次性的上下文教训转成可检索、可更新的外部状态**。v3.0 是这个思路的轻量落地。

## 关键决策

### 1. 经验用「原子」而不是「长文」

`lesson = trigger + action`，一条只表达一个可执行判断。长复盘放 `review-task`，可迁移的模式放 `insight`。
这样 `recall` 才能按条排序、按条反馈、按条淘汰。

### 2. 置信度只由证据驱动

| 事件 | 变化 |
|---|---|
| 新建 | `0.50`（pending） |
| `helpful` | `+0.08` |
| `harmful` | `-0.20` |
| 上限 | `0.95` |
| 激活 | `>= 0.60` |
| 自动退役 | `< 0.20` 且 `harmful >= 2` |

纠错比确认更强（-0.20 > +0.08），符合「一次事故抵消多次侥幸」的经验。
`lesson-promote` 是人工兜底，防止误退役。

### 3. 召回分数

```
lesson.score = 0.6 * relevance + 0.3 * confidence + 0.1 * recency   // 有 query
             = 0.7 * confidence + 0.3 * recency                      // 无 query
rule.score   = 0.45 * weight + 0.55 * relevance
recency      = 0.5 ^ (days_since_last_use / 30)
relevance    = cosine(tokenize(query), tokenize(trigger + action + domain))
```

`tokenize` 对中文取 bigram、对 ASCII 取词，解决无空格语言的相关度问题。
有 query 时过滤 `relevance <= 0.02` 的规则，避免把整份规则表塞进上下文；
全部无匹配时回退到置信度排序，并显式提示「自行判断是否适用」。

### 4. 去重只报告，删除要显式

`dedupe` 用并查集把相似度 ≥ 阈值的条目聚成簇，给出 `suggested_keep`。
真正的删除只发生在 `lesson-merge <keep> <drop>`，且会合并证据与计数。
不做自动清理，因为「看起来像重复」和「语义上等价」不是一回事。

### 5. 迁移默认防污染

`import` 把新经验置信度封顶 `0.6`，并强制 `scope=project`、重置 helpful/harmful。
别的项目的强经验到本项目最多算「待验证」，需要本地反馈才能升到 active。

全局库同理：`lesson-promote --global` 要求本地 `confidence >= 0.8`，
且只复制 `trigger / action / domain / confidence`，不复制 evidence note。
是否值得全局复用是人的判断，不做自动 promote。

### 6. 只建议，不自动改代码

`crystallize` 默认打印草稿；`--write` 写到 `evolved/<name>/SKILL.md`，仍需人工审核后才会被 skill 加载。
`prune` 默认 dry-run。这与 EvoMap「prompt generator, not code patcher」一致。

### 7. 召回与检索分离

- `recall` 回答「现在该怎么做」：规则 + 高置信经验，短、可直接注入上下文。
- `search` 回答「以前怎么处理的」：错误档案、洞察、经验、复盘、规则统一排序，按需查看。

两者分开，避免每次任务都把历史长文塞进上下文。`search` 的排序是
`kind_weight * (0.75 * relevance + 0.15 * quality + 0.10 * recency)`，
复盘权重 0.75（历史记录可复用性低，防止刷屏），错误/经验权重 1.0；
`lesson.status=retired` 不参与检索。

### 8. 入口/出口/体检三件套

- `bootstrap` 负责「被调用」：一次调用给出召回、体检提醒、上次复盘待改进。它是**只读**的——
  读原始 JSON + 内存归一，不触发迁移与 `.bak`，也不接受 `--touch`。
- `wrap-up` 负责「被记录」：复盘与经验一次写入。先全量校验（id 冲突、置信度越界、引用不存在、坏 JSON），
  任一失败零落盘，避免半条复盘。
- `doctor` 负责「被清理」：只读诊断（`config_drift` / 重复 / 陈旧 / 越界引用 / 接近上限）。
  `--fix` 先备份，再在副本上跑 `enforceLimits` 并逐集合比对；一旦会删条目就中止，原文件不动。

诊断必须读原始 JSON：`Storage.load()` 会在内存补 config/version，漂移会被抹平，
版本不符时还会写 `.bak`，既影响判断也破坏只读语义。

### 9. 规则去重用双键

`init-rules` 的重复判定是「归一后精确相等」∪「短串被长串包含且长度比 ≥ 0.6」。
原因是 markdown 抽取器会对「`## 标题` + 紧随的 `- 名称：描述`」各抽一次：
标题分支产 `标题: - 名称：描述`，列表分支产 `名称: 描述`。只做精确比较拦不住这类同源双抽。
包含关系仍可能误判（长描述里恰好包含短描述），所以只跳过、不删除，且把跳过的项写进 `duplicates`。

## 安全与数据完整性

- 写入：临时文件 + `rename` 原子替换。
- 迁移：检测到旧版本先写 `state.json.v<old>.bak`，且备份文件不覆盖。
- 读取：结构归一化（缺 `lessons`/`events`/`config` 自动补齐），坏 JSON 给出可操作错误。
- 脱敏：`log` 与 `export` 默认替换 token、Bearer、邮箱、`/Users/<name>`；`--no-redact` 可关闭。
- `init` 幂等：已有 state 不覆盖，必须显式 `--force`。
- `doctor --fix`：备份 `<state>.<ts>.doctor.bak`；预演 + 身份集合比对，检测到删除即中止。
- `bootstrap` / `doctor` 的只读路径不写 `.bak`，不新增文件。

## 已知边界

- **没有自动观察**：经验靠调用方在纠错/复盘时主动写入；这是有意的，避免把噪声和隐私写进记忆。
- **单仓库状态 + 显式全局提升**：默认 state 在 git 根目录，项目间天然隔离；跨项目复用需 `lesson-promote --global` 或 `export`/`import`，不做自动 promote。
- **相关度是词面相似**：同义改写可能召回不到；`recall` 的回退与 `--domain` 是兜底，不做向量检索。
- **经验不会自己变强**：`helpful` 需要真实使用后反馈，否则长期停在 pending。

## 从 2.0 升级

- `state.json` 自动迁移，新增 `lessons` / `events` / `config.{recall,lifecycle,privacy}`。
- 原有命令与字段保持不变；`weight` 算法未改。
- 建议升级后先跑一次 `report` 看 `health`，再用 `dedupe` 清一遍历史重复规则。

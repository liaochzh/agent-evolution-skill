const fs = require('fs');
const { TARGET_VERSION, parseArgs, flagNumber, recordEvent, raw } = require('./shared');
const { Storage, createDefaultState } = require('./storage');
const { groupDuplicates, textOf } = require('./dedupe');

const COLLECTIONS = ['rules', 'patterns', 'errors', 'insights', 'lessons', 'logs', 'events', 'reviews'];
const LEVEL_ORDER = { error: 0, warn: 1, info: 2 };

/**
 * 读原始 JSON。诊断与只读入口必须走这里：
 * Storage.load() 会 migrate 补齐 config/version，还会在版本不一致时写 .bak，
 * 既看不出 config 漂移，也破坏「只读」语义。
 */
function readRaw(filePath) {
  try {
    const text = fs.readFileSync(filePath, 'utf8');
    return { exists: true, raw: JSON.parse(text), error: null };
  } catch (e) {
    if (e.code === 'ENOENT') return { exists: false, raw: null, error: null };
    return { exists: true, raw: null, error: e.message };
  }
}

function countOf(value) {
  if (Array.isArray(value)) return value.length;
  if (value && typeof value === 'object') return Object.keys(value).length;
  return 0;
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function countsOf(state) {
  const counts = {};
  for (const name of COLLECTIONS) counts[name] = countOf(state?.[name]);
  return counts;
}

/** 只报缺失与类型不符；用户显式调阈值不算漂移 */
function diffConfig(expected, actual, prefix, out) {
  for (const [key, value] of Object.entries(expected)) {
    const path = prefix ? `${prefix}.${key}` : key;
    const got = actual?.[key];
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      diffConfig(value, got, path, out);
      continue;
    }
    if (got === undefined) {
      out.push({ path, expected: value });
    } else if (typeof got !== typeof value) {
      out.push({ path, expected: value, actual: got });
    }
  }
}

function buildEntries(kind, collection) {
  return Object.entries(collection || {})
    // 与 dedupe 保持同一口径：retired 经验不参与重复检查
    .filter(([, item]) => isPlainObject(item) && !(kind === 'lessons' && item.status === 'retired'))
    .map(([id, item]) => ({
      id,
      text: textOf(kind, item),
      confidence: item.confidence || 0,
      weight: item.weight || 0
    }));
}

function olderThan(value, days, nowMs) {
  const ts = new Date(value || 0).getTime();
  return Number.isFinite(ts) && ts > 0 && (nowMs - ts) > days * 86400000;
}

/**
 * 纯函数诊断：不接 storage、不调 load()，便于测试与只读复用。
 * input = { rawState, stateExists, stateError, global, nowMs, days }
 */
function diagnose({ rawState, stateExists, stateError, global, nowMs = Date.now(), days = 90 } = {}) {
  const issues = [];
  const push = (level, code, message, fix) => issues.push({ level, code, message, fix: fix || null });

  if (!stateExists) {
    push('info', 'state_missing', 'state.json 不存在，先运行 init 建立状态。', 'init');
    return { ok: true, counts: countsOf(null), issues };
  }
  if (stateError) {
    push('error', 'state_corrupt', `state.json 不是合法 JSON（${stateError}），请从 .bak 恢复。`, null);
    return { ok: false, counts: countsOf(null), issues };
  }

  const state = rawState || {};
  const counts = countsOf(state);
  // 类型错乱的 state 也要能出报告，不能把 doctor 自己崩掉
  const config = isPlainObject(state.config) ? state.config : {};
  const rules = isPlainObject(state.rules) ? state.rules : {};
  const patterns = isPlainObject(state.patterns) ? state.patterns : {};
  const errors = isPlainObject(state.errors) ? state.errors : {};
  const insights = isPlainObject(state.insights) ? state.insights : {};
  const lessons = isPlainObject(state.lessons) ? state.lessons : {};
  const reviews = Array.isArray(state.reviews) ? state.reviews : [];
  if (!isPlainObject(state.config) || !Array.isArray(state.reviews) || !isPlainObject(state.rules)) {
    push('warn', 'state_shape', 'state 结构不符合预期（config/rules/reviews 类型错误），建议从 .bak 恢复。', null);
  }

  if (state.version !== TARGET_VERSION) {
    push(
      'warn',
      'schema_version_drift',
      `state 版本 ${state.version || 'unknown'} != ${TARGET_VERSION}，读写时会被归一化。`,
      'doctor --fix'
    );
  }

  const missing = [];
  diffConfig(createDefaultState().config, config, 'config', missing);
  if (missing.length > 0) {
    const paths = missing.map(item => item.path).join(', ');
    push('warn', 'config_drift', `config 缺 ${missing.length} 个键：${paths}`, 'doctor --fix');
  }

  const duplicateKinds = [
    ['rules', 'duplicate_rules'],
    ['lessons', 'duplicate_lessons']
  ];
  for (const [kind, code] of duplicateKinds) {
    const collection = kind === 'rules' ? rules : lessons;
    const clusters = groupDuplicates(buildEntries(kind, collection), 0.55);
    if (clusters.length > 0) {
      const detail = clusters.map(group => group.map(entry => entry.id).join(' / ')).join('；');
      push('warn', code, `${kind} 有 ${clusters.length} 组近似重复：${detail}`, `dedupe --kind ${kind}`);
    }
  }

  const orphanErrors = [];
  const orphanInsights = [];
  for (const review of reviews.filter(isPlainObject)) {
    for (const id of review.error_ids || []) {
      if (!errors[id]) orphanErrors.push(`${review.id}→${id}`);
    }
    for (const id of review.insight_ids || []) {
      if (!insights[id]) orphanInsights.push(`${review.id}→${id}`);
    }
  }
  if (orphanErrors.length > 0 || orphanInsights.length > 0) {
    const parts = [];
    if (orphanErrors.length) parts.push(`error_ids: ${orphanErrors.join(', ')}`);
    if (orphanInsights.length) parts.push(`insight_ids: ${orphanInsights.join(', ')}`);
    push('warn', 'orphan_refs', `复盘引用了不存在的条目（${parts.join('；')}）`, 'review-link 修正或补建档案');
  }

  const stalePatterns = Object.entries(patterns)
    .filter(([, pattern]) => isPlainObject(pattern) && olderThan(pattern.last_seen, days, nowMs))
    .map(([id]) => id);
  if (stalePatterns.length > 0) {
    push(
      'warn',
      'stale_patterns',
      `${stalePatterns.length} 个 pattern 超过 ${days} 天未更新：${stalePatterns.join(', ')}`,
      `prune --days ${days} --apply`
    );
  }

  const staleLessons = Object.entries(lessons)
    .filter(([, lesson]) => isPlainObject(lesson) && lesson.status === 'active')
    .filter(([, lesson]) => olderThan(lesson.last_used || lesson.updated_at || lesson.created_at, days, nowMs))
    .map(([id]) => id);
  if (staleLessons.length > 0) {
    push(
      'warn',
      'stale_lessons',
      `${staleLessons.length} 条 active 经验超过 ${days} 天未使用：${staleLessons.join(', ')}`,
      'lesson-retire 或 lesson-feedback 复核'
    );
  }

  const noEvidence = Object.entries(lessons)
    .filter(([, lesson]) => isPlainObject(lesson) && lesson.status === 'active' && (lesson.evidence || []).length === 0)
    .map(([id]) => id);
  if (noEvidence.length > 0) {
    push('warn', 'no_evidence_lessons', `${noEvidence.length} 条 active 经验没有证据：${noEvidence.join(', ')}`, 'lesson-feedback 补证据');
  }

  const limits = isPlainObject(config.limits) ? config.limits : {};
  const limitMap = {
    logs: limits.maxLogs,
    errors: limits.maxErrors,
    insights: limits.maxInsights,
    lessons: limits.maxLessons,
    reviews: limits.maxReviews,
    events: limits.maxEvents
  };
  const near = [];
  for (const [name, max] of Object.entries(limitMap)) {
    if (!max) continue;
    const used = counts[name] || 0;
    if (used >= max * 0.9) near.push(`${name} ${used}/${max}`);
  }
  if (near.length > 0) {
    push('warn', 'near_limit', `接近上限，save 时会裁掉最老条目：${near.join(', ')}`, 'prune / export 归档');
  }

  if (counts.lessons === 0 || counts.events === 0) {
    push('info', 'unused_state', '闭环尚未启用（经验或事件为空），先跑 bootstrap / wrap-up。', null);
  }

  if (global && global.error) {
    push('warn', 'global_unreadable', `全局经验库无法解析（${global.error}），recall 会忽略它。`, null);
  }

  issues.sort((a, b) => (LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level]) || a.code.localeCompare(b.code));
  const ok = !issues.some(issue => issue.level === 'error');
  return { ok, counts, issues };
}

/** 集合身份集合：用于判断 enforceLimits 是否删了数据 */
function identitySet(name, value) {
  if (Array.isArray(value)) {
    return value.map(item => {
      if (name === 'logs') return `${item?.timestamp}|${item?.action_type}|${item?.detail}`;
      if (name === 'events') return `${item?.timestamp}|${item?.op}|${item?.target ?? ''}`;
      if (name === 'reviews') return item?.id || `${item?.task}|${item?.created_at}`;
      return JSON.stringify(item);
    });
  }
  return Object.keys(value || {});
}

function removals(beforeState, afterState) {
  const removed = {};
  for (const name of COLLECTIONS) {
    const after = identitySet(name, afterState?.[name]);
    const bag = new Map();
    for (const key of after) bag.set(key, (bag.get(key) || 0) + 1);
    let lost = 0;
    for (const key of identitySet(name, beforeState?.[name])) {
      const count = bag.get(key) || 0;
      if (count > 0) bag.set(key, count - 1);
      else lost++;
    }
    if (lost > 0) removed[name] = lost;
  }
  return removed;
}

/**
 * --fix：备份 → 克隆预演 → 比对是否删数据 → 通过才落盘。
 * 语义是「按 migrate 归一（补 config/version/字段默认值）」，不主动删条目。
 */
function applyFix(storage, read) {
  if (!read.exists) {
    storage.save(storage.defaultState());
    return { success: true, created: true, backupPath: null, fixed: [], removed: {} };
  }
  if (read.error) {
    throw new Error(`State file is not valid JSON: ${storage.filePath}. Fix or restore from a .bak file.`);
  }

  const backupPath = `${storage.filePath}.${Date.now()}.doctor.bak`;
  fs.copyFileSync(storage.filePath, backupPath);

  const before = JSON.parse(JSON.stringify(read.raw));
  const snapshot = structuredClone(storage.load());
  recordEvent(snapshot, 'doctor-fix', null, `backup=${backupPath}`);
  storage.enforceLimits(snapshot);

  const removed = removals(before, snapshot);
  if (Object.keys(removed).length > 0) {
    const detail = Object.entries(removed).map(([name, count]) => `${name}: -${count}`).join(', ');
    throw new Error(
      `doctor --fix 会删除数据（${detail}），已中止；原文件未修改，备份在 ${backupPath}。先 prune / export 再试。`
    );
  }

  storage.save(snapshot);
  const fixed = [];
  if (before.version !== snapshot.version) fixed.push(`version → ${snapshot.version}`);
  const missing = [];
  diffConfig(createDefaultState().config, before.config || {}, 'config', missing);
  for (const item of missing) fixed.push(item.path);

  return {
    success: true,
    created: false,
    backupPath,
    fixed,
    removed: {},
    counts: { before: countsOf(before), after: countsOf(snapshot) }
  };
}

function renderMarkdown(result, statePath, fixInfo) {
  const lines = [];
  lines.push(`<!-- agent-evolution doctor | ${result.issues.length} issues | ok=${result.ok} -->`);
  lines.push(`state: ${statePath}`);
  lines.push(`counts: ${Object.entries(result.counts).map(([k, v]) => `${k}=${v}`).join(' ')}`);

  if (fixInfo) {
    const detail = fixInfo.created
      ? '已创建默认 state'
      : `已按 migrate 语义归一${fixInfo.fixed.length ? `（${fixInfo.fixed.join(', ')}）` : '（无显式漂移，仅重写）'}，备份 ${fixInfo.backupPath}`;
    lines.push(`fix: ${detail}`);
  }

  if (result.issues.length === 0) {
    lines.push('健康：未发现问题。');
    return lines.join('\n');
  }

  lines.push('## 问题');
  for (const issue of result.issues) {
    const fix = issue.fix ? `（修复：${issue.fix}）` : '';
    lines.push(`- [${issue.level}] ${issue.code}: ${issue.message}${fix}`);
  }
  return lines.join('\n');
}

function register(registry, storage) {
  registry['doctor'] = (...args) => {
    const { flags } = parseArgs(args);
    const days = flagNumber(flags.days, 90);
    const read = readRaw(storage.filePath);
    const globalRead = readRaw(Storage.getGlobalStatePath());

    const fixInfo = flags.fix === true ? applyFix(storage, read) : null;
    const effective = fixInfo ? readRaw(storage.filePath) : read;
    const result = diagnose({
      rawState: effective.raw,
      stateExists: effective.exists,
      stateError: effective.error,
      global: globalRead,
      nowMs: Date.now(),
      days
    });

    if (flags.json === true) {
      return { ...result, days, statePath: storage.filePath, fix: fixInfo };
    }
    return raw(renderMarkdown(result, storage.filePath, fixInfo));
  };
}

module.exports = { register, diagnose, readRaw, applyFix, countsOf, COLLECTIONS };

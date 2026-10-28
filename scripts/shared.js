const TARGET_VERSION = '3.0';

const DIMENSIONS = {
  technical: ['code_quality', 'architecture', 'performance', 'error_prevention'],
  learning: ['new_skills', 'knowledge_transfer', 'problem_solving', 'error_learning', 'analogy'],
  project: ['requirement', 'delivery', 'time_mgmt', 'risk_control'],
  communication: ['expression', 'confirmation', 'suggestion_quality', 'error_comm']
};

const VALID_DIMENSIONS = Object.keys(DIMENSIONS);

function nowIso() {
  return new Date().toISOString();
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

/**
 * 分词：ASCII 词 + CJK bigram。
 * 中文没有空格，按空格切词会让相似度永远为 0，这里统一处理。
 */
function tokenize(text) {
  const tokens = new Set();
  const s = String(text || '').toLowerCase();
  for (const m of s.matchAll(/[a-z0-9_][a-z0-9_./-]{1,}/g)) {
    tokens.add(m[0]);
  }
  for (const run of s.match(/[\u3400-\u9fff]+/g) || []) {
    if (run.length === 1) {
      tokens.add(run);
      continue;
    }
    for (let i = 0; i < run.length - 1; i++) {
      tokens.add(run.slice(i, i + 2));
    }
  }
  return tokens;
}

/** 集合余弦相似度，0..1，对「短查询 vs 长文本」比 Jaccard 更宽容 */
function similarity(a, b) {
  const left = tokenize(a);
  const right = tokenize(b);
  if (left.size === 0 || right.size === 0) return 0;
  let intersection = 0;
  for (const token of left) {
    if (right.has(token)) intersection++;
  }
  return intersection / Math.sqrt(left.size * right.size);
}

/** 共享 token 数，用于避免短中文串因一个共同 bigram 被误判为相关 */
function sharedTokenCount(a, b) {
  const right = tokenize(b);
  let shared = 0;
  for (const token of tokenize(a)) {
    if (right.has(token)) shared++;
  }
  return shared;
}

const REDACT_RULES = [
  [/\b(sk-[A-Za-z0-9_-]{10,})\b/g, '[REDACTED:key]'],
  [/\b(gh[pousr]_[A-Za-z0-9]{16,})\b/g, '[REDACTED:token]'],
  [/\bAKIA[0-9A-Z]{16}\b/g, '[REDACTED:aws-key]'],
  [/\b(Bearer\s+)[A-Za-z0-9._-]{12,}/gi, '$1[REDACTED]'],
  [/((?:api[_-]?key|access[_-]?token|token|password|passwd|secret)\s*[:=]\s*)["']?[^\s"',]{6,}/gi, '$1[REDACTED]'],
  [/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, '[REDACTED:email]'],
  [/(\/(?:Users|home)\/)[^/\s]+/g, '$1[user]']
];

/** 脱敏：日志与导出默认经过此函数 */
function redact(text) {
  let out = String(text || '');
  for (const [pattern, replacement] of REDACT_RULES) {
    out = out.replace(pattern, replacement);
  }
  return out;
}

/**
 * 极简 flag 解析：`--limit 5` / `--limit=5` / `--no-rules` / `--dry-run`
 * 返回 { positional, flags }，布尔 flag 为 true/false。
 */
function parseArgs(argv) {
  const list = Array.isArray(argv) ? argv : [argv];
  const positional = [];
  const flags = {};

  for (let i = 0; i < list.length; i++) {
    const arg = list[i];
    if (typeof arg !== 'string' || !arg.startsWith('--')) {
      if (arg !== undefined && arg !== null && arg !== '') positional.push(arg);
      continue;
    }

    let key = arg.slice(2);
    let value = true;
    const eq = key.indexOf('=');
    if (eq !== -1) {
      value = key.slice(eq + 1);
      key = key.slice(0, eq);
    } else if (i + 1 < list.length && (typeof list[i + 1] !== 'string' || !list[i + 1].startsWith('--'))) {
      value = list[++i];
    }

    if (key.startsWith('no-')) {
      flags[key.slice(3)] = false;
    } else {
      flags[key] = value;
    }
  }

  return { positional, flags };
}

function flagNumber(value, fallback) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

/** 追加式审计事件，调用方负责后续 storage.save */
function recordEvent(state, op, target, summary) {
  if (!Array.isArray(state.events)) state.events = [];
  state.events.push({
    timestamp: nowIso(),
    op,
    target: target || null,
    summary: summary ? String(summary).slice(0, 200) : ''
  });
  return state;
}

/** 时间衰减：半衰期默认 30 天 */
function recencyScore(timestamp, halfLifeDays = 30) {
  const ts = new Date(timestamp || 0).getTime();
  if (!Number.isFinite(ts) || ts <= 0) return 0.5;
  const days = Math.max(0, (Date.now() - ts) / 86400000);
  return Math.pow(0.5, days / Math.max(1, halfLifeDays));
}

/** 标记「原样输出」的返回值，供 evolution.js 区分 JSON 与 markdown */
function raw(text) {
  return { __raw: String(text) };
}

/** 复盘 id；review-task 与 wrap-up 共用 */
function genReviewId() {
  return `REV-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

/** 经验 id；wrap-up 未显式给 id 时自动生成 */
function genLessonId() {
  return `L-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

/**
 * 宽容解析数组参数：JSON 数组 / 逗号分隔 / 单值包装。
 * 注意：wrap-up 的 --lessons 不走这里，坏 JSON 必须显式报错。
 */
function parseArrayParam(param) {
  if (param === undefined || param === null || param === '') return [];
  try {
    const parsed = JSON.parse(param);
    if (Array.isArray(parsed)) return parsed;
    return [String(parsed)];
  } catch {}
  return String(param).split(',').map(s => s.trim()).filter(Boolean);
}

function calculateAssessments(assessments) {
  const result = {};
  for (const dim of VALID_DIMENSIONS) {
    const subScores = DIMENSIONS[dim].map(sub => assessments[sub] || 0);
    const avg = subScores.length > 0
      ? Math.round(subScores.reduce((a, b) => a + b, 0) / subScores.length * 10) / 10
      : 0;
    result[dim] = {
      score: avg,
      details: DIMENSIONS[dim].reduce((acc, sub) => {
        acc[sub] = assessments[sub] || 0;
        return acc;
      }, {})
    };
  }
  result.updated_at = assessments.updated_at || '';
  return result;
}

function detectRepeats(state) {
  const config = state.config?.thresholds || { repeatCount: 5, repeatWindowMinutes: 10 };
  const windowMs = config.repeatWindowMinutes * 60 * 1000;
  const now = Date.now();
  const recentLogs = (state.logs || []).filter(l => now - new Date(l.timestamp).getTime() < windowMs);
  const alerts = [];

  const actionCounts = {};
  for (const log of recentLogs) {
    const detail = String(log.detail || '');
    const key = `${log.action_type}:${detail.substring(0, 50)}`;
    actionCounts[key] = (actionCounts[key] || 0) + 1;
  }
  for (const [key, count] of Object.entries(actionCounts)) {
    if (count >= config.repeatCount) {
      const [actionType, detail] = key.split(':');
      const patternId = `repeat-${actionType}-${detail.substring(0, 20).replace(/\s+/g, '-')}`;
      alerts.push({ type: 'repeat', count, key, patternId, severity: count >= config.repeatCount * 2 ? 'high' : 'medium' });
    }
  }

  return { alerts, recentLogs };
}

module.exports = {
  TARGET_VERSION,
  DIMENSIONS,
  VALID_DIMENSIONS,
  nowIso,
  clamp,
  tokenize,
  similarity,
  sharedTokenCount,
  redact,
  parseArgs,
  flagNumber,
  recordEvent,
  recencyScore,
  raw,
  genReviewId,
  genLessonId,
  parseArrayParam,
  calculateAssessments,
  detectRepeats
};

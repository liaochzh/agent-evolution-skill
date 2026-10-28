const { Storage } = require('./storage');
const {
  parseArgs,
  flagNumber,
  similarity,
  recencyScore,
  raw,
  nowIso
} = require('./shared');

function round(value) {
  return Math.round(value * 1000) / 1000;
}

/**
 * 纯计算：给定 state / 全局库 / 参数，返回召回结果。
 * 拆出来是让 bootstrap 能只读召回（不经过 Storage.load 的 migrate/.bak 副作用）。
 */
function computeRecall(state, globalState, { query = '', flags = {} } = {}) {
  const recallCfg = state.config.recall;
  const lifeCfg = state.config.lifecycle;
  const limit = Math.max(1, Math.floor(flagNumber(flags.limit, recallCfg.defaultLimit)));
  const rulesLimit = Math.max(0, Math.floor(flagNumber(flags['rules-limit'], recallCfg.rulesLimit)));
  const minConfidence = flagNumber(flags.threshold, recallCfg.minConfidence);
  const domain = flags.domain || null;
  const includeRules = flags.rules !== false;

  const lessons = [];

  function collectLessons(collection, defaultScope, skipIds) {
    for (const [id, lesson] of Object.entries(collection || {})) {
      if (skipIds && skipIds.has(id)) continue;
      if (lesson.status !== 'active') continue;
      if (lesson.confidence < minConfidence) continue;
      if (domain && lesson.domain !== domain) continue;

      const text = `${lesson.trigger} ${lesson.action} ${lesson.domain || ''}`;
      const relevance = query ? similarity(query, text) : 1;
      const recency = recencyScore(
        lesson.last_used || lesson.updated_at || lesson.created_at,
        lifeCfg.halfLifeDays
      );
      const score = query
        ? 0.6 * relevance + 0.3 * lesson.confidence + 0.1 * recency
        : 0.7 * lesson.confidence + 0.3 * recency;

      lessons.push({
        kind: 'lesson',
        id,
        scope: lesson.scope || defaultScope,
        trigger: lesson.trigger,
        action: lesson.action,
        domain: lesson.domain,
        confidence: lesson.confidence,
        relevance: round(relevance),
        score: round(score),
        evidence_count: (lesson.evidence || []).length
      });
    }
  }

  collectLessons(state.lessons, 'project');

  // 项目经验优先；同名 id 不重复注入
  if (globalState && globalState.lessons) {
    collectLessons(globalState.lessons, 'global', new Set(Object.keys(state.lessons)));
  }

  lessons.sort((a, b) => b.score - a.score);

  let fallback = false;
  let selected = lessons;
  if (query) {
    const relevant = lessons.filter(item => item.relevance > 0.02);
    if (relevant.length > 0) {
      selected = relevant;
    } else if (lessons.length > 0) {
      // 没有字面重合时仍给出最高置信度经验，但要显式标记
      fallback = true;
      selected = lessons;
    }
  }
  selected = selected.slice(0, limit);

  const rules = [];
  if (includeRules) {
    for (const [id, rule] of Object.entries(state.rules || {})) {
      const weight = rule.weight || 0;
      const relevance = query ? similarity(query, rule.description || '') : 0;
      rules.push({
        kind: 'rule',
        id,
        description: rule.description,
        weight,
        relevance: round(relevance),
        score: round(query ? 0.45 * weight + 0.55 * relevance : weight)
      });
    }
    rules.sort((a, b) => b.score - a.score);
    if (query) {
      // 带查询时只召回有字面关联的规则，避免把硬约束列表整段塞进上下文
      const relevant = rules.filter(rule => rule.relevance > 0.02);
      rules.length = 0;
      rules.push(...relevant);
    }
    rules.splice(rulesLimit);
  }

  return { query, fallback, lessons: selected, rules, minConfidence };
}

function loadGlobalState() {
  try {
    return new Storage(Storage.getGlobalStatePath()).load();
  } catch {
    return null;
  }
}

function register(registry, storage) {
  registry['recall'] = (...args) => {
    const { positional, flags } = parseArgs(args);
    const query = positional.join(' ').trim();
    const state = storage.load();

    const result = computeRecall(state, loadGlobalState(), { query, flags });

    if (flags.touch === true) {
      for (const item of result.lessons) {
        const lesson = state.lessons[item.id];
        if (lesson) {
          lesson.last_used = nowIso();
          item.touched = true;
        }
      }
      storage.save(state);
    }

    if (flags.json === true) return result;
    return raw(renderMarkdown(result));
  };
}

function oneLine(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function renderMarkdown({ query, fallback, lessons, rules }) {
  const lines = [];
  const header = query ? `query="${oneLine(query)}"` : 'no query';
  lines.push(`<!-- agent-evolution recall | ${header} | ${lessons.length} lessons / ${rules.length} rules -->`);

  if (rules.length > 0) {
    lines.push('## 规则（必须遵守）');
    for (const rule of rules) {
      lines.push(`- [${rule.id}] ${oneLine(rule.description)} (w=${Number(rule.weight || 0).toFixed(2)})`);
    }
  }

  if (lessons.length > 0) {
    lines.push('## 已学经验');
    for (const lesson of lessons) {
      const evidence = lesson.evidence_count > 0 ? `, e=${lesson.evidence_count}` : '';
      const scopeTag = lesson.scope === 'global' ? '[G]' : '';
      lines.push(`- ${scopeTag}[${lesson.id}] 当 ${oneLine(lesson.trigger)} → ${oneLine(lesson.action)} (c=${lesson.confidence.toFixed(2)}${evidence})`);
    }
  }

  if (rules.length === 0 && lessons.length === 0) {
    lines.push('（暂无高置信度经验。任务结束后用 review-task，纠正/踩坑后用 lesson-add 记录。）');
    return lines.join('\n');
  }

  if (fallback) {
    lines.push('');
    lines.push('> 未找到字面相关内容，以上按置信度排序；请自行判断是否适用。');
  }
  return lines.join('\n');
}

module.exports = { register, renderMarkdown, computeRecall };

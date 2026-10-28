const {
  parseArgs,
  flagNumber,
  similarity,
  recencyScore,
  clamp,
  raw
} = require('./shared');

const KINDS = ['rules', 'lessons', 'errors', 'insights', 'reviews'];
const RECENCY_HALF_LIFE = 90;

// 复盘是历史记录，可复用性低于错误档案/经验，做轻微降权避免刷屏
const KIND_WEIGHT = {
  errors: 1,
  insights: 0.98,
  lessons: 1,
  rules: 0.95,
  reviews: 0.75
};

function oneLine(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function textOf(kind, item) {
  if (kind === 'rules') return `${item.description || ''} ${item.source || ''}`;
  if (kind === 'lessons') return `${item.trigger || ''} ${item.action || ''} ${item.domain || ''}`;
  if (kind === 'errors') {
    return `${item.title || ''} ${item.root_cause || ''} ${item.solution || ''} ${item.prevention || ''}`;
  }
  if (kind === 'insights') {
    return `${item.problem || ''} ${item.pattern || ''} ${item.solution || ''} ${(item.applications || []).join(' ')}`;
  }
  const highlights = (item.highlights || []).join(' ');
  const improvements = (item.improvements || []).join(' ');
  const learnings = (item.learnings || []).join(' ');
  return `${item.task || ''} ${highlights} ${improvements} ${learnings}`;
}

function qualityOf(kind, item) {
  if (kind === 'rules') return clamp(Number(item.weight) || 0, 0, 1);
  if (kind === 'lessons') return clamp(Number(item.confidence) || 0, 0, 1);
  if (kind === 'reviews') return clamp((Number(item.completion) || 0) / 100, 0, 1);
  if (kind === 'insights') {
    return Math.min(1, 0.5 + (item.applications?.length || 0) * 0.1 + (item.similar?.length || 0) * 0.05);
  }
  return Math.min(1, 0.5 + (item.related?.length || 0) * 0.1);
}

function renderItem(kind, hit) {
  if (kind === 'rules') {
    return `- [${hit.id}] ${oneLine(hit.description)} (w=${Number(hit.weight || 0).toFixed(2)}, rel=${hit.relevance})`;
  }
  if (kind === 'lessons') {
    return `- [${hit.id}] 当 ${oneLine(hit.trigger)} → ${oneLine(hit.action)} (c=${Number(hit.confidence || 0).toFixed(2)}, rel=${hit.relevance})`;
  }
  if (kind === 'errors') {
    return `- [${hit.id}] ${oneLine(hit.title)} — 根因: ${oneLine(hit.root_cause)}；方案: ${oneLine(hit.solution)}；预防: ${oneLine(hit.prevention)} (rel=${hit.relevance})`;
  }
  if (kind === 'insights') {
    return `- [${hit.id}] ${oneLine(hit.problem)} → ${oneLine(hit.solution)}（模式: ${oneLine(hit.pattern)}，rel=${hit.relevance}）`;
  }
  return `- [${hit.id}] ${oneLine(hit.task)}（完成度 ${hit.completion}%，改进: ${oneLine((hit.improvements || []).join('；')) || '无'}，rel=${hit.relevance}）`;
}

const KIND_TITLES = {
  errors: '错误档案',
  insights: '洞察',
  lessons: '经验',
  reviews: '复盘',
  rules: '规则'
};

function register(registry, storage) {
  registry['search'] = (...args) => {
    const { positional, flags } = parseArgs(args);
    const query = positional.join(' ').trim();
    if (!query) {
      throw new Error('Missing query. Usage: search "<关键词>" [--kind all|errors|insights|lessons|reviews|rules] [--limit 10]');
    }

    let requested = flags.kind && flags.kind !== 'all' ? [flags.kind] : KINDS;
    if (!Array.isArray(requested)) requested = [requested];
    for (const kind of requested) {
      if (!KINDS.includes(kind)) {
        throw new Error(`Invalid kind: ${kind}. Use one of: all, ${KINDS.join(', ')}`);
      }
    }

    const limit = Math.max(1, Math.floor(flagNumber(flags.limit, 10)));
    const minScore = flagNumber(flags['min-score'], 0.15);
    const state = storage.load();

    const hits = [];
    for (const kind of requested) {
      const collection = state[kind];
      const entries = kind === 'reviews'
        ? (Array.isArray(collection) ? collection.map((item, index) => [item.id || String(index), item]) : [])
        : Object.entries(collection || {});

      for (const [id, item] of entries) {
        if (kind === 'lessons' && item.status === 'retired') continue;
        const relevance = similarity(query, textOf(kind, item));
        if (relevance <= 0) continue;

        const quality = qualityOf(kind, item);
        const recency = recencyScore(
          item.updated_at || item.created_at || item.lastChecked,
          RECENCY_HALF_LIFE
        );
        const score = KIND_WEIGHT[kind] * (0.75 * relevance + 0.15 * quality + 0.10 * recency);
        if (score < minScore) continue;

        hits.push({
          kind,
          id,
          score: Math.round(score * 1000) / 1000,
          relevance: Math.round(relevance * 1000) / 1000,
          ...pickFields(kind, item)
        });
      }
    }

    hits.sort((a, b) => b.score - a.score);
    const selected = hits.slice(0, limit);

    if (flags.json === true) {
      const counts = {};
      for (const hit of selected) counts[hit.kind] = (counts[hit.kind] || 0) + 1;
      return { query, minScore, total: hits.length, counts, hits: selected };
    }

    return raw(renderMarkdown(query, selected));
  };
}

function pickFields(kind, item) {
  if (kind === 'rules') {
    return { description: item.description, weight: item.weight, source: item.source };
  }
  if (kind === 'lessons') {
    return {
      trigger: item.trigger,
      action: item.action,
      domain: item.domain,
      confidence: item.confidence,
      status: item.status
    };
  }
  if (kind === 'errors') {
    return {
      title: item.title,
      root_cause: item.root_cause,
      solution: item.solution,
      prevention: item.prevention
    };
  }
  if (kind === 'insights') {
    return {
      problem: item.problem,
      pattern: item.pattern,
      solution: item.solution,
      applications: item.applications || []
    };
  }
  return {
    task: item.task,
    completion: item.completion,
    highlights: item.highlights || [],
    improvements: item.improvements || [],
    learnings: item.learnings || []
  };
}

function renderMarkdown(query, hits) {
  const lines = [];
  lines.push(`<!-- agent-evolution search | query="${oneLine(query)}" | ${hits.length} hits -->`);
  if (hits.length === 0) {
    lines.push('（没有匹配的记忆。确认关键词，或用 list/report 查看全部。）');
    return lines.join('\n');
  }

  for (const kind of ['errors', 'insights', 'lessons', 'reviews', 'rules']) {
    const group = hits.filter(hit => hit.kind === kind);
    if (group.length === 0) continue;
    lines.push(`## ${KIND_TITLES[kind]}（${group.length}）`);
    for (const hit of group) {
      lines.push(renderItem(kind, hit));
    }
  }
  return lines.join('\n');
}

module.exports = { register };

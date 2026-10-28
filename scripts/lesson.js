const path = require('path');
const { Storage } = require('./storage');
const {
  nowIso,
  clamp,
  similarity,
  parseArgs,
  flagNumber,
  recordEvent
} = require('./shared');

const DELTA_HELPFUL = 0.08;
const DELTA_HARMFUL = -0.20;

const DEFAULT_LIFECYCLE = {
  activateConfidence: 0.6,
  retireConfidence: 0.2,
  maxConfidence: 0.95,
  maxEvidence: 20
};

function lifecycleOf(state) {
  return state.config?.lifecycle || DEFAULT_LIFECYCLE;
}

/**
 * 构造一条经验。lesson-add 与 wrap-up 共用，避免字段漂移
 * （尤其 helpful/harmful/scope 缺失会让后续 feedback 产出 NaN）。
 */
function buildLesson(state, { trigger, action, domain = 'general', confidence = 0.5, note } = {}) {
  const cfg = lifecycleOf(state);
  const rawConfidence = Number(confidence);
  const value = clamp(Number.isFinite(rawConfidence) ? rawConfidence : 0.5, 0.05, cfg.maxConfidence);
  const rounded = Math.round(value * 100) / 100;
  const now = nowIso();
  const lesson = {
    trigger,
    action,
    domain,
    confidence: rounded,
    status: rounded >= cfg.activateConfidence ? 'active' : 'pending',
    scope: 'project',
    evidence: [],
    helpful: 0,
    harmful: 0,
    created_at: now,
    updated_at: now,
    last_used: null
  };
  if (note) {
    lesson.evidence.push({ type: 'observation', note: String(note).slice(0, 300), at: now });
  }
  return lesson;
}

function register(registry, storage) {
  function globalStorage() {
    return new Storage(Storage.getGlobalStatePath());
  }

  function projectLabel() {
    try {
      return path.basename(Storage.getProjectRoot());
    } catch {
      return 'project';
    }
  }
  function lifecycle(state) {
    return lifecycleOf(state);
  }

  function requireText(value, name) {
    if (typeof value !== 'string' || value.trim() === '') {
      throw new Error(`Missing or empty argument: ${name}`);
    }
    return value.trim();
  }

  function getLesson(state, id) {
    const lesson = state.lessons[id];
    if (!lesson) throw new Error(`Lesson ${id} not found`);
    return lesson;
  }

  function pushEvidence(state, lesson, type, note) {
    lesson.evidence.push({
      type,
      note: note ? String(note).slice(0, 300) : '',
      at: nowIso()
    });
    const max = lifecycle(state).maxEvidence || 20;
    if (lesson.evidence.length > max) {
      lesson.evidence = lesson.evidence.slice(-max);
    }
  }

  /** 置信度阈值 → 状态；retired 只能通过 lesson-promote 复活 */
  function syncStatus(state, lesson) {
    if (lesson.status === 'retired') return;
    const cfg = lifecycle(state);
    if (lesson.confidence >= cfg.activateConfidence) {
      lesson.status = 'active';
      return;
    }
    if (lesson.confidence < cfg.retireConfidence && lesson.harmful >= 2) {
      lesson.status = 'retired';
      return;
    }
    if (!lesson.status) lesson.status = 'pending';
  }

  function findSimilar(state, text, excludeId) {
    const matches = [];
    for (const [id, lesson] of Object.entries(state.lessons)) {
      if (id === excludeId) continue;
      const score = similarity(text, `${lesson.trigger} ${lesson.action}`);
      if (score >= 0.6) {
        matches.push({ id, score: Math.round(score * 100) / 100, trigger: lesson.trigger });
      }
    }
    return matches.sort((a, b) => b.score - a.score).slice(0, 3);
  }

  function summarize(lesson) {
    return {
      trigger: lesson.trigger,
      action: lesson.action,
      domain: lesson.domain,
      scope: lesson.scope || 'project',
      confidence: lesson.confidence,
      status: lesson.status,
      helpful: lesson.helpful,
      harmful: lesson.harmful,
      evidence_count: (lesson.evidence || []).length,
      updated_at: lesson.updated_at,
      last_used: lesson.last_used || null
    };
  }

  registry['lesson-add'] = (id, trigger, action, ...rest) => {
    const { positional, flags } = parseArgs(rest);
    const state = storage.load();
    const lessonId = requireText(id, 'id');
    const triggerText = requireText(trigger, 'trigger');
    const actionText = requireText(action, 'action');

    if (state.lessons[lessonId]) {
      throw new Error(`Lesson ${lessonId} already exists. Use lesson-edit / lesson-feedback, or lesson-merge.`);
    }

    const domain = String(flags.domain || positional[0] || 'general');
    const lesson = buildLesson(state, {
      trigger: triggerText,
      action: actionText,
      domain,
      confidence: flagNumber(flags.confidence ?? positional[1], 0.5),
      note: flags.evidence
    });

    state.lessons[lessonId] = lesson;
    recordEvent(state, 'lesson-add', lessonId, `${triggerText} -> ${actionText}`);
    storage.save(state);

    return { success: true, lesson, similar: findSimilar(state, `${triggerText} ${actionText}`, lessonId) };
  };

  registry['lesson-feedback'] = (id, outcome, note) => {
    const state = storage.load();
    const lesson = getLesson(state, requireText(id, 'id'));
    const kind = requireText(outcome, 'outcome');

    if (kind !== 'helpful' && kind !== 'harmful') {
      throw new Error(`Invalid outcome: ${kind}. Use 'helpful' or 'harmful'`);
    }
    if (lesson.status === 'retired') {
      throw new Error(`Lesson ${id} is retired. Use lesson-promote to revive it first.`);
    }

    const cfg = lifecycle(state);
    lesson.confidence = clamp(
      Math.round((lesson.confidence + (kind === 'helpful' ? DELTA_HELPFUL : DELTA_HARMFUL)) * 100) / 100,
      0.05,
      cfg.maxConfidence
    );
    if (kind === 'helpful') lesson.helpful += 1;
    else lesson.harmful += 1;

    pushEvidence(state, lesson, kind, note);
    lesson.updated_at = nowIso();
    syncStatus(state, lesson);

    recordEvent(state, 'lesson-feedback', id, `${kind}${note ? `: ${note}` : ''}`);
    storage.save(state);
    return { success: true, lesson };
  };

  registry['lesson-promote'] = (id, ...args) => {
    const { flags } = parseArgs(args);
    const state = storage.load();
    const lessonId = requireText(id, 'id');
    const lesson = getLesson(state, lessonId);
    const cfg = lifecycle(state);
    const minConfidence = cfg.globalMinConfidence ?? 0.8;
    const nextConfidence = Math.max(lesson.confidence, cfg.activateConfidence);

    // 先校验再落本地，避免「全局提升失败但本地已被改状态」
    if (flags.global === true && flags.force !== true && nextConfidence < minConfidence) {
      throw new Error(
        `Lesson ${lessonId} confidence ${nextConfidence} < globalMinConfidence ${minConfidence}. `
        + 'Gather more helpful feedback or pass --force (not recommended).'
      );
    }

    lesson.confidence = nextConfidence;
    lesson.status = 'active';
    lesson.updated_at = nowIso();
    pushEvidence(state, lesson, 'promotion', 'manual promote');
    recordEvent(state, 'lesson-promote', lessonId, `confidence=${lesson.confidence}`);
    storage.save(state);

    if (flags.global !== true) {
      return { success: true, lesson };
    }

    const gsStorage = globalStorage();
    const gs = gsStorage.load();
    const maxEvidence = (gs.config.lifecycle || cfg).maxEvidence || 20;
    const now = nowIso();
    const existing = gs.lessons[lessonId];

    if (existing) {
      existing.confidence = Math.max(existing.confidence || 0, lesson.confidence);
      existing.status = 'active';
      existing.scope = 'global';
      existing.updated_at = now;
      existing.evidence = [
        ...(existing.evidence || []),
        { type: 'promotion', note: `from ${projectLabel()}`, at: now }
      ].slice(-maxEvidence);
    } else {
      // 只复制可迁移的 trigger/action，不复制可能含项目细节的 evidence note
      gs.lessons[lessonId] = {
        trigger: lesson.trigger,
        action: lesson.action,
        domain: lesson.domain,
        confidence: lesson.confidence,
        status: 'active',
        scope: 'global',
        evidence: [{ type: 'promotion', note: `from ${projectLabel()}`, at: now }],
        helpful: 0,
        harmful: 0,
        created_at: now,
        updated_at: now,
        last_used: null
      };
    }

    recordEvent(gs, 'lesson-promote-global', lessonId, `${lesson.trigger} -> ${lesson.action}`);
    gsStorage.save(gs);

    return {
      success: true,
      lesson,
      global: {
        id: lessonId,
        path: Storage.getGlobalStatePath(),
        confidence: gs.lessons[lessonId].confidence,
        evidence_count: gs.lessons[lessonId].evidence.length
      }
    };
  };

  registry['lesson-retire'] = (id, ...args) => {
    const { positional, flags } = parseArgs(args);
    const useGlobal = flags.global === true;
    const state = useGlobal ? globalStorage().load() : storage.load();
    const lesson = getLesson(state, requireText(id, 'id'));
    const reason = positional[0] || 'manual retire';

    lesson.status = 'retired';
    lesson.updated_at = nowIso();
    pushEvidence(state, lesson, 'retire', reason);
    recordEvent(state, useGlobal ? 'lesson-retire-global' : 'lesson-retire', id, reason);
    if (useGlobal) globalStorage().save(state);
    else storage.save(state);
    return { success: true, scope: useGlobal ? 'global' : 'project', lesson };
  };

  registry['lesson-edit'] = (id, field, value) => {
    const state = storage.load();
    const lesson = getLesson(state, requireText(id, 'id'));
    const allowed = ['trigger', 'action', 'domain'];
    const target = requireText(field, 'field');

    if (!allowed.includes(target)) {
      throw new Error(`Invalid field: ${target}. Allowed: ${allowed.join(', ')}`);
    }

    lesson[target] = requireText(value, 'value');
    lesson.updated_at = nowIso();
    recordEvent(state, 'lesson-edit', id, `${target}=${lesson[target]}`);
    storage.save(state);
    return { success: true, lesson };
  };

  registry['lesson-list'] = (...args) => {
    const { flags } = parseArgs(args);
    const useGlobal = flags.global === true;
    const state = useGlobal ? globalStorage().load() : storage.load();
    const limit = flagNumber(flags.limit, 50);
    const minConfidence = flagNumber(flags['min-confidence'], 0);

    const items = Object.entries(state.lessons)
      .filter(([, lesson]) => !flags.status || lesson.status === flags.status)
      .filter(([, lesson]) => !flags.domain || lesson.domain === flags.domain)
      .filter(([, lesson]) => lesson.confidence >= minConfidence)
      .map(([id, lesson]) => ({ id, ...summarize(lesson) }))
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, limit);

    const byStatus = { active: 0, pending: 0, retired: 0 };
    for (const lesson of Object.values(state.lessons)) {
      if (byStatus[lesson.status] !== undefined) byStatus[lesson.status] += 1;
    }

    return {
      source: useGlobal ? 'global' : 'project',
      lessons: items,
      total: Object.keys(state.lessons).length,
      byStatus
    };
  };

  registry['lesson-show'] = (id, ...args) => {
    const { flags } = parseArgs(args);
    const state = flags.global === true ? globalStorage().load() : storage.load();
    const lessonId = requireText(id, 'id');
    const lesson = getLesson(state, lessonId);
    return { id: lessonId, scope: flags.global === true ? 'global' : 'project', ...lesson };
  };

  registry['lesson-merge'] = (keepId, dropId) => {
    const state = storage.load();
    const keep = getLesson(state, requireText(keepId, 'keepId'));
    const drop = getLesson(state, requireText(dropId, 'dropId'));
    if (keepId === dropId) throw new Error('keepId and dropId must differ');

    keep.confidence = Math.max(keep.confidence, drop.confidence);
    keep.helpful += drop.helpful || 0;
    keep.harmful += drop.harmful || 0;

    const seen = new Set(keep.evidence.map(e => `${e.type}:${e.note}`));
    for (const evidence of drop.evidence) {
      const key = `${evidence.type}:${evidence.note}`;
      if (!seen.has(key)) {
        keep.evidence.push(evidence);
        seen.add(key);
      }
    }
    const max = lifecycle(state).maxEvidence || 20;
    if (keep.evidence.length > max) keep.evidence = keep.evidence.slice(-max);

    const rank = { retired: 0, pending: 1, active: 2 };
    if ((rank[drop.status] || 0) > (rank[keep.status] || 0)) keep.status = drop.status;
    keep.updated_at = nowIso();

    delete state.lessons[dropId];
    recordEvent(state, 'lesson-merge', keepId, `merged ${dropId}`);
    storage.save(state);
    return { success: true, lesson: keep, merged_from: dropId };
  };
}

module.exports = { register, buildLesson, lifecycleOf };

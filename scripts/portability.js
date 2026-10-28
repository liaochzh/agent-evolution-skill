const fs = require('fs');
const path = require('path');
const { Storage } = require('./storage');
const {
  TARGET_VERSION,
  parseArgs,
  flagNumber,
  nowIso,
  redact,
  recordEvent,
  raw
} = require('./shared');

const KINDS = ['lessons', 'rules', 'errors', 'insights'];

function deepRedact(value) {
  if (typeof value === 'string') return redact(value);
  if (Array.isArray(value)) return value.map(deepRedact);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, deepRedact(item)]));
  }
  return value;
}

function projectName() {
  try {
    return path.basename(Storage.getProjectRoot());
  } catch {
    return 'unknown';
  }
}

function renderMarkdown(bundle) {
  const lines = [];
  lines.push(`# Agent 经验导出`);
  lines.push('');
  lines.push(`- 项目: ${bundle.source.project}`);
  lines.push(`- 时间: ${bundle.exported_at}`);
  lines.push(`- 版本: ${bundle.version}`);
  lines.push('');

  if (Object.keys(bundle.rules).length > 0) {
    lines.push('## 规则');
    for (const [id, rule] of Object.entries(bundle.rules)) {
      lines.push(`- [${id}] ${rule.description} (w=${Number(rule.weight || 0).toFixed(2)})`);
    }
    lines.push('');
  }

  if (Object.keys(bundle.lessons).length > 0) {
    lines.push('## 经验');
    for (const [id, lesson] of Object.entries(bundle.lessons)) {
      lines.push(`- [${id}] 当 ${lesson.trigger} → ${lesson.action} (c=${Number(lesson.confidence || 0).toFixed(2)}, domain=${lesson.domain || 'general'})`);
    }
    lines.push('');
  }

  if (Object.keys(bundle.errors).length > 0) {
    lines.push('## 错误档案');
    for (const [id, error] of Object.entries(bundle.errors)) {
      lines.push(`- [${id}] ${error.title}: 根因 ${error.root_cause}；方案 ${error.solution}；预防 ${error.prevention}`);
    }
    lines.push('');
  }

  if (Object.keys(bundle.insights).length > 0) {
    lines.push('## 洞察');
    for (const [id, insight] of Object.entries(bundle.insights)) {
      lines.push(`- [${id}] ${insight.problem} → ${insight.solution}（模式：${insight.pattern}）`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

function register(registry, storage) {
  registry['export'] = (...args) => {
    const { flags } = parseArgs(args);
    const kind = flags.kind || 'all';
    if (kind !== 'all' && !KINDS.includes(kind)) {
      throw new Error(`Invalid kind: ${kind}. Use one of: all, ${KINDS.join(', ')}`);
    }
    const format = flags.format || 'json';
    if (format !== 'json' && format !== 'md') {
      throw new Error(`Invalid format: ${format}. Use json or md`);
    }
    const shouldRedact = flags.redact !== false;

    const state = storage.load();
    const selected = kind === 'all' ? KINDS : [kind];
    const bundle = {
      bundle: 'agent-evolution',
      version: TARGET_VERSION,
      exported_at: nowIso(),
      source: { project: projectName() },
      lessons: {},
      rules: {},
      errors: {},
      insights: {}
    };
    for (const key of selected) {
      Object.assign(bundle[key], state[key] || {});
    }

    const payload = shouldRedact ? deepRedact(bundle) : bundle;
    const content = format === 'md' ? renderMarkdown(payload) : JSON.stringify(payload, null, 2);

    if (flags.out) {
      const outPath = path.resolve(String(flags.out));
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      fs.writeFileSync(outPath, content, 'utf8');
      return {
        success: true,
        path: outPath,
        format,
        redacted: shouldRedact,
        counts: Object.fromEntries(selected.map(key => [key, Object.keys(bundle[key]).length]))
      };
    }

    return raw(content);
  };

  registry['import'] = (...args) => {
    const { positional, flags } = parseArgs(args);
    const filePath = positional[0];
    if (!filePath) throw new Error('Missing bundle path. Usage: import <bundle.json> [--dry-run] [--cap 0.6]');

    let bundle;
    try {
      bundle = JSON.parse(fs.readFileSync(String(filePath), 'utf8'));
    } catch (e) {
      throw new Error(`Cannot read bundle ${filePath}: ${e.message}`);
    }
    if (!bundle || bundle.bundle !== 'agent-evolution') {
      throw new Error('Not an agent-evolution bundle (missing "bundle": "agent-evolution")');
    }

    const dryRun = flags['dry-run'] === true;
    const noCap = flags.cap === false;
    const cap = noCap
      ? 1
      : Math.min(1, Math.max(0, flagNumber(flags.cap, 0.6)));
    const sourceProject = bundle.source?.project || 'unknown';

    const state = storage.load();
    const added = { lessons: [], rules: [], errors: [], insights: [] };
    const conflicts = { lessons: [], rules: [], errors: [], insights: [] };

    for (const id of Object.keys(bundle.lessons || {})) {
      if (state.lessons[id]) {
        conflicts.lessons.push(id);
        continue;
      }
      const incoming = bundle.lessons[id];
      if (!incoming || typeof incoming !== 'object') continue;
      const confidence = Math.min(Number(incoming.confidence || 0.5), cap);
      const cfg = state.config.lifecycle;
      state.lessons[id] = {
        ...incoming,
        confidence: Math.round(confidence * 100) / 100,
        status: confidence >= cfg.activateConfidence ? 'active' : 'pending',
        scope: 'project',
        helpful: 0,
        harmful: 0,
        evidence: [
          ...(Array.isArray(incoming.evidence) ? incoming.evidence.slice(-5) : []),
          { type: 'import', note: `from ${sourceProject}`, at: nowIso() }
        ],
        last_used: null,
        created_at: incoming.created_at || nowIso(),
        updated_at: nowIso()
      };
      added.lessons.push(id);
    }

    for (const id of Object.keys(bundle.rules || {})) {
      if (state.rules[id]) {
        conflicts.rules.push(id);
        continue;
      }
      const incoming = bundle.rules[id];
      if (!incoming || typeof incoming.description !== 'string') continue;
      state.rules[id] = {
        description: incoming.description,
        source: `imported:${sourceProject}`,
        weight: 1,
        executions: 0,
        violations: 0,
        createdAt: nowIso()
      };
      added.rules.push(id);
    }

    for (const kind of ['errors', 'insights']) {
      for (const id of Object.keys(bundle[kind] || {})) {
        if (state[kind][id]) {
          conflicts[kind].push(id);
          continue;
        }
        const incoming = bundle[kind][id];
        if (!incoming || typeof incoming !== 'object') continue;
        state[kind][id] = {
          ...incoming,
          created_at: incoming.created_at || nowIso(),
          updated_at: nowIso()
        };
        added[kind].push(id);
      }
    }

    if (!dryRun) {
      const summary = KINDS.map(key => `${key}:${added[key].length}`).join(' ');
      recordEvent(state, 'import', path.basename(String(filePath)), summary);
      storage.save(state);
    }

    return {
      success: true,
      dryRun,
      cap,
      sourceProject,
      added,
      conflicts,
      addedCount: KINDS.reduce((sum, key) => sum + added[key].length, 0)
    };
  };

  registry['prune'] = (...args) => {
    const { flags } = parseArgs(args);
    const days = flagNumber(flags.days, 90);
    const pendingDays = flagNumber(flags['pending-days'], 30);
    const apply = flags.apply === true;
    const useGlobal = flags.global === true;
    const target = useGlobal ? new Storage(Storage.getGlobalStatePath()) : storage;
    const state = target.load();
    const now = Date.now();
    const olderThan = (value, spanDays) => {
      const ts = new Date(value || 0).getTime();
      return Number.isFinite(ts) && ts > 0 && (now - ts) > spanDays * 86400000;
    };

    const candidateLessons = [];
    for (const [id, lesson] of Object.entries(state.lessons)) {
      const staleRetired = lesson.status === 'retired' && olderThan(lesson.updated_at, days);
      const stalePending = lesson.status === 'pending'
        && lesson.confidence < 0.4
        && olderThan(lesson.updated_at, pendingDays);
      if (staleRetired || stalePending) {
        candidateLessons.push({ id, status: lesson.status, confidence: lesson.confidence });
      }
    }

    const candidatePatterns = Object.entries(state.patterns)
      .filter(([, pattern]) => olderThan(pattern.last_seen, days))
      .map(([id]) => id);

    if (apply) {
      candidateLessons.forEach(({ id }) => delete state.lessons[id]);
      candidatePatterns.forEach(id => delete state.patterns[id]);
      recordEvent(state, 'prune', null, `lessons:${candidateLessons.length} patterns:${candidatePatterns.length}`);
      target.save(state);
    }

    return {
      success: true,
      scope: useGlobal ? 'global' : 'project',
      apply,
      dryRun: !apply,
      thresholds: { days, pendingDays },
      lessons: candidateLessons,
      patterns: candidatePatterns
    };
  };
}

module.exports = { register };

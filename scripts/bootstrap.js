const { parseArgs, raw } = require('./shared');
const { Storage } = require('./storage');
const { readRaw, diagnose } = require('./doctor');
const { computeRecall, renderMarkdown } = require('./recall');

/**
 * 任务开始入口：召回 + 体检提醒 + 上次复盘待改进。
 * 只读：用 readRaw + Storage.migrate（纯内存归一），不调 load()，
 * 因此不会迁移、不会写 .bak；也不支持 recall 的 --touch。
 */
function register(registry, storage) {
  registry['bootstrap'] = (...args) => {
    const { positional, flags } = parseArgs(args);
    const query = positional.join(' ').trim();

    const read = readRaw(storage.filePath);
    const state = storage.migrate(read.raw || {});
    const globalRead = readRaw(Storage.getGlobalStatePath());
    const globalState = globalRead.raw ? storage.migrate(globalRead.raw) : null;

    const recall = computeRecall(state, globalState, {
      query,
      flags: {
        limit: flags.limit,
        domain: flags.domain,
        threshold: flags.threshold,
        'rules-limit': flags['rules-limit'],
        rules: flags.rules
      }
    });

    // parseArgs 把 --no-doctor 映射为 doctor=false（不会出现 'no-doctor' 键）
    const skipDoctor = flags.doctor === false;
    const diagnosis = skipDoctor
      ? { ok: true, counts: {}, issues: [] }
      : diagnose({
        rawState: read.raw,
        stateExists: read.exists,
        stateError: read.error,
        global: globalRead,
        nowMs: Date.now(),
        days: 90
      });

    const reviews = Array.isArray(read.raw?.reviews) ? read.raw.reviews : [];
    const last = reviews[reviews.length - 1] || null;
    const lastReview = last
      ? { id: last.id || null, task: last.task, improvements: last.improvements || [] }
      : null;

    if (flags.json === true) {
      return { recall, issues: diagnosis.issues, lastReview };
    }
    return raw(render({ recall, issues: diagnosis.issues, lastReview }));
  };
}

function oneLine(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function render({ recall, issues, lastReview }) {
  const lines = [renderMarkdown(recall)];

  const reminders = issues.filter(issue => issue.level !== 'info').slice(0, 3);
  if (reminders.length > 0) {
    lines.push('', '## 待办提醒');
    for (const issue of reminders) lines.push(`- [${issue.code}] ${issue.message}`);
  }

  const improvements = (lastReview?.improvements || []).slice(0, 3);
  if (improvements.length > 0) {
    lines.push('', '## 上次复盘待改进');
    for (const item of improvements) lines.push(`- ${oneLine(item)}`);
  }

  return lines.join('\n');
}

module.exports = { register };

const {
  parseArgs,
  parseArrayParam,
  genReviewId,
  genLessonId,
  recordEvent,
  nowIso,
  similarity
} = require('./shared');
const { buildLesson, lifecycleOf } = require('./lesson');

function requireText(value, name) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`Missing or empty argument: ${name}`);
  }
  return value.trim();
}

function parseCompletion(value) {
  const num = Number(value);
  if (!Number.isInteger(num) || num < 0 || num > 100) {
    throw new Error(`Invalid completion: ${value}. Expected an integer between 0 and 100.`);
  }
  return num;
}

/** --lessons 必须是可以解析的 JSON 数组；坏 JSON 直接报错，不静默降级 */
function parseLessons(value) {
  if (value === undefined) return [];
  const text = typeof value === 'string' ? value : String(value);
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('Invalid --lessons JSON: 需要 JSON 数组，例如 \'[{"trigger":"改公共函数前","action":"先 grep 调用方"}]\'');
  }
  if (!Array.isArray(parsed)) {
    throw new Error('Invalid --lessons JSON: 需要 JSON 数组');
  }
  return parsed;
}

function summarize(lessonId, lesson) {
  return {
    id: lessonId,
    trigger: lesson.trigger,
    action: lesson.action,
    domain: lesson.domain,
    confidence: lesson.confidence,
    status: lesson.status
  };
}

function similarityHints(state, triggers) {
  const hints = [];
  for (const [id, lesson] of Object.entries(state.lessons || {})) {
    let best = 0;
    for (const text of triggers) {
      const score = similarity(text, `${lesson.trigger} ${lesson.action}`);
      if (score > best) best = score;
    }
    if (best >= 0.6) {
      hints.push({ id, score: Math.round(best * 100) / 100, trigger: lesson.trigger });
    }
  }
  return hints.sort((a, b) => b.score - a.score).slice(0, 3);
}

function register(registry, storage) {
  registry['wrap-up'] = (task, completion, highlights, improvements, ...rest) => {
    const { flags } = parseArgs(rest);
    const state = storage.load();

    // 阶段 1：全部校验，任一失败直接抛错，不产生任何写入
    const taskText = requireText(String(task ?? ''), 'task');
    const completionValue = parseCompletion(completion);
    const highlightsList = parseArrayParam(highlights);
    const improvementsList = parseArrayParam(improvements);
    const lessonInputs = parseLessons(flags.lessons);
    const errorIds = parseArrayParam(flags['link-error']);
    const insightIds = parseArrayParam(flags['link-insight']);

    const cfg = lifecycleOf(state);
    const planned = [];
    const seenIds = new Set();
    for (const [index, input] of lessonInputs.entries()) {
      if (!input || typeof input !== 'object' || Array.isArray(input)) {
        throw new Error(`Invalid --lessons[${index}]: 需要对象`);
      }
      const trigger = requireText(String(input.trigger ?? ''), `--lessons[${index}].trigger`);
      const action = requireText(String(input.action ?? ''), `--lessons[${index}].action`);
      const lessonId = input.id ? requireText(String(input.id), `--lessons[${index}].id`) : genLessonId();

      if (state.lessons[lessonId]) {
        throw new Error(`Lesson ${lessonId} already exists. Use lesson-edit / lesson-feedback, or lesson-merge.`);
      }
      if (seenIds.has(lessonId)) {
        throw new Error(`Duplicate lesson id in --lessons: ${lessonId}`);
      }
      seenIds.add(lessonId);

      let confidence = 0.5;
      if (input.confidence !== undefined) {
        confidence = Number(input.confidence);
        if (!Number.isFinite(confidence) || confidence < 0.05 || confidence > cfg.maxConfidence) {
          throw new Error(
            `Invalid confidence for ${lessonId}: ${input.confidence}. Expected 0.05-${cfg.maxConfidence}.`
          );
        }
      }

      planned.push({ id: lessonId, trigger, action, domain: input.domain, confidence, note: input.evidence });
    }

    for (const ref of errorIds) {
      if (!state.errors?.[ref]) throw new Error(`Error ${ref} not found; cannot link to review`);
    }
    for (const ref of insightIds) {
      if (!state.insights?.[ref]) throw new Error(`Insight ${ref} not found; cannot link to review`);
    }

    // 阶段 2：构造对象（仍不改 state）
    const review = {
      id: genReviewId(),
      task: taskText,
      completion: completionValue,
      highlights: highlightsList,
      improvements: improvementsList,
      learnings: [],
      error_ids: errorIds,
      insight_ids: insightIds,
      created_at: nowIso()
    };
    const built = planned.map(item => ({ id: item.id, lesson: buildLesson(state, item) }));
    const duplicateHints = similarityHints(state, planned.map(item => `${item.trigger} ${item.action}`));

    const result = {
      success: true,
      dryRun: flags['dry-run'] === true,
      review,
      lessons: built.map(item => summarize(item.id, item.lesson)),
      duplicateHints
    };

    if (flags['dry-run'] === true) return result;

    // 阶段 3：一次性写入
    for (const item of built) {
      state.lessons[item.id] = item.lesson;
      recordEvent(state, 'lesson-add', item.id, `${item.lesson.trigger} -> ${item.lesson.action}`);
    }
    state.reviews.push(review);
    recordEvent(state, 'wrap-up', review.id, review.task);
    storage.save(state);

    return result;
  };
}

module.exports = { register, parseLessons };

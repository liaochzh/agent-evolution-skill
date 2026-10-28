const { recordEvent, nowIso, clamp, genReviewId, parseArrayParam } = require('./shared');

function register(registry, storage) {
  function findReview(state, idOrIndex) {
    const key = String(idOrIndex ?? '');
    if (/^\d+$/.test(key)) {
      const index = Number(key);
      const review = state.reviews[index];
      if (review) return { review, index };
    }
    const index = state.reviews.findIndex(r => r.id === key);
    if (index === -1) return { review: null, index: -1 };
    return { review: state.reviews[index], index };
  }

  function requireText(value, name) {
    if (typeof value !== 'string' || value.trim() === '') {
      throw new Error(`Missing or empty argument: ${name}`);
    }
    return value.trim();
  }

  registry['review-task'] = (task, completion, highlights, improvements) => {
    const state = storage.load();
    const now = nowIso();

    const review = {
      id: genReviewId(),
      task: requireText(task, 'task'),
      completion: clamp(parseInt(completion, 10) || 0, 0, 100),
      highlights: parseArrayParam(highlights),
      improvements: parseArrayParam(improvements),
      learnings: [],
      error_ids: [],
      insight_ids: [],
      created_at: now
    };

    state.reviews.push(review);
    recordEvent(state, 'review-task', review.id, review.task);
    storage.save(state);
    return { success: true, review };
  };

  registry['review-list'] = (limit) => {
    const state = storage.load();
    const lim = limit ? parseInt(limit, 10) : 20;
    const startIdx = Math.max(0, state.reviews.length - lim);
    const reviews = state.reviews.slice(startIdx).map((r, idx) => ({
      index: startIdx + idx,
      id: r.id,
      task: r.task,
      completion: r.completion,
      highlights_count: r.highlights?.length || 0,
      improvements_count: r.improvements?.length || 0,
      learnings_count: r.learnings?.length || 0,
      error_refs: r.error_ids?.length || 0,
      insight_refs: r.insight_ids?.length || 0,
      created_at: r.created_at
    }));
    return { reviews, total: state.reviews.length };
  };

  registry['review-detail'] = (idOrIndex) => {
    const state = storage.load();
    const { review } = findReview(state, idOrIndex);
    if (!review) {
      throw new Error(`Review ${idOrIndex} not found (accepts REV-* id or zero-based index)`);
    }
    return review;
  };

  registry['review-link'] = (idOrIndex, type, refId) => {
    const state = storage.load();
    const { review } = findReview(state, idOrIndex);
    if (!review) {
      throw new Error(`Review ${idOrIndex} not found`);
    }
    const ref = requireText(refId, 'refId');
    if (type === 'error') {
      if (!review.error_ids.includes(ref)) review.error_ids.push(ref);
    } else if (type === 'insight') {
      if (!review.insight_ids.includes(ref)) review.insight_ids.push(ref);
    } else {
      throw new Error(`Invalid type: ${type}. Use 'error' or 'insight'`);
    }
    storage.save(state);
    return { success: true, review };
  };

  registry['review-learning'] = (idOrIndex, learning) => {
    const state = storage.load();
    const { review } = findReview(state, idOrIndex);
    if (!review) {
      throw new Error(`Review ${idOrIndex} not found`);
    }
    review.learnings.push(requireText(learning, 'learning'));
    storage.save(state);
    return { success: true, review };
  };
}

module.exports = { register };

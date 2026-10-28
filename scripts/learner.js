const { similarity, sharedTokenCount, recordEvent, nowIso } = require('./shared');

function register(registry, storage) {
  function requireText(value, name) {
    if (typeof value !== 'string' || value.trim() === '') {
      throw new Error(`Missing or empty argument: ${name}`);
    }
    return value.trim();
  }

  function textOf(error) {
    return `${error.title} ${error.root_cause} ${error.solution} ${error.prevention || ''}`;
  }

  registry['error-add'] = (id, title, rootCause, solution, prevention) => {
    const state = storage.load();
    const errorId = requireText(id, 'id');
    if (state.errors[errorId]) {
      throw new Error(`Error ${errorId} already exists`);
    }
    const now = nowIso();
    const error = {
      title: requireText(title, 'title'),
      root_cause: requireText(rootCause, 'root_cause'),
      solution: requireText(solution, 'solution'),
      prevention: prevention ? String(prevention) : '',
      related: [],
      created_at: now,
      updated_at: now
    };

    // 写入前给出相近档案提示，避免同一坑记成多条
    const similar = Object.entries(state.errors)
      .map(([otherId, other]) => ({
        id: otherId,
        title: other.title,
        score: Math.round(similarity(textOf(error), textOf(other)) * 100) / 100
      }))
      .filter(item => item.score >= 0.55)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3);

    state.errors[errorId] = error;
    recordEvent(state, 'error-add', errorId, error.title);
    storage.save(state);
    return { success: true, error: state.errors[errorId], similar };
  };

  registry['error-list'] = () => {
    const state = storage.load();
    const result = {};
    for (const [id, error] of Object.entries(state.errors)) {
      result[id] = {
        title: error.title,
        root_cause: error.root_cause,
        solution: error.solution,
        prevention: error.prevention,
        related_count: error.related?.length || 0,
        created_at: error.created_at,
        updated_at: error.updated_at
      };
    }
    return result;
  };

  registry['error-analyze'] = (id) => {
    const state = storage.load();
    const errorId = requireText(id, 'id');
    const error = state.errors[errorId];
    if (!error) {
      throw new Error(`Error ${errorId} not found`);
    }

    const related = [];
    for (const [otherId, otherError] of Object.entries(state.errors)) {
      if (otherId === errorId) continue;
      const score = similarity(textOf(error), textOf(otherError));
      const shared = sharedTokenCount(textOf(error), textOf(otherError));
      // 短中文串只有一个共同 bigram 时不算相关，避免「XX失败」互相误连
      if ((shared >= 2 && score >= 0.2) || score >= 0.5) {
        related.push({
          id: otherId,
          title: otherError.title,
          match_score: Math.round(score * 100) / 100
        });
      }
    }
    related.sort((a, b) => b.match_score - a.match_score);

    // 更新关联
    error.related = related.map(r => r.id);
    error.updated_at = nowIso();
    storage.save(state);

    return {
      error: { id: errorId, ...error },
      related,
      suggestion: related.length > 0
        ? `发现 ${related.length} 个相关错误，建议统一预防措施`
        : '暂无高度相关错误'
    };
  };

  registry['error-update'] = (id, field, value) => {
    const state = storage.load();
    const errorId = requireText(id, 'id');
    const error = state.errors[errorId];
    if (!error) {
      throw new Error(`Error ${errorId} not found`);
    }
    const allowed = ['title', 'root_cause', 'solution', 'prevention'];
    const target = requireText(field, 'field');
    if (!allowed.includes(target)) {
      throw new Error(`Invalid field: ${target}. Allowed: ${allowed.join(', ')}`);
    }
    error[target] = String(value ?? '');
    error.updated_at = nowIso();
    recordEvent(state, 'error-update', errorId, `${target} updated`);
    storage.save(state);
    return { success: true, error: { id: errorId, ...error } };
  };
}

module.exports = { register };

const { similarity, recordEvent, nowIso } = require('./shared');

function register(registry, storage) {
  function requireText(value, name) {
    if (typeof value !== 'string' || value.trim() === '') {
      throw new Error(`Missing or empty argument: ${name}`);
    }
    return value.trim();
  }

  function textOf(insight) {
    return `${insight.problem} ${insight.pattern} ${insight.solution}`;
  }

  registry['insight-add'] = (id, problem, pattern, solution) => {
    const state = storage.load();
    const insightId = requireText(id, 'id');
    if (state.insights[insightId]) {
      throw new Error(`Insight ${insightId} already exists`);
    }
    const now = nowIso();
    const insight = {
      problem: requireText(problem, 'problem'),
      pattern: requireText(pattern, 'pattern'),
      similar: [],
      solution: requireText(solution, 'solution'),
      applications: [],
      created_at: now,
      updated_at: now
    };

    const similar = Object.entries(state.insights)
      .map(([otherId, other]) => ({
        id: otherId,
        problem: other.problem,
        score: Math.round(similarity(textOf(insight), textOf(other)) * 100) / 100
      }))
      .filter(item => item.score >= 0.55)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3);

    state.insights[insightId] = insight;
    recordEvent(state, 'insight-add', insightId, insight.problem);
    storage.save(state);
    return { success: true, insight: state.insights[insightId], similar };
  };

  registry['insight-list'] = () => {
    const state = storage.load();
    const result = {};
    for (const [id, insight] of Object.entries(state.insights)) {
      result[id] = {
        problem: insight.problem,
        pattern: insight.pattern,
        solution: insight.solution,
        similar_count: (insight.similar || []).length,
        applications_count: (insight.applications || []).length,
        created_at: insight.created_at
      };
    }
    return result;
  };

  registry['insight-migrate'] = (id, application) => {
    const state = storage.load();
    const insightId = requireText(id, 'id');
    const insight = state.insights[insightId];
    if (!insight) {
      throw new Error(`Insight ${insightId} not found`);
    }
    const value = requireText(application, 'application');
    if (!insight.applications.includes(value)) {
      insight.applications.push(value);
      insight.updated_at = nowIso();
      recordEvent(state, 'insight-migrate', insightId, value);
      storage.save(state);
    }
    return { success: true, insight: { id: insightId, ...insight } };
  };

  registry['insight-similar'] = (id, similarProblem) => {
    const state = storage.load();
    const insightId = requireText(id, 'id');
    const insight = state.insights[insightId];
    if (!insight) {
      throw new Error(`Insight ${insightId} not found`);
    }
    const value = requireText(similarProblem, 'similarProblem');
    if (!insight.similar.includes(value)) {
      insight.similar.push(value);
      insight.updated_at = nowIso();
      recordEvent(state, 'insight-similar', insightId, value);
      storage.save(state);
    }
    return { success: true, insight: { id: insightId, ...insight } };
  };

  registry['insight-update'] = (id, field, value) => {
    const state = storage.load();
    const insightId = requireText(id, 'id');
    const insight = state.insights[insightId];
    if (!insight) {
      throw new Error(`Insight ${insightId} not found`);
    }
    const allowed = ['problem', 'pattern', 'solution'];
    const target = requireText(field, 'field');
    if (!allowed.includes(target)) {
      throw new Error(`Invalid field: ${target}. Allowed: ${allowed.join(', ')}`);
    }
    insight[target] = String(value ?? '');
    insight.updated_at = nowIso();
    recordEvent(state, 'insight-update', insightId, `${target} updated`);
    storage.save(state);
    return { success: true, insight: { id: insightId, ...insight } };
  };
}

module.exports = { register };

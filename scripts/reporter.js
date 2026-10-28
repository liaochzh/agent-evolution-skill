const { calculateAssessments, detectRepeats, parseArgs, flagNumber, recencyScore } = require('./shared');

function buildRules(state) {
  return Object.entries(state.rules).map(([id, rule]) => ({
    id,
    description: rule.description,
    source: rule.source,
    weight: rule.weight,
    executions: rule.executions,
    violations: rule.violations,
    successRate: rule.executions + rule.violations > 0
      ? Math.round(rule.executions / (rule.executions + rule.violations) * 100) / 100
      : 1,
    lastChecked: rule.lastChecked,
    lastViolation: rule.lastViolation
  }));
}

function buildIdentity(state) {
  return {
    role: state.identity.role,
    traits: state.identity.traits,
    version: state.identity.version,
    historyCount: state.identity.history.length,
    lastEvolved: state.identity.history.length > 0
      ? state.identity.history[state.identity.history.length - 1].timestamp
      : null
  };
}

function buildPatterns(state) {
  return Object.entries(state.patterns).map(([id, pattern]) => ({
    id,
    type: pattern.type,
    count: pattern.count,
    lastSeen: pattern.last_seen,
    details: pattern.details
  }));
}

function buildRecentLogs(state, limit = 50) {
  return state.logs.slice(-limit).map(l => ({
    timestamp: l.timestamp,
    actionType: l.action_type,
    detail: String(l.detail || '').substring(0, 100),
    sessionId: l.session_id
  }));
}

function buildErrors(state) {
  return Object.entries(state.errors || {}).map(([id, error]) => ({
    id,
    title: error.title,
    root_cause: error.root_cause,
    solution: error.solution,
    prevention: error.prevention,
    related_count: error.related?.length || 0,
    created_at: error.created_at,
    updated_at: error.updated_at
  }));
}

function buildInsights(state) {
  return Object.entries(state.insights || {}).map(([id, insight]) => ({
    id,
    problem: insight.problem,
    pattern: insight.pattern,
    solution: insight.solution,
    similar_count: insight.similar?.length || 0,
    applications_count: insight.applications?.length || 0,
    created_at: insight.created_at
  }));
}

function buildLessons(state) {
  return Object.entries(state.lessons || {}).map(([id, lesson]) => ({
    id,
    trigger: lesson.trigger,
    action: lesson.action,
    domain: lesson.domain,
    confidence: lesson.confidence,
    status: lesson.status,
    helpful: lesson.helpful,
    harmful: lesson.harmful,
    evidence_count: (lesson.evidence || []).length,
    last_used: lesson.last_used || null,
    updated_at: lesson.updated_at
  }));
}

function buildReviews(state, limit = 20) {
  return (state.reviews || []).slice(-limit).map((r, idx) => ({
    index: Math.max(0, (state.reviews || []).length - limit) + idx,
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
}

function buildHealth(state, lessons) {
  const halfLife = state.config.lifecycle?.halfLifeDays || 30;
  const byStatus = { active: 0, pending: 0, retired: 0 };
  let staleActive = 0;
  for (const lesson of lessons) {
    if (byStatus[lesson.status] !== undefined) byStatus[lesson.status] += 1;
    if (lesson.status === 'active' && recencyScore(lesson.last_used || lesson.updated_at, halfLife) < 0.25) {
      staleActive += 1;
    }
  }
  return {
    lessons: byStatus,
    staleActiveLessons: staleActive,
    lowWeightRules: Object.values(state.rules).filter(rule => (rule.weight || 0) < 0.5).length,
    errorCount: Object.keys(state.errors || {}).length,
    events: (state.events || []).length
  };
}

function buildSummary(rules, patterns, alerts, logs, errors, insights, reviews, lessons) {
  return {
    totalRules: rules.length,
    totalExecutions: rules.reduce((sum, r) => sum + r.executions, 0),
    totalViolations: rules.reduce((sum, r) => sum + r.violations, 0),
    avgWeight: rules.length > 0
      ? Math.round(rules.reduce((sum, r) => sum + r.weight, 0) / rules.length * 100) / 100
      : 1,
    activePatterns: patterns.length,
    alertCount: alerts.length,
    logEntries: logs.length,
    totalErrors: errors.length,
    totalInsights: insights.length,
    totalReviews: reviews.length,
    totalLessons: lessons.length,
    activeLessons: lessons.filter(lesson => lesson.status === 'active').length
  };
}

function register(registry, storage) {
  registry['report'] = () => {
    const state = storage.load();
    const now = new Date().toISOString();

    const rules = buildRules(state);
    const identity = buildIdentity(state);
    const patterns = buildPatterns(state);
    const recentLogs = buildRecentLogs(state);
    const errors = buildErrors(state);
    const insights = buildInsights(state);
    const assessments = calculateAssessments(state.assessments || {});
    const reviews = buildReviews(state);
    const lessons = buildLessons(state);
    const { alerts } = detectRepeats(state);

    return {
      generatedAt: now,
      summary: buildSummary(rules, patterns, alerts, state.logs, errors, insights, state.reviews || [], lessons),
      rules,
      identity,
      patterns,
      recentLogs,
      errors,
      insights,
      lessons,
      assessments,
      reviews,
      health: buildHealth(state, lessons),
      alerts,
      config: state.config
    };
  };

  registry['events'] = (...args) => {
    const { flags } = parseArgs(args);
    const limit = Math.max(1, Math.floor(flagNumber(flags.limit, 50)));
    const state = storage.load();
    return {
      total: state.events.length,
      events: state.events.slice(-limit).reverse()
    };
  };
}

module.exports = { register };

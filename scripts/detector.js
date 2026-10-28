const { detectRepeats, redact } = require('./shared');

function register(registry, storage) {
  function getSessionId() {
    return process.env.OPENCODE_SESSION_ID || require('crypto').randomUUID();
  }

  function matchScore(action, identity) {
    if (!identity.role && identity.traits.length === 0) return 1;
    const roleKeywords = {
      planner: ['plan', 'design', 'analyze', 'research'],
      builder: ['implement', 'code', 'build', 'edit', 'write'],
      reviewer: ['review', 'check', 'audit', 'verify'],
      debugger: ['debug', 'trace', 'log', 'inspect']
    };
    const keywords = roleKeywords[identity.role] || [];
    const traitKeywords = identity.traits || [];
    const allKeywords = [...keywords, ...traitKeywords];
    if (allKeywords.length === 0) return 1;
    const detail = String(action.detail || '').toLowerCase();
    const matches = allKeywords.filter(k => detail.includes(k.toLowerCase())).length;
    return matches / allKeywords.length;
  }

  registry['log'] = (actionType, detail) => {
    if (typeof actionType !== 'string' || actionType.trim() === '') {
      throw new Error('Missing or empty argument: action_type');
    }
    if (typeof detail !== 'string' || detail.trim() === '') {
      throw new Error('Missing or empty argument: detail');
    }

    const state = storage.load();
    const shouldRedact = state.config?.privacy?.redactLogs !== false;
    const entry = {
      timestamp: new Date().toISOString(),
      action_type: actionType.trim(),
      detail: shouldRedact ? redact(detail) : detail,
      session_id: getSessionId()
    };
    state.logs.push(entry);

    // 日志轮转：默认保留最近 1000 条，可经 config.limits.maxLogs 调整
    const maxLogs = state.config?.limits?.maxLogs || 1000;
    if (state.logs.length > maxLogs) {
      state.logs = state.logs.slice(-maxLogs);
    }

    storage.save(state);
    return { success: true, entry };
  };

  registry['detect'] = () => {
    const state = storage.load();
    const config = state.config.thresholds;
    const alerts = [];

    // 1. 重复行为检测（复用共享逻辑获取 alerts 和 recentLogs）
    const { alerts: repeatAlerts, recentLogs } = detectRepeats(state);

    for (const alert of repeatAlerts) {
      const [actionType, detail] = alert.key.split(':');
      const patternId = `repeat-${actionType}-${detail.substring(0, 20).replace(/\s+/g, '-')}`;
      let pattern = state.patterns[patternId];
      if (!pattern) {
        pattern = { type: 'repeat', count: 0, last_seen: null, details: { actionType, detail } };
        state.patterns[patternId] = pattern;
      }
      pattern.count = alert.count;
      pattern.last_seen = new Date().toISOString();
    }
    alerts.push(...repeatAlerts);

    // 2. 角色偏离检测
    if (state.identity.role || state.identity.traits.length > 0) {
      for (const log of recentLogs.slice(-20)) {
        const score = matchScore(log, state.identity);
        if (score < config.driftMatchScore) {
          const patternId = `drift-${log.action_type}-${String(log.detail || '').substring(0, 20).replace(/\s+/g, '-')}`;
          let pattern = state.patterns[patternId];
          if (!pattern) {
            pattern = { type: 'drift', count: 0, last_seen: null, details: { actionType: log.action_type, detail: log.detail } };
            state.patterns[patternId] = pattern;
          }
          pattern.count += 1;
          pattern.last_seen = new Date().toISOString();
          alerts.push({
            type: 'drift',
            patternId,
            message: `角色偏离检测: ${log.action_type} "${log.detail}" 与身份 ${state.identity.role || '未设置'} 不符 (匹配度: ${Math.round(score * 100)}%)`,
            severity: score < config.driftMatchScore / 2 ? 'high' : 'medium'
          });
        }
      }
    }

    storage.save(state);
    return { alerts, patterns: state.patterns };
  };

  registry['reset'] = (patternId) => {
    const state = storage.load();
    if (state.patterns[patternId]) {
      delete state.patterns[patternId];
      storage.save(state);
      return { success: true, message: `Pattern ${patternId} reset` };
    }
    throw new Error(`Pattern ${patternId} not found`);
  };
}

module.exports = { register };

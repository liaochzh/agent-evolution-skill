const { detectRepeats } = require('./shared');

function register(registry, storage) {
  function matchScore(action, identity) {
    if (!identity.role && identity.traits.length === 0) return 1;
    const roleKeywords = {
      planner: ['plan', 'design', 'analyze', 'research'],
      builder: ['implement', 'code', 'build', 'edit', 'write'],
      reviewer: ['review', 'check', 'audit', 'verify'],
      debugger: ['debug', 'trace', 'log', 'inspect']
    };
    const keywords = [...(roleKeywords[identity.role] || []), ...(identity.traits || [])];
    if (keywords.length === 0) return 1;
    const detail = (action.detail || '').toLowerCase();
    const matches = keywords.filter(k => detail.includes(k.toLowerCase())).length;
    return matches / keywords.length;
  }

  registry['heartbeat'] = () => {
    const state = storage.load();
    const config = state.config.thresholds;
    const alerts = [];

    // 1. 重复行为检测（复用共享逻辑）
    const { alerts: repeatAlerts, recentLogs } = detectRepeats(state);
    // 转换为 heartbeat 格式
    for (const alert of repeatAlerts) {
      const [actionType, detail] = alert.key.split(':');
      alerts.push({
        type: 'repeat',
        actionType,
        detail,
        count: alert.count,
        windowMinutes: config.repeatWindowMinutes,
        severity: alert.severity,
        message: `重复行为: ${actionType} "${detail}" 在 ${config.repeatWindowMinutes} 分钟内出现 ${alert.count} 次`
      });
    }

    // 2. 角色偏离检测
    if (state.identity.role || state.identity.traits.length > 0) {
      for (const log of recentLogs.slice(-20)) {
        const score = matchScore(log, state.identity);
        if (score < config.driftMatchScore) {
          alerts.push({
            type: 'drift',
            actionType: log.action_type,
            detail: log.detail,
            matchScore: Math.round(score * 100),
            threshold: Math.round(config.driftMatchScore * 100),
            severity: score < config.driftMatchScore / 2 ? 'high' : 'medium',
            message: `角色偏离: ${log.action_type} 与身份 ${state.identity.role || '未设置'} 不符 (匹配度 ${Math.round(score * 100)}%)`
          });
        }
      }
    }

    return {
      timestamp: new Date().toISOString(),
      hasAlerts: alerts.length > 0,
      alertCount: alerts.length,
      highSeverityCount: alerts.filter(a => a.severity === 'high').length,
      alerts
    };
  };
}

module.exports = { register };
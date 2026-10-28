const { recordEvent, parseArgs } = require('./shared');

function register(registry, storage) {
  const DECAY_FACTOR = 0.95;

  function requireText(value, name) {
    if (typeof value !== 'string' || value.trim() === '') {
      throw new Error(`Missing or empty argument: ${name}`);
    }
    return value.trim();
  }

  function calculateWeight(rule) {
    const total = rule.executions + rule.violations;
    if (total === 0) return rule.weight || 1;
    const successRate = rule.executions / total;
    return Math.round(successRate * DECAY_FACTOR * 100) / 100;
  }

  registry['add-rule'] = (id, description, source) => {
    const state = storage.load();
    const ruleId = requireText(id, 'id');
    if (state.rules[ruleId]) {
      throw new Error(`Rule ${ruleId} already exists`);
    }
    state.rules[ruleId] = {
      description: requireText(description, 'description'),
      source: source ? String(source) : 'unknown',
      weight: 1,
      executions: 0,
      violations: 0,
      createdAt: new Date().toISOString()
    };
    recordEvent(state, 'add-rule', ruleId, state.rules[ruleId].description);
    storage.save(state);
    return { success: true, rule: state.rules[ruleId] };
  };

  registry['check'] = (id) => {
    const state = storage.load();
    const rule = state.rules[requireText(id, 'id')];
    if (!rule) {
      throw new Error(`Rule ${id} not found`);
    }
    rule.executions += 1;
    rule.weight = calculateWeight(rule);
    rule.lastChecked = new Date().toISOString();
    storage.save(state);
    return { success: true, executions: rule.executions, weight: rule.weight };
  };

  registry['violation'] = (id, context) => {
    const state = storage.load();
    const rule = state.rules[requireText(id, 'id')];
    if (!rule) {
      throw new Error(`Rule ${id} not found`);
    }
    rule.violations += 1;
    rule.weight = calculateWeight(rule);
    rule.lastViolation = { context: context ? String(context) : '', timestamp: new Date().toISOString() };
    recordEvent(state, 'violation', id, rule.lastViolation.context);
    storage.save(state);
    return { success: true, violations: rule.violations, weight: rule.weight };
  };

  registry['rule-remove'] = (id, ...args) => {
    const { positional, flags } = parseArgs(args);
    const state = storage.load();
    const ruleId = requireText(id, 'id');
    const rule = state.rules[ruleId];
    if (!rule) {
      throw new Error(`Rule ${ruleId} not found`);
    }

    // --apply 后若跟了原因，「原因」会成为 apply 的值，故必须严格判 true
    const apply = flags.apply === true;
    const reason = positional[0] || 'manual remove';
    // 单引号包裹并转义，含引号/换行时仍可直接执行
    const quote = (value) => `'${String(value ?? '').replace(/'/g, "'\\''")}'`;
    const undo = `add-rule ${quote(ruleId)} ${quote(rule.description)} ${quote(rule.source)}`;

    if (!apply) {
      return { success: true, apply: false, dryRun: true, rule, undo };
    }

    delete state.rules[ruleId];
    recordEvent(state, 'rule-remove', ruleId, reason);
    storage.save(state);
    return { success: true, apply: true, dryRun: false, removed: rule, undo };
  };

  registry['stats'] = () => {
    const state = storage.load();
    const result = {};
    for (const [id, rule] of Object.entries(state.rules)) {
      result[id] = {
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
      };
    }
    return result;
  };
}

module.exports = { register };

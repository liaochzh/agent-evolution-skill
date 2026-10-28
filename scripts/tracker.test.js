const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { register } = require('./tracker');
const { Storage } = require('./storage');

const TEST_STATE = path.join('/tmp', `agent-evolution-test-${Date.now()}.json`);

describe('tracker', () => {
  let storage, registry;

  beforeEach(() => {
    storage = new Storage(TEST_STATE);
    registry = {};
    register(registry, storage);
  });

  afterEach(() => {
    try { fs.unlinkSync(TEST_STATE); } catch (_) {}
  });

  it('add-rule creates new rule with default weight', () => {
    const result = registry['add-rule']('r1', 'Test rule', 'AGENTS.md');
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.rule.weight, 1);
    assert.strictEqual(result.rule.executions, 0);
    assert.strictEqual(result.rule.violations, 0);
  });

  it('add-rule throws on duplicate', () => {
    registry['add-rule']('r1', 'Test rule', 'AGENTS.md');
    assert.throws(() => registry['add-rule']('r1', 'Test rule', 'AGENTS.md'), /already exists/);
  });

  it('check increments executions and updates weight', () => {
    registry['add-rule']('r1', 'Test rule', 'AGENTS.md');
    const r1 = registry['check']('r1');
    assert.strictEqual(r1.executions, 1);
    assert.strictEqual(r1.weight, 0.95); // 1 * 0.95
  });

  it('check throws on missing rule', () => {
    assert.throws(() => registry['check']('missing'), /not found/);
  });

  it('violation increments violations and reduces weight', () => {
    registry['add-rule']('r1', 'Test rule', 'AGENTS.md');
    registry['check']('r1'); // executions=1
    const v1 = registry['violation']('r1', 'context');
    assert.strictEqual(v1.violations, 1);
    // weight = (1/2) * 0.95 = 0.475 -> 0.48
    assert.strictEqual(v1.weight, 0.48);
  });

  it('stats returns all rules with computed fields', () => {
    registry['add-rule']('r1', 'Rule 1', 'AGENTS.md');
    registry['add-rule']('r2', 'Rule 2', 'SOUL.md');
    registry['check']('r1');
    registry['check']('r1');
    registry['violation']('r1', 'ctx');
    registry['check']('r2');

    const stats = registry['stats']();
    assert.ok(stats.r1);
    assert.ok(stats.r2);
    assert.strictEqual(stats.r1.executions, 2);
    assert.strictEqual(stats.r1.violations, 1);
    assert.strictEqual(stats.r1.successRate, 0.67); // 2/3
    assert.strictEqual(stats.r2.executions, 1);
    assert.strictEqual(stats.r2.violations, 0);
    assert.strictEqual(stats.r2.successRate, 1);
  });

  it('weight calculation: no executions = 1', () => {
    registry['add-rule']('r1', 'Test', 'src');
    const stats = registry['stats']();
    assert.strictEqual(stats.r1.weight, 1);
  });

  it('rule-remove defaults to dry-run', () => {
    registry['add-rule']('r1', 'Test rule', 'AGENTS.md');
    const result = registry['rule-remove']('r1', 'obsolete');

    assert.strictEqual(result.apply, false);
    assert.strictEqual(result.dryRun, true);
    assert.strictEqual(result.rule.description, 'Test rule');
    assert.ok(result.undo.includes("add-rule 'r1'"));
    assert.ok(storage.load().rules.r1);
  });

  it('rule-remove --apply deletes and records an event', () => {
    registry['add-rule']('r1', 'Test rule', 'AGENTS.md');
    // 严格布尔判定：`--apply 原因` 不会误删
    const guarded = registry['rule-remove']('r1', '--apply', '原因');
    assert.strictEqual(guarded.apply, false);
    assert.ok(storage.load().rules.r1);

    const result = registry['rule-remove']('r1', '--apply');
    assert.strictEqual(result.apply, true);
    assert.strictEqual(result.removed.description, 'Test rule');

    const state = storage.load();
    assert.ok(!state.rules.r1);
    assert.ok(state.events.some(event => event.op === 'rule-remove'));
  });

  it('rule-remove throws on missing rule', () => {
    assert.throws(() => registry['rule-remove']('missing', '--apply'), /not found/);
  });
});
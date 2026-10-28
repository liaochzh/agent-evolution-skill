const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { register } = require('./detector');
const { Storage } = require('./storage');

const TEST_STATE = path.join('/tmp', `agent-evolution-detector-test-${Date.now()}.json`);

describe('detector', () => {
  let storage, registry;

  beforeEach(() => {
    storage = new Storage(TEST_STATE);
    registry = {};
    register(registry, storage);
  });

  afterEach(() => {
    try { fs.unlinkSync(TEST_STATE); } catch (_) {}
  });

  it('log records action with session_id', () => {
    const result = registry['log']('edit', 'modified file.js');
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.entry.action_type, 'edit');
    assert.strictEqual(result.entry.detail, 'modified file.js');
    assert.ok(result.entry.session_id);
    assert.ok(result.entry.timestamp);
  });

  it('log rotates after 1000 entries', () => {
    for (let i = 0; i < 1005; i++) {
      registry['log']('action', `detail ${i}`);
    }
    const state = storage.load();
    assert.strictEqual(state.logs.length, 1000);
    assert.strictEqual(state.logs[0].detail, 'detail 5');
    assert.strictEqual(state.logs[999].detail, 'detail 1004');
  });

  it('detect finds repeated actions', () => {
    for (let i = 0; i < 5; i++) {
      registry['log']('edit', 'modified file.js');
    }
    const result = registry['detect']();
    assert.ok(result.alerts.length >= 1);
    const alert = result.alerts.find(a => a.type === 'repeat');
    assert.ok(alert);
    assert.strictEqual(alert.severity, 'medium');
    assert.ok(result.patterns[alert.patternId]);
  });

  it('detect finds high severity repeat', () => {
    for (let i = 0; i < 10; i++) {
      registry['log']('edit', 'modified file.js');
    }
    const result = registry['detect']();
    const alert = result.alerts.find(a => a.type === 'repeat');
    assert.strictEqual(alert.severity, 'high');
  });

  it('detect finds role drift', () => {
    // 设置身份为 planner
    storage.save({
      ...storage.load(),
      identity: { role: 'planner', traits: [], version: 1, history: [] }
    });
    
    // 记录 builder 类型的动作
    registry['log']('edit', 'implemented feature without planning');
    registry['log']('write', 'wrote code directly');
    
    const result = registry['detect']();
    const driftAlert = result.alerts.find(a => a.type === 'drift');
    assert.ok(driftAlert);
    assert.ok(driftAlert.message.includes('偏离'));
  });

  it('detect no drift when identity not set', () => {
    registry['log']('edit', 'any action');
    const result = registry['detect']();
    const driftAlert = result.alerts.find(a => a.type === 'drift');
    assert.strictEqual(driftAlert, undefined);
  });

  it('reset removes pattern', () => {
    for (let i = 0; i < 5; i++) {
      registry['log']('edit', 'modified file.js');
    }
    registry['detect']();
    const state = storage.load();
    const patternId = Object.keys(state.patterns)[0];
    assert.ok(patternId);
    
    const result = registry['reset'](patternId);
    assert.strictEqual(result.success, true);
    
    const state2 = storage.load();
    assert.strictEqual(state2.patterns[patternId], undefined);
  });

  it('reset throws on missing pattern', () => {
    assert.throws(() => registry['reset']('non-existent'), /not found/);
  });
});
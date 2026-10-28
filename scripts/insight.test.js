const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { register } = require('./insight');
const { Storage } = require('./storage');

const TEST_STATE = path.join('/tmp', `agent-evolution-insight-test-${Date.now()}.json`);

describe('insight', () => {
  let storage, registry;

  beforeEach(() => {
    storage = new Storage(TEST_STATE);
    registry = {};
    register(registry, storage);
  });

  afterEach(() => {
    try { fs.unlinkSync(TEST_STATE); } catch (_) {}
  });

  it('insight-add creates new insight', () => {
    const result = registry['insight-add']('INS-001', 'GitHub发布失败', '认证模式', '多位置搜索token');
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.insight.problem, 'GitHub发布失败');
    assert.strictEqual(result.insight.pattern, '认证模式');
    assert.strictEqual(result.insight.solution, '多位置搜索token');
    assert.deepStrictEqual(result.insight.similar, []);
    assert.deepStrictEqual(result.insight.applications, []);
  });

  it('insight-add throws on duplicate', () => {
    registry['insight-add']('INS-001', '问题', '模式', '方案');
    assert.throws(() => registry['insight-add']('INS-001', '其他', '模式', '方案'), /already exists/);
  });

  it('insight-list returns all insights', () => {
    registry['insight-add']('INS-001', 'GitHub发布失败', '认证模式', '多位置搜索');
    registry['insight-add']('INS-002', 'GitLab发布失败', '认证模式', '多位置搜索');
    const list = registry['insight-list']();
    assert.strictEqual(Object.keys(list).length, 2);
  });

  it('insight-migrate adds application', () => {
    registry['insight-add']('INS-001', 'GitHub发布失败', '认证模式', '多位置搜索');
    const result = registry['insight-migrate']('INS-001', 'ClawHub发布');
    assert.strictEqual(result.success, true);
    assert.ok(result.insight.applications.includes('ClawHub发布'));
    
    // 重复添加不应重复
    registry['insight-migrate']('INS-001', 'ClawHub发布');
    const list = registry['insight-list']();
    assert.strictEqual(list['INS-001'].applications_count, 1);
  });

  it('insight-similar adds similar problem', () => {
    registry['insight-add']('INS-001', 'GitHub发布失败', '认证模式', '多位置搜索');
    const result = registry['insight-similar']('INS-001', 'GitLab发布失败');
    assert.strictEqual(result.success, true);
    assert.ok(result.insight.similar.includes('GitLab发布失败'));
  });

  it('insight-migrate throws on missing insight', () => {
    assert.throws(() => registry['insight-migrate']('NOPE', '应用'), /not found/);
  });

  it('enforceLimits truncates insights', () => {
    const state = storage.load();
    state.config.limits.maxInsights = 2;
    storage.save(state);
    
    registry['insight-add']('INS-001', '问题1', '模式1', '方案1');
    registry['insight-add']('INS-002', '问题2', '模式2', '方案2');
    registry['insight-add']('INS-003', '问题3', '模式3', '方案3');
    
    const list = registry['insight-list']();
    assert.strictEqual(Object.keys(list).length, 2);
    assert.ok(!list['INS-001']);
    assert.ok(list['INS-002']);
    assert.ok(list['INS-003']);
  });
});
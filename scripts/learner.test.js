const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { register } = require('./learner');
const { Storage } = require('./storage');

const TEST_STATE = path.join('/tmp', `agent-evolution-learner-test-${Date.now()}.json`);

describe('learner', () => {
  let storage, registry;

  beforeEach(() => {
    storage = new Storage(TEST_STATE);
    registry = {};
    register(registry, storage);
  });

  afterEach(() => {
    try { fs.unlinkSync(TEST_STATE); } catch (_) {}
  });

  it('error-add creates new error', () => {
    const result = registry['error-add']('ERR-001', '认证失败', 'token过期', '验证token', '发布前检查');
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.error.title, '认证失败');
    assert.strictEqual(result.error.root_cause, 'token过期');
    assert.strictEqual(result.error.solution, '验证token');
    assert.strictEqual(result.error.prevention, '发布前检查');
    assert.deepStrictEqual(result.error.related, []);
  });

  it('error-add throws on duplicate', () => {
    registry['error-add']('ERR-001', '认证失败', 'token过期', '验证token', '发布前检查');
    assert.throws(() => registry['error-add']('ERR-001', '其他', '原因', '方案', '预防'), /already exists/);
  });

  it('error-list returns all errors', () => {
    registry['error-add']('ERR-001', '认证失败', 'token过期', '验证token', '发布前检查');
    registry['error-add']('ERR-002', '网络错误', '超时', '重试', '增加超时');
    const list = registry['error-list']();
    assert.strictEqual(Object.keys(list).length, 2);
    assert.strictEqual(list['ERR-001'].title, '认证失败');
    assert.strictEqual(list['ERR-002'].title, '网络错误');
  });

  it('error-analyze finds related errors by keywords', () => {
    registry['error-add']('ERR-001', 'GitHub auth failed', 'token expired', 'verify token', 'check before publish');
    registry['error-add']('ERR-002', 'GitLab auth failed', 'token invalid', 'refresh token', 'rotate tokens');
    registry['error-add']('ERR-003', 'Database connection failed', 'password wrong', 'fix password', 'config management');
    
    const result = registry['error-analyze']('ERR-001');
    assert.ok(result.related.length >= 1);
    const relatedIds = result.related.map(r => r.id);
    assert.ok(relatedIds.includes('ERR-002'));
    assert.ok(!relatedIds.includes('ERR-003'));
  });

  it('error-analyze throws on missing error', () => {
    assert.throws(() => registry['error-analyze']('NOPE'), /not found/);
  });

  it('error-analyze ignores weak one-bigram overlap in Chinese', () => {
    registry['error-add']('ERR-001', '认证失败', 'token 过期', '刷新 token', '定期检查');
    registry['error-add']('ERR-002', '网络失败', '请求超时', '重试请求', '增加超时时间');

    const result = registry['error-analyze']('ERR-001');
    assert.ok(!result.related.some(item => item.id === 'ERR-002'));
  });

  it('enforceLimits truncates errors', () => {
    // 设置较小的限制
    const state = storage.load();
    state.config.limits.maxErrors = 2;
    storage.save(state);
    
    registry['error-add']('ERR-001', '错误1', '原因1', '方案1', '预防1');
    registry['error-add']('ERR-002', '错误2', '原因2', '方案2', '预防2');
    registry['error-add']('ERR-003', '错误3', '原因3', '方案3', '预防3');
    
    const list = registry['error-list']();
    assert.strictEqual(Object.keys(list).length, 2);
    // 最旧的应该被删除
    assert.ok(!list['ERR-001']);
    assert.ok(list['ERR-002']);
    assert.ok(list['ERR-003']);
  });
});
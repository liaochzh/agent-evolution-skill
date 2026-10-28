const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { register: registerLesson } = require('./lesson');
const { register: registerLearner } = require('./learner');
const { register: registerDedupe } = require('./dedupe');
const { Storage } = require('./storage');

const TEST_STATE = path.join('/tmp', `agent-evolution-dedupe-test-${Date.now()}.json`);

describe('dedupe', () => {
  let storage, registry;

  beforeEach(() => {
    storage = new Storage(TEST_STATE);
    registry = {};
    registerLesson(registry, storage);
    registerLearner(registry, storage);
    registerDedupe(registry, storage);
  });

  afterEach(() => {
    try { fs.unlinkSync(TEST_STATE); } catch (_) {}
  });

  it('clusters near-duplicate Chinese lessons', () => {
    registry['lesson-add']('L-001', '修改共享代码前', '先 grep 调用方', '--confidence', '0.9');
    registry['lesson-add']('L-002', '改动共享代码前', '先 grep 所有调用方', '--confidence', '0.7');
    registry['lesson-add']('L-003', '数据库迁移前', '先做备份', '--confidence', '0.9');

    const result = registry['dedupe']('--kind', 'lessons');
    assert.strictEqual(result.clusterCount, 1);
    assert.deepStrictEqual(result.clusters[0].ids.sort(), ['L-001', 'L-002']);
    assert.strictEqual(result.clusters[0].suggested_keep, 'L-001');
  });

  it('clusters near-duplicate errors', () => {
    registry['error-add']('ERR-001', 'GitHub auth failed', 'token expired', 'refresh token', 'check expiry');
    registry['error-add']('ERR-002', 'GitHub auth failed', 'token invalid', 'refresh token', 'check expiry');
    registry['error-add']('ERR-003', 'Database connection failed', 'wrong password', 'reset password', 'use vault');

    const result = registry['dedupe']('--kind', 'errors');
    assert.strictEqual(result.clusterCount, 1);
    assert.deepStrictEqual(result.clusters[0].ids.sort(), ['ERR-001', 'ERR-002']);
  });

  it('reports nothing when everything is distinct', () => {
    registry['lesson-add']('L-001', '前端按钮样式', '先看设计稿', '--confidence', '0.9');
    registry['lesson-add']('L-002', '数据库迁移', '先做备份', '--confidence', '0.9');
    const result = registry['dedupe']('--kind', 'lessons');
    assert.strictEqual(result.clusterCount, 0);
  });

  it('rejects unknown kinds', () => {
    assert.throws(() => registry['dedupe']('--kind', 'nope'), /Invalid kind/);
  });
});

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { register } = require('./lesson');
const { Storage } = require('./storage');

const TEST_STATE = path.join('/tmp', `agent-evolution-lesson-test-${Date.now()}.json`);

describe('lesson', () => {
  let storage, registry;

  beforeEach(() => {
    storage = new Storage(TEST_STATE);
    registry = {};
    register(registry, storage);
  });

  afterEach(() => {
    try { fs.unlinkSync(TEST_STATE); } catch (_) {}
  });

  it('lesson-add creates a pending lesson by default', () => {
    const result = registry['lesson-add']('L-001', '修改共享代码前', '先 grep 调用方');
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.lesson.confidence, 0.5);
    assert.strictEqual(result.lesson.status, 'pending');
    assert.strictEqual(result.lesson.domain, 'general');
    assert.strictEqual(result.lesson.evidence.length, 0);
  });

  it('lesson-add activates when confidence reaches the threshold', () => {
    const result = registry['lesson-add']('L-001', 't', 'a', '--confidence', '0.9', '--domain', 'workflow');
    assert.strictEqual(result.lesson.status, 'active');
    assert.strictEqual(result.lesson.domain, 'workflow');
  });

  it('lesson-add accepts positional domain and confidence', () => {
    const result = registry['lesson-add']('L-001', 't', 'a', 'testing', '0.8');
    assert.strictEqual(result.lesson.domain, 'testing');
    assert.strictEqual(result.lesson.confidence, 0.8);
  });

  it('lesson-add reports similar lessons', () => {
    registry['lesson-add']('L-001', '修改共享代码前', '先 grep 调用方');
    const result = registry['lesson-add']('L-002', '修改共享代码时', '先 grep 所有调用方');
    assert.ok(result.similar.some(item => item.id === 'L-001'));
  });

  it('lesson-add rejects duplicate id and missing args', () => {
    registry['lesson-add']('L-001', 't', 'a');
    assert.throws(() => registry['lesson-add']('L-001', 't2', 'a2'), /already exists/);
    assert.throws(() => registry['lesson-add']('L-002', '', 'a'), /trigger/);
  });

  it('helpful feedback raises confidence and can activate', () => {
    registry['lesson-add']('L-001', 't', 'a');
    registry['lesson-feedback']('L-001', 'helpful', 'worked');
    const result = registry['lesson-feedback']('L-001', 'helpful');
    assert.strictEqual(result.lesson.confidence, 0.66);
    assert.strictEqual(result.lesson.status, 'active');
    assert.strictEqual(result.lesson.helpful, 2);
  });

  it('harmful feedback retires after repeated corrections', () => {
    registry['lesson-add']('L-001', 't', 'a');
    registry['lesson-feedback']('L-001', 'harmful');
    const result = registry['lesson-feedback']('L-001', 'harmful');
    assert.strictEqual(result.lesson.confidence, 0.1);
    assert.strictEqual(result.lesson.status, 'retired');
  });

  it('retired lessons must be promoted before feedback', () => {
    registry['lesson-add']('L-001', 't', 'a');
    registry['lesson-retire']('L-001', 'superseded');
    assert.throws(() => registry['lesson-feedback']('L-001', 'helpful'), /retired/);
    const promoted = registry['lesson-promote']('L-001');
    assert.strictEqual(promoted.lesson.status, 'active');
    assert.strictEqual(promoted.lesson.confidence, 0.6);
  });

  it('lesson-edit updates only allowed fields', () => {
    registry['lesson-add']('L-001', 't', 'a');
    const result = registry['lesson-edit']('L-001', 'action', '新动作');
    assert.strictEqual(result.lesson.action, '新动作');
    assert.throws(() => registry['lesson-edit']('L-001', 'confidence', '9'), /Invalid field/);
  });

  it('lesson-merge keeps the higher confidence and unions evidence', () => {
    registry['lesson-add']('L-001', 't1', 'a1', '--confidence', '0.7', '--evidence', 'e1');
    registry['lesson-add']('L-002', 't2', 'a2', '--confidence', '0.9', '--evidence', 'e2');
    const result = registry['lesson-merge']('L-001', 'L-002');
    assert.strictEqual(result.lesson.confidence, 0.9);
    assert.strictEqual(result.lesson.evidence.length, 2);
    assert.throws(() => registry['lesson-show']('L-002'), /not found/);
  });

  it('lesson-list filters by status and domain', () => {
    registry['lesson-add']('L-001', 't1', 'a1', '--confidence', '0.9', '--domain', 'workflow');
    registry['lesson-add']('L-002', 't2', 'a2', '--domain', 'testing');
    registry['lesson-add']('L-003', 't3', 'a3', '--confidence', '0.9', '--domain', 'testing');

    const active = registry['lesson-list']('--status', 'active');
    assert.strictEqual(active.lessons.length, 2);

    const testing = registry['lesson-list']('--domain', 'testing');
    assert.strictEqual(testing.lessons.length, 2);

    const strong = registry['lesson-list']('--min-confidence', '0.8');
    assert.strictEqual(strong.lessons.length, 2);
    assert.deepStrictEqual(strong.byStatus, { active: 2, pending: 1, retired: 0 });
  });
});

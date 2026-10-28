const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { register } = require('./review');
const { Storage } = require('./storage');

const TEST_STATE = path.join('/tmp', `agent-evolution-review-test-${Date.now()}.json`);

describe('review', () => {
  let storage, registry;

  beforeEach(() => {
    storage = new Storage(TEST_STATE);
    registry = {};
    register(registry, storage);
  });

  afterEach(() => {
    try { fs.unlinkSync(TEST_STATE); } catch (_) {}
  });

  it('review-task creates review with stable ID', () => {
    const result = registry['review-task']('实现登录', 90, '核心完成,测试通过', '需加错误处理');
    assert.strictEqual(result.success, true);
    assert.ok(result.review.id.startsWith('REV-'));
    assert.strictEqual(result.review.task, '实现登录');
    assert.strictEqual(result.review.completion, 90);
    assert.deepStrictEqual(result.review.highlights, ['核心完成', '测试通过']);
    assert.deepStrictEqual(result.review.improvements, ['需加错误处理']);
    assert.deepStrictEqual(result.review.learnings, []);
    assert.deepStrictEqual(result.review.error_ids, []);
    assert.deepStrictEqual(result.review.insight_ids, []);
  });

  it('review-task parses JSON array params', () => {
    const result = registry['review-task']('任务', 80, '["亮点1", "亮点2"]', '["改进1"]');
    assert.deepStrictEqual(result.review.highlights, ['亮点1', '亮点2']);
    assert.deepStrictEqual(result.review.improvements, ['改进1']);
  });

  it('review-task handles non-array JSON gracefully', () => {
    // 非数组 JSON 会回退到逗号分隔
    const result = registry['review-task']('任务', 80, '"单个值"', '"另一个值"');
    assert.deepStrictEqual(result.review.highlights, ['单个值']);
    assert.deepStrictEqual(result.review.improvements, ['另一个值']);
  });

  it('review-list returns reviews with IDs', () => {
    registry['review-task']('任务1', 90, '亮点1', '改进1');
    registry['review-task']('任务2', 80, '亮点2', '改进2');
    const list = registry['review-list']();
    assert.strictEqual(list.total, 2);
    assert.strictEqual(list.reviews.length, 2);
    assert.ok(list.reviews[0].id.startsWith('REV-'));
    assert.ok(list.reviews[1].id.startsWith('REV-'));
  });

  it('review-list respects limit', () => {
    registry['review-task']('任务1', 90, '亮点', '改进');
    registry['review-task']('任务2', 80, '亮点', '改进');
    registry['review-task']('任务3', 70, '亮点', '改进');
    const list = registry['review-list'](2);
    assert.strictEqual(list.reviews.length, 2);
    assert.strictEqual(list.total, 3);
  });

  it('review-detail finds by ID', () => {
    const createResult = registry['review-task']('任务', 90, '亮点', '改进');
    const id = createResult.review.id;
    const detail = registry['review-detail'](id);
    assert.strictEqual(detail.id, id);
    assert.strictEqual(detail.task, '任务');
  });

  it('review-detail throws on missing ID', () => {
    assert.throws(() => registry['review-detail']('REV-nonexistent'), /not found/);
  });

  it('review-link adds error reference by ID', () => {
    const createResult = registry['review-task']('任务', 90, '亮点', '改进');
    const id = createResult.review.id;
    registry['review-link'](id, 'error', 'ERR-001');
    const detail = registry['review-detail'](id);
    assert.ok(detail.error_ids.includes('ERR-001'));
  });

  it('review-link adds insight reference by ID', () => {
    const createResult = registry['review-task']('任务', 90, '亮点', '改进');
    const id = createResult.review.id;
    registry['review-link'](id, 'insight', 'INS-001');
    const detail = registry['review-detail'](id);
    assert.ok(detail.insight_ids.includes('INS-001'));
  });

  it('review-link throws on invalid type', () => {
    const createResult = registry['review-task']('任务', 90, '亮点', '改进');
    assert.throws(() => registry['review-link'](createResult.review.id, 'invalid', 'ID'), /Invalid type/);
  });

  it('review-learning adds learning by ID', () => {
    const createResult = registry['review-task']('任务', 90, '亮点', '改进');
    const id = createResult.review.id;
    registry['review-learning'](id, '学到的经验');
    const detail = registry['review-detail'](id);
    assert.ok(detail.learnings.includes('学到的经验'));
  });

  it('enforceLimits truncates reviews but IDs remain stable', () => {
    const state = storage.load();
    state.config.limits.maxReviews = 2;
    storage.save(state);
    
    const r1 = registry['review-task']('任务1', 90, '亮点', '改进');
    const r2 = registry['review-task']('任务2', 80, '亮点', '改进');
    const r3 = registry['review-task']('任务3', 70, '亮点', '改进');
    
    const list = registry['review-list']();
    assert.strictEqual(list.total, 2);
    // 最旧的被删除，但剩余的 ID 不变
    const ids = list.reviews.map(r => r.id);
    assert.ok(ids.includes(r2.review.id));
    assert.ok(ids.includes(r3.review.id));
    assert.ok(!ids.includes(r1.review.id));
    
    // 通过 ID 仍能找到
    const detail = registry['review-detail'](r2.review.id);
    assert.strictEqual(detail.task, '任务2');
  });
});
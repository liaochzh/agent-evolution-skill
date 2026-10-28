const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { register: registerLesson } = require('./lesson');
const { register: registerTracker } = require('./tracker');
const { register: registerLearner } = require('./learner');
const { register: registerInsight } = require('./insight');
const { register: registerReview } = require('./review');
const { register: registerSearch } = require('./search');
const { Storage } = require('./storage');

const TEST_STATE = path.join('/tmp', `agent-evolution-search-test-${Date.now()}.json`);

describe('search', () => {
  let storage, registry;

  beforeEach(() => {
    storage = new Storage(TEST_STATE);
    registry = {};
    registerLesson(registry, storage);
    registerTracker(registry, storage);
    registerLearner(registry, storage);
    registerInsight(registry, storage);
    registerReview(registry, storage);
    registerSearch(registry, storage);

    registry['error-add']('ERR-001', '认证失败', 'token 过期', '刷新 token', '定期检查');
    registry['insight-add']('INS-001', 'GitHub 发布失败', '认证模式', '多位置搜索 token');
    registry['lesson-add']('L-001', '修改认证代码前', '先检查 token 来源', '--confidence', '0.9');
    registry['add-rule']('no-guess', '禁止猜测，先读代码', 'AGENTS.md');
    registry['review-task']('修复认证过期', 80, '定位 token 问题', '补测试');
  });

  afterEach(() => {
    try { fs.unlinkSync(TEST_STATE); } catch (_) {}
  });

  it('search returns markdown grouped by kind', () => {
    const result = registry['search']('token 过期');
    assert.ok(result.__raw.startsWith('<!-- agent-evolution search'));
    assert.ok(result.__raw.includes('## 错误档案'));
    assert.ok(result.__raw.includes('ERR-001'));
    assert.ok(result.__raw.includes('## 复盘'));
  });

  it('search ranks the most relevant error first', () => {
    const result = registry['search']('token 过期', '--json');
    assert.strictEqual(result.hits[0].id, 'ERR-001');
    assert.ok(result.hits[0].score > 0);
  });

  it('search filters by kind and limit', () => {
    const errors = registry['search']('token 过期', '--kind', 'errors', '--json');
    assert.deepStrictEqual(errors.hits.map(hit => hit.kind), ['errors']);

    const limited = registry['search']('token 过期', '--limit', '1', '--json');
    assert.strictEqual(limited.hits.length, 1);
  });

  it('search excludes retired lessons and weak matches', () => {
    registry['lesson-retire']('L-001', 'old');
    const result = registry['search']('token 过期', '--json');
    assert.ok(!result.hits.some(hit => hit.id === 'L-001'));

    const strict = registry['search']('token 过期', '--min-score', '0.99', '--json');
    assert.strictEqual(strict.hits.length, 0);
  });

  it('search reports no hits in markdown', () => {
    const result = registry['search']('完全不存在的关键词zzz');
    assert.ok(result.__raw.includes('没有匹配的记忆'));
  });

  it('search validates inputs', () => {
    assert.throws(() => registry['search'](), /Missing query/);
    assert.throws(() => registry['search']('x', '--kind', 'nope'), /Invalid kind/);
  });
});

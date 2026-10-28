const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { register: registerLesson } = require('./lesson');
const { register: registerTracker } = require('./tracker');
const { register: registerRecall } = require('./recall');
const { Storage } = require('./storage');

const TEST_STATE = path.join('/tmp', `agent-evolution-recall-test-${Date.now()}.json`);
const TEST_GLOBAL = path.join('/tmp', `agent-evolution-recall-global-${Date.now()}.json`);

describe('recall', () => {
  let storage, registry;

  beforeEach(() => {
    process.env.AGENT_EVOLUTION_GLOBAL_STATE = TEST_GLOBAL;
    storage = new Storage(TEST_STATE);
    registry = {};
    registerLesson(registry, storage);
    registerTracker(registry, storage);
    registerRecall(registry, storage);

    registry['lesson-add']('L-001', '修改共享代码', '先 grep 调用方', '--confidence', '0.9', '--domain', 'workflow');
    registry['lesson-add']('L-002', '数据库迁移', '先备份再执行', '--confidence', '0.9', '--domain', 'database');
    registry['lesson-add']('L-003', '修改样式', '先看设计稿', '--confidence', '0.3', '--domain', 'workflow');
    registry['add-rule']('no-guess', '禁止猜测，先读代码', 'AGENTS.md');
  });

  afterEach(() => {
    try { fs.unlinkSync(TEST_STATE); } catch (_) {}
    try { fs.unlinkSync(TEST_GLOBAL); } catch (_) {}
    delete process.env.AGENT_EVOLUTION_GLOBAL_STATE;
  });

  it('recall returns markdown by default', () => {
    const result = registry['recall']('修改共享代码');
    assert.strictEqual(typeof result.__raw, 'string');
    assert.ok(result.__raw.startsWith('<!-- agent-evolution recall'));
    assert.ok(result.__raw.includes('[L-001]'));
    assert.ok(result.__raw.includes('[no-guess]'));
  });

  it('recall filters pending lessons and irrelevant lessons', () => {
    const result = registry['recall']('修改共享代码', '--json');
    const ids = result.lessons.map(item => item.id);
    assert.ok(ids.includes('L-001'));
    assert.ok(!ids.includes('L-002'));
    assert.ok(!ids.includes('L-003'));
  });

  it('recall respects threshold and domain filters', () => {
    const high = registry['recall']('修改共享代码', '--threshold', '0.95', '--json');
    assert.strictEqual(high.lessons.length, 0);

    const domain = registry['recall']('', '--domain', 'database', '--json');
    assert.deepStrictEqual(domain.lessons.map(item => item.id), ['L-002']);
  });

  it('recall can exclude rules', () => {
    const result = registry['recall']('修改共享代码', '--no-rules', '--json');
    assert.strictEqual(result.rules.length, 0);
  });

  it('recall ranks by relevance before confidence', () => {
    const result = registry['recall']('数据库迁移', '--json');
    assert.strictEqual(result.lessons[0].id, 'L-002');
  });

  it('recall falls back with a warning when nothing matches literally', () => {
    const result = registry['recall']('zzzz-not-found', '--json');
    assert.strictEqual(result.fallback, true);
    assert.ok(result.lessons.length > 0);
    const markdown = registry['recall']('zzzz-not-found').__raw;
    assert.ok(markdown.includes('未找到字面相关内容'));
  });

  it('recall --touch updates last_used and persists', () => {
    registry['recall']('修改共享代码', '--touch');
    const saved = storage.load();
    assert.ok(saved.lessons['L-001'].last_used);
  });

  it('recall prints a hint when memory is empty', () => {
    fs.unlinkSync(TEST_STATE);
    const result = registry['recall']('anything');
    assert.ok(result.__raw.includes('暂无高置信度经验'));
  });
});

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { register } = require('./assessment');
const { Storage } = require('./storage');

const TEST_STATE = path.join('/tmp', `agent-evolution-assessment-test-${Date.now()}.json`);

describe('assessment', () => {
  let storage, registry;

  beforeEach(() => {
    storage = new Storage(TEST_STATE);
    registry = {};
    register(registry, storage);
  });

  afterEach(() => {
    try { fs.unlinkSync(TEST_STATE); } catch (_) {}
  });

  it('assess returns default zero scores', () => {
    const result = registry['assess']();
    assert.strictEqual(result.technical.score, 0);
    assert.strictEqual(result.learning.score, 0);
    assert.strictEqual(result.project.score, 0);
    assert.strictEqual(result.communication.score, 0);
    assert.ok(result.technical.details.code_quality === 0);
    assert.ok(result.learning.details.knowledge_transfer === 0);
  });

  it('assess-update sets all sub-items for dimension', () => {
    registry['assess-update']('technical', 4);
    const result = registry['assess']();
    assert.strictEqual(result.technical.score, 4);
    assert.strictEqual(result.technical.details.code_quality, 4);
    assert.strictEqual(result.technical.details.architecture, 4);
    assert.strictEqual(result.technical.details.performance, 4);
    assert.strictEqual(result.technical.details.error_prevention, 4);
    // 其他维度不变
    assert.strictEqual(result.learning.score, 0);
  });

  it('assess-update throws on invalid dimension', () => {
    assert.throws(() => registry['assess-update']('invalid', 3), /Invalid dimension/);
  });

  it('assess-update throws on invalid score', () => {
    assert.throws(() => registry['assess-update']('technical', 0), /between 1 and 5/);
    assert.throws(() => registry['assess-update']('technical', 6), /between 1 and 5/);
    assert.throws(() => registry['assess-update']('technical', 'abc'), /between 1 and 5/);
  });

  it('assess-detail sets single sub-item', () => {
    registry['assess-detail']('learning', 'knowledge_transfer', 5);
    const result = registry['assess']();
    assert.strictEqual(result.learning.details.knowledge_transfer, 5);
    assert.strictEqual(result.learning.details.new_skills, 0);
    // learning 维度平均分 = 5/5 = 1
    assert.strictEqual(result.learning.score, 1);
  });

  it('assess-detail throws on invalid sub-dimension', () => {
    assert.throws(() => registry['assess-detail']('technical', 'invalid', 3), /Invalid sub-dimension/);
  });

  it('assess calculates average correctly', () => {
    registry['assess-detail']('technical', 'code_quality', 5);
    registry['assess-detail']('technical', 'architecture', 3);
    registry['assess-detail']('technical', 'performance', 4);
    registry['assess-detail']('technical', 'error_prevention', 2);
    // 平均 = (5+3+4+2)/4 = 3.5
    const result = registry['assess']();
    assert.strictEqual(result.technical.score, 3.5);
  });

  it('updated_at is set on updates', () => {
    const before = Date.now();
    registry['assess-update']('technical', 3);
    const result = registry['assess']();
    const after = Date.now();
    assert.ok(result.updated_at >= new Date(before).toISOString());
    assert.ok(result.updated_at <= new Date(after).toISOString());
  });
});
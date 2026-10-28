const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { register: registerLesson } = require('./lesson');
const { register: registerCrystallize } = require('./crystallize');
const { Storage } = require('./storage');

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-evolution-crystallize-'));
const TEST_STATE = path.join(TMP_DIR, 'state.json');

describe('crystallize', () => {
  let storage, registry;

  beforeEach(() => {
    storage = new Storage(TEST_STATE);
    registry = {};
    registerLesson(registry, storage);
    registerCrystallize(registry, storage);
  });

  afterEach(() => {
    fs.rmSync(TMP_DIR, { recursive: true, force: true });
  });

  it('refuses to crystallize fewer than two lessons', () => {
    registry['lesson-add']('L-001', '修改共享代码', '先 grep 调用方', '--confidence', '0.9', '--domain', 'workflow');
    assert.throws(() => registry['crystallize'](), /Not enough high-confidence lessons/);
  });

  it('renders a SKILL.md draft to stdout by default', () => {
    registry['lesson-add']('L-001', '修改共享代码', '先 grep 调用方', '--confidence', '0.9', '--domain', 'workflow');
    registry['lesson-add']('L-002', '提交前', '跑一遍相关测试', '--confidence', '0.8', '--domain', 'workflow');

    const result = registry['crystallize']('--domain', 'workflow');
    assert.ok(result.__raw.includes('name: learned-workflow'));
    assert.ok(result.__raw.includes('## Playbook'));
    assert.ok(result.__raw.includes('L-001'));
    assert.ok(result.__raw.includes('自动生成草稿'));
  });

  it('writes the draft only with --write', () => {
    registry['lesson-add']('L-001', '改共享代码', '先 grep 调用方', '--confidence', '0.9', '--domain', 'workflow');
    registry['lesson-add']('L-002', '提交前', '跑测试', '--confidence', '0.9', '--domain', 'workflow');

    const result = registry['crystallize']('--write', '--domain', 'workflow');
    assert.strictEqual(result.success, true);
    assert.ok(fs.existsSync(result.path));
    assert.strictEqual(result.path, path.join(TMP_DIR, 'evolved', 'learned-workflow', 'SKILL.md'));
    assert.ok(fs.readFileSync(result.path, 'utf8').includes('## When to Activate'));
  });

  it('rejects invalid skill names', () => {
    registry['lesson-add']('L-001', 'a', 'b', '--confidence', '0.9');
    registry['lesson-add']('L-002', 'c', 'd', '--confidence', '0.9');
    assert.throws(() => registry['crystallize']('--name', 'Bad Name!'), /Invalid skill name/);
  });
});

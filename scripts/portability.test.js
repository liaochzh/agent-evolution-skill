const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { register: registerLesson } = require('./lesson');
const { register: registerTracker } = require('./tracker');
const { register: registerLearner } = require('./learner');
const { register: registerInsight } = require('./insight');
const { register: registerPortability } = require('./portability');
const { Storage } = require('./storage');

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-evolution-portability-'));
const STATE_A = path.join(TMP_DIR, 'a.json');
const STATE_B = path.join(TMP_DIR, 'b.json');
const BUNDLE = path.join(TMP_DIR, 'bundle.json');

function makeRegistry(statePath) {
  const storage = new Storage(statePath);
  const registry = {};
  registerLesson(registry, storage);
  registerTracker(registry, storage);
  registerLearner(registry, storage);
  registerInsight(registry, storage);
  registerPortability(registry, storage);
  return { storage, registry };
}

describe('portability', () => {
  let a;

  beforeEach(() => {
    a = makeRegistry(STATE_A);
    a.registry['lesson-add']('L-001', '修改共享代码', '先 grep 调用方', '--confidence', '0.9', '--domain', 'workflow');
    a.registry['add-rule']('r1', '禁止猜测', 'AGENTS.md');
    a.registry['error-add']('ERR-001', '联系 user@example.com', 'token=abcdef123456', '轮换 token', '定期检查');
    a.registry['insight-add']('INS-001', '发布失败', '认证模式', '多位置搜索');
  });

  afterEach(() => {
    for (const file of [STATE_A, STATE_B, BUNDLE]) {
      try { fs.unlinkSync(file); } catch (_) {}
    }
  });

  it('export writes a redacted JSON bundle', () => {
    const result = a.registry['export']('--out', BUNDLE);
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.redacted, true);

    const raw = fs.readFileSync(BUNDLE, 'utf8');
    assert.ok(raw.includes('"bundle": "agent-evolution"'));
    assert.ok(!raw.includes('user@example.com'));
    assert.ok(!raw.includes('abcdef123456'));
    assert.ok(raw.includes('L-001'));
  });

  it('export --format md renders a playbook', () => {
    const result = a.registry['export']('--format', 'md', '--kind', 'lessons');
    assert.ok(result.__raw.includes('## 经验'));
    assert.ok(result.__raw.includes('L-001'));
    assert.ok(!result.__raw.includes('## 规则'));
  });

  it('import merges into a fresh store with a confidence cap', () => {
    a.registry['export']('--out', BUNDLE, '--no-redact');
    const b = makeRegistry(STATE_B);

    const result = b.registry['import'](BUNDLE);
    assert.strictEqual(result.success, true);
    assert.deepStrictEqual(result.added.lessons, ['L-001']);
    assert.strictEqual(result.cap, 0.6);

    const saved = b.storage.load();
    assert.strictEqual(saved.lessons['L-001'].confidence, 0.6);
    assert.strictEqual(saved.lessons['L-001'].status, 'active');
    assert.ok(saved.rules['r1'].source.startsWith('imported:'));
  });

  it('import --no-cap keeps the original confidence', () => {
    a.registry['export']('--out', BUNDLE, '--no-redact');
    const b = makeRegistry(STATE_B);
    b.registry['import'](BUNDLE, '--no-cap');
    assert.strictEqual(b.storage.load().lessons['L-001'].confidence, 0.9);
  });

  it('import reports conflicts instead of overwriting', () => {
    a.registry['export']('--out', BUNDLE, '--no-redact');
    const result = a.registry['import'](BUNDLE);
    assert.strictEqual(result.addedCount, 0);
    assert.deepStrictEqual(result.conflicts.lessons, ['L-001']);
  });

  it('import --dry-run does not create state', () => {
    a.registry['export']('--out', BUNDLE, '--no-redact');
    const b = makeRegistry(STATE_B);
    const result = b.registry['import'](BUNDLE, '--dry-run');
    assert.strictEqual(result.dryRun, true);
    assert.strictEqual(fs.existsSync(STATE_B), false);
  });

  it('rejects non-bundle files', () => {
    fs.writeFileSync(BUNDLE, JSON.stringify({ hello: 'world' }));
    assert.throws(() => a.registry['import'](BUNDLE), /Not an agent-evolution bundle/);
  });

  it('prune is dry-run by default and applies on request', () => {
    a.registry['lesson-add']('L-002', 't', 'a');
    a.registry['lesson-retire']('L-002', 'old');
    const state = a.storage.load();
    state.lessons['L-002'].updated_at = new Date(Date.now() - 200 * 86400000).toISOString();
    a.storage.save(state);

    const dry = a.registry['prune']('--days', '90');
    assert.strictEqual(dry.apply, false);
    assert.deepStrictEqual(dry.lessons.map(item => item.id), ['L-002']);
    assert.ok(a.storage.load().lessons['L-002']);

    const applied = a.registry['prune']('--days', '90', '--apply');
    assert.strictEqual(applied.apply, true);
    assert.strictEqual(a.storage.load().lessons['L-002'], undefined);
  });
});

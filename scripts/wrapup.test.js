const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { register: registerWrapup } = require('./wrapup');
const { register: registerLesson } = require('./lesson');
const { register: registerRecall } = require('./recall');
const { register: registerReview } = require('./review');
const { Storage } = require('./storage');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-evolution-wrapup-'));
const STATE = path.join(TMP, 'state.json');
const GLOBAL = path.join(TMP, 'global.json');

const LESSONS = JSON.stringify([
  { id: 'L-100', trigger: '修改认证代码前', action: '先查 token 来源', confidence: 0.7, evidence: '上次漏查导致回归' }
]);

describe('wrap-up', () => {
  let storage, registry;

  beforeEach(() => {
    process.env.AGENT_EVOLUTION_GLOBAL_STATE = GLOBAL;
    fs.rmSync(STATE, { force: true });
    fs.rmSync(GLOBAL, { force: true });
    storage = new Storage(STATE);
    registry = {};
    registerLesson(registry, storage);
    registerRecall(registry, storage);
    registerReview(registry, storage);
    registerWrapup(registry, storage);
  });

  afterEach(() => {
    delete process.env.AGENT_EVOLUTION_GLOBAL_STATE;
  });

  it('writes review and lessons in one transaction', () => {
    const result = registry['wrap-up']('实现登录', '90', '核心逻辑完成', '需加错误处理', '--lessons', LESSONS);
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.dryRun, false);

    const state = storage.load();
    assert.strictEqual(state.reviews.length, 1);
    assert.strictEqual(state.reviews[0].completion, 90);
    assert.strictEqual(state.reviews[0].improvements.length, 1);
    assert.strictEqual(state.lessons['L-100'].status, 'active');
    assert.strictEqual(state.lessons['L-100'].evidence.length, 1);
    assert.strictEqual(state.lessons['L-100'].helpful, 0);
  });

  it('auto-generates lesson ids and honours --dry-run', () => {
    const payload = JSON.stringify([{ trigger: 't', action: 'a' }]);
    const before = fs.existsSync(STATE) ? fs.readFileSync(STATE) : null;

    const result = registry['wrap-up']('任务', '50', 'h', 'i', '--lessons', payload, '--dry-run');
    assert.strictEqual(result.dryRun, true);
    assert.match(result.lessons[0].id, /^L-/);

    const after = fs.existsSync(STATE) ? fs.readFileSync(STATE) : null;
    assert.deepStrictEqual(after, before);
  });

  it('rejects a lesson id that already exists and writes nothing', () => {
    registry['lesson-add']('L-100', '旧经验', '旧动作', '--confidence', '0.7');
    const before = fs.readFileSync(STATE);

    assert.throws(
      () => registry['wrap-up']('任务', '80', 'h', 'i', '--lessons', LESSONS),
      /already exists/
    );
    assert.deepStrictEqual(fs.readFileSync(STATE), before);
  });

  it('rejects malformed --lessons json and invalid completion', () => {
    assert.throws(
      () => registry['wrap-up']('任务', '80', 'h', 'i', '--lessons', '[{bad json'),
      /Invalid --lessons JSON/
    );
    assert.throws(
      () => registry['wrap-up']('任务', 'abc', 'h', 'i'),
      /Invalid completion/
    );
    assert.ok(!fs.existsSync(STATE));
  });

  it('rejects links to missing error records', () => {
    assert.throws(
      () => registry['wrap-up']('任务', '80', 'h', 'i', '--link-error', 'ERR-404'),
      /not found/
    );
    assert.ok(!fs.existsSync(STATE));
  });

  it('produces lessons that downstream commands can consume', () => {
    registry['wrap-up']('实现登录', '90', 'h', 'i', '--lessons', LESSONS);
    registry['lesson-feedback']('L-100', 'helpful', '避免了一次回归');

    const lesson = storage.load().lessons['L-100'];
    assert.ok(Number.isFinite(lesson.confidence));
    assert.strictEqual(lesson.helpful, 1);

    const recall = registry['recall']('修改认证代码', '--json');
    assert.ok(recall.lessons.some(item => item.id === 'L-100'));
  });

  it('reports duplicate hints without blocking', () => {
    registry['lesson-add']('L-001', '修改认证代码前', '先查 token 来源', '--confidence', '0.7');
    const result = registry['wrap-up']('任务', '80', 'h', 'i', '--lessons', LESSONS);
    assert.ok(result.duplicateHints.some(hint => hint.id === 'L-001'));
  });
});

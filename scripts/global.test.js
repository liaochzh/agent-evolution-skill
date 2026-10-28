const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { register: registerLesson } = require('./lesson');
const { register: registerRecall } = require('./recall');
const { register: registerPortability } = require('./portability');
const { Storage } = require('./storage');

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-evolution-global-'));
const PROJECT_A = path.join(TMP_DIR, 'project-a.json');
const PROJECT_B = path.join(TMP_DIR, 'project-b.json');
const GLOBAL_STATE = path.join(TMP_DIR, 'global.json');

function makeRegistry(statePath) {
  const storage = new Storage(statePath);
  const registry = {};
  registerLesson(registry, storage);
  registerRecall(registry, storage);
  registerPortability(registry, storage);
  return { storage, registry };
}

describe('global lessons', () => {
  let a;

  beforeEach(() => {
    process.env.AGENT_EVOLUTION_GLOBAL_STATE = GLOBAL_STATE;
    for (const file of [PROJECT_A, PROJECT_B, GLOBAL_STATE]) {
      fs.rmSync(file, { force: true });
    }
    a = makeRegistry(PROJECT_A);
  });

  afterEach(() => {
    fs.rmSync(TMP_DIR, { recursive: true, force: true });
    delete process.env.AGENT_EVOLUTION_GLOBAL_STATE;
  });

  it('promote --global copies the lesson without local evidence notes', () => {
    a.registry['lesson-add']('L-001', '修改共享代码前', '先 grep 调用方', '--confidence', '0.9', '--evidence', '项目私有细节');
    const result = a.registry['lesson-promote']('L-001', '--global');

    assert.strictEqual(result.global.path, GLOBAL_STATE);
    const globalState = new Storage(GLOBAL_STATE).load();
    assert.strictEqual(globalState.lessons['L-001'].scope, 'global');
    assert.strictEqual(globalState.lessons['L-001'].trigger, '修改共享代码前');
    assert.strictEqual(globalState.lessons['L-001'].evidence[0].type, 'promotion');
    assert.ok(!JSON.stringify(globalState).includes('项目私有细节'));
  });

  it('recall merges global lessons into another project', () => {
    a.registry['lesson-add']('L-001', '修改共享代码前', '先 grep 调用方', '--confidence', '0.9');
    a.registry['lesson-promote']('L-001', '--global');

    const b = makeRegistry(PROJECT_B);
    const json = b.registry['recall']('修改共享代码', '--json');
    const hit = json.lessons.find(item => item.id === 'L-001');
    assert.ok(hit);
    assert.strictEqual(hit.scope, 'global');

    const markdown = b.registry['recall']('修改共享代码').__raw;
    assert.ok(markdown.includes('[G][L-001]'));
  });

  it('project lesson overrides a global lesson with the same id', () => {
    a.registry['lesson-add']('L-001', '修改共享代码前', '全局动作', '--confidence', '0.9');
    a.registry['lesson-promote']('L-001', '--global');

    const b = makeRegistry(PROJECT_B);
    b.registry['lesson-add']('L-001', '修改共享代码前', '项目内动作', '--confidence', '0.9');

    const json = b.registry['recall']('修改共享代码', '--json');
    const matches = json.lessons.filter(item => item.id === 'L-001');
    assert.strictEqual(matches.length, 1);
    assert.strictEqual(matches[0].action, '项目内动作');
    assert.strictEqual(matches[0].scope, 'project');
  });

  it('rejects global promotion below the threshold without mutating local state', () => {
    a.registry['lesson-add']('L-002', 't', 'a');
    assert.throws(() => a.registry['lesson-promote']('L-002', '--global'), /globalMinConfidence/);
    assert.strictEqual(a.storage.load().lessons['L-002'].status, 'pending');

    const forced = a.registry['lesson-promote']('L-002', '--global', '--force');
    assert.strictEqual(forced.global.confidence, 0.6);
  });

  it('lists and retires global lessons', () => {
    a.registry['lesson-add']('L-001', '修改共享代码前', '先 grep 调用方', '--confidence', '0.9');
    a.registry['lesson-promote']('L-001', '--global');

    const list = a.registry['lesson-list']('--global');
    assert.strictEqual(list.source, 'global');
    assert.strictEqual(list.total, 1);
    assert.strictEqual(list.lessons[0].scope, 'global');

    a.registry['lesson-retire']('L-001', 'obsolete', '--global');
    assert.strictEqual(new Storage(GLOBAL_STATE).load().lessons['L-001'].status, 'retired');

    const b = makeRegistry(PROJECT_B);
    const json = b.registry['recall']('修改共享代码', '--json');
    assert.ok(!json.lessons.some(item => item.id === 'L-001'));
  });

  it('prune --global removes stale retired global lessons', () => {
    a.registry['lesson-add']('L-001', '修改共享代码前', '先 grep 调用方', '--confidence', '0.9');
    a.registry['lesson-promote']('L-001', '--global');
    a.registry['lesson-retire']('L-001', 'obsolete', '--global');

    const globalStorage = new Storage(GLOBAL_STATE);
    const gs = globalStorage.load();
    gs.lessons['L-001'].updated_at = new Date(Date.now() - 200 * 86400000).toISOString();
    globalStorage.save(gs);

    const dry = a.registry['prune']('--global', '--days', '90');
    assert.strictEqual(dry.scope, 'global');
    assert.deepStrictEqual(dry.lessons.map(item => item.id), ['L-001']);

    a.registry['prune']('--global', '--days', '90', '--apply');
    assert.strictEqual(new Storage(GLOBAL_STATE).load().lessons['L-001'], undefined);
  });
});

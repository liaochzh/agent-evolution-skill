const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { register: registerRecall } = require('./recall');
const { register: registerDoctor } = require('./doctor');
const { register: registerBootstrap } = require('./bootstrap');
const { register: registerLesson } = require('./lesson');
const { register: registerReview } = require('./review');
const { Storage } = require('./storage');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-evolution-bootstrap-'));
const STATE = path.join(TMP, 'state.json');
const GLOBAL = path.join(TMP, 'global.json');

describe('bootstrap', () => {
  let storage, registry;

  beforeEach(() => {
    process.env.AGENT_EVOLUTION_GLOBAL_STATE = GLOBAL;
    fs.rmSync(STATE, { force: true });
    fs.rmSync(GLOBAL, { force: true });
    storage = new Storage(STATE);
    registry = {};
    registerLesson(registry, storage);
    registerReview(registry, storage);
    registerRecall(registry, storage);
    registerDoctor(registry, storage);
    registerBootstrap(registry, storage);
  });

  afterEach(() => {
    delete process.env.AGENT_EVOLUTION_GLOBAL_STATE;
  });

  it('returns recall output plus doctor reminders', () => {
    registry['lesson-add']('L-001', '修改认证代码前', '先查 token 来源', '--confidence', '0.9');
    const raw = JSON.parse(fs.readFileSync(STATE, 'utf8'));
    delete raw.config.lifecycle.globalMinConfidence;
    fs.writeFileSync(STATE, JSON.stringify(raw, null, 2));

    const output = registry['bootstrap']('修改认证代码').__raw;
    assert.ok(output.startsWith('<!-- agent-evolution recall'));
    assert.ok(output.includes('L-001'));
    assert.ok(output.includes('## 待办提醒'));
    assert.ok(output.includes('config_drift'));
  });

  it('never writes state, even with --touch', () => {
    registry['lesson-add']('L-001', '修改认证代码前', '先查 token 来源', '--confidence', '0.9');
    const before = fs.readFileSync(STATE);
    const filesBefore = fs.readdirSync(TMP).sort();

    registry['bootstrap']('修改认证代码', '--touch');

    assert.deepStrictEqual(fs.readFileSync(STATE), before);
    assert.deepStrictEqual(fs.readdirSync(TMP).sort(), filesBefore);
  });

  it('works on an empty state without throwing', () => {
    const output = registry['bootstrap']('任意任务');
    assert.ok(output.__raw.startsWith('<!-- agent-evolution recall'));
    assert.ok(!fs.existsSync(STATE));
  });

  it('appends improvements from the latest review', () => {
    registry['lesson-add']('L-001', '修改认证代码前', '先查 token 来源', '--confidence', '0.9');
    registry['review-task']('修复登录', 80, '定位到 token 问题', '补错误处理,补测试');

    const output = registry['bootstrap']('修改认证代码').__raw;
    assert.ok(output.includes('## 上次复盘待改进'));
    assert.ok(output.includes('补错误处理'));
  });

  it('returns structured json', () => {
    registry['lesson-add']('L-001', '修改认证代码前', '先查 token 来源', '--confidence', '0.9');
    const result = registry['bootstrap']('修改认证代码', '--json');
    assert.ok(Array.isArray(result.recall.lessons));
    assert.ok(Array.isArray(result.issues));
  });

  it('--no-doctor skips doctor reminders', () => {
    registry['lesson-add']('L-001', '修改认证代码前', '先查 token 来源', '--confidence', '0.9');
    const raw = JSON.parse(fs.readFileSync(STATE, 'utf8'));
    delete raw.config.lifecycle.globalMinConfidence;
    fs.writeFileSync(STATE, JSON.stringify(raw, null, 2));

    const output = registry['bootstrap']('修改认证代码', '--no-doctor').__raw;
    assert.ok(!output.includes('config_drift'));
    assert.ok(!output.includes('## 待办提醒'));
  });
});

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { register } = require('./doctor');
const { Storage, createDefaultState } = require('./storage');

const CLI = path.join(__dirname, 'evolution.js');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-evolution-doctor-'));
const STATE = path.join(TMP, 'state.json');
const GLOBAL = path.join(TMP, 'global.json');

function writeState(mutator) {
  const state = createDefaultState();
  if (mutator) mutator(state);
  fs.writeFileSync(STATE, JSON.stringify(state, null, 2));
  return state;
}

function readStateBytes() {
  return fs.readFileSync(STATE);
}

function listDir() {
  return fs.readdirSync(TMP).sort();
}

describe('doctor', () => {
  let storage, registry;

  beforeEach(() => {
    process.env.AGENT_EVOLUTION_GLOBAL_STATE = GLOBAL;
    fs.rmSync(GLOBAL, { force: true });
    fs.rmSync(STATE, { force: true });
    for (const file of listDir()) {
      if (file.includes('.doctor.bak')) fs.rmSync(path.join(TMP, file), { force: true });
    }
    storage = new Storage(STATE);
    registry = {};
    register(registry, storage);
  });

  afterEach(() => {
    delete process.env.AGENT_EVOLUTION_GLOBAL_STATE;
  });

  it('reports config drift from the raw file, not the migrated view', () => {
    writeState(state => {
      delete state.config.lifecycle.globalMinConfidence;
    });

    const result = registry['doctor']('--json');
    const issue = result.issues.find(item => item.code === 'config_drift');
    assert.ok(issue);
    assert.ok(issue.message.includes('config.lifecycle.globalMinConfidence'));
  });

  it('reports duplicate rules and lessons', () => {
    writeState(state => {
      state.rules['rule-0'] = {
        description: '接力棒文档规则: - 位置：`docs/baton/<模块名>.md`，按模块拆分',
        source: 'AGENTS.md', weight: 1, executions: 0, violations: 0
      };
      state.rules['rule-1'] = {
        description: '位置: `docs/baton/<模块名>.md`，按模块拆分',
        source: 'AGENTS.md', weight: 1, executions: 0, violations: 0
      };
    });

    const result = registry['doctor']('--json');
    const issue = result.issues.find(item => item.code === 'duplicate_rules');
    assert.ok(issue, JSON.stringify(result.issues));
    assert.ok(issue.message.includes('rule-0'));
    assert.ok(issue.message.includes('rule-1'));
  });

  it('uses --days for stale patterns and lessons', () => {
    const old = new Date(Date.now() - 45 * 86400000).toISOString();
    writeState(state => {
      state.patterns['drift-edit-test'] = { type: 'drift', count: 1, last_seen: old };
    });

    assert.ok(!registry['doctor']('--json').issues.some(item => item.code === 'stale_patterns'));
    const strict = registry['doctor']('--days', '30', '--json');
    assert.ok(strict.issues.some(item => item.code === 'stale_patterns'));
  });

  it('warns when a collection is near its limit', () => {
    writeState(state => {
      state.config.limits.maxEvents = 10;
      state.events = Array.from({ length: 9 }, (_, index) => ({
        timestamp: new Date().toISOString(),
        op: `op-${index}`,
        target: null,
        summary: ''
      }));
    });

    const issue = registry['doctor']('--json').issues.find(item => item.code === 'near_limit');
    assert.ok(issue);
    assert.ok(issue.message.includes('events 9/10'));
  });

  it('--fix fills config without touching business data', () => {
    writeState(state => {
      delete state.config.lifecycle.globalMinConfidence;
      state.rules['r1'] = { description: 'rule', source: 'x', weight: 1, executions: 0, violations: 0 };
      state.reviews.push({ id: 'REV-1', task: 't', completion: 50, highlights: [], improvements: [], learnings: [], error_ids: [], insight_ids: [], created_at: new Date().toISOString() });
    });

    const result = registry['doctor']('--fix', '--json');
    assert.strictEqual(result.fix.success, true);
    assert.ok(result.fix.fixed.includes('config.lifecycle.globalMinConfidence'));
    assert.ok(fs.existsSync(result.fix.backupPath));

    const raw = JSON.parse(fs.readFileSync(STATE, 'utf8'));
    assert.strictEqual(raw.config.lifecycle.globalMinConfidence, 0.8);
    assert.strictEqual(Object.keys(raw.rules).length, 1);
    assert.strictEqual(raw.reviews.length, 1);
  });

  it('--fix aborts instead of trimming when a collection is full', () => {
    writeState(state => {
      state.config.limits.maxEvents = 2;
      state.events = [
        { timestamp: '2026-01-01T00:00:00.000Z', op: 'a', target: null, summary: '' },
        { timestamp: '2026-01-02T00:00:00.000Z', op: 'b', target: null, summary: '' }
      ];
    });
    const before = readStateBytes();

    assert.throws(() => registry['doctor']('--fix'), /会删除数据/);
    assert.deepStrictEqual(readStateBytes(), before);
  });

  it('handles a missing state file and can create it with --fix', () => {
    const missing = registry['doctor']('--json');
    assert.strictEqual(missing.ok, true);
    assert.ok(missing.issues.some(item => item.code === 'state_missing'));

    const fixed = registry['doctor']('--fix', '--json');
    assert.strictEqual(fixed.fix.created, true);
    assert.ok(fs.existsSync(STATE));
  });

  it('does not crash on a type-corrupted state', () => {
    fs.writeFileSync(STATE, JSON.stringify({
      version: '3.0',
      config: [],
      rules: [],
      patterns: {},
      reviews: {},
      lessons: []
    }));

    const result = registry['doctor']('--json');
    assert.strictEqual(result.ok, true);
    assert.ok(result.issues.some(item => item.code === 'state_shape'));

    // 数组元素级损坏也不能把 doctor 崩掉
    fs.writeFileSync(STATE, JSON.stringify({ version: '3.0', reviews: [null] }));
    const elementLevel = registry['doctor']('--json');
    assert.strictEqual(elementLevel.ok, true);
  });

  it('keeps rc=0 when the state is corrupt', () => {
    fs.writeFileSync(STATE, '{not json');
    const run = spawnSync(process.execPath, [CLI, 'doctor', '--json'], {
      encoding: 'utf8',
      env: { ...process.env, AGENT_EVOLUTION_STATE: STATE, AGENT_EVOLUTION_GLOBAL_STATE: GLOBAL }
    });

    assert.strictEqual(run.status, 0, run.stderr);
    const payload = JSON.parse(run.stdout);
    assert.strictEqual(payload.ok, false);
    assert.ok(payload.issues.some(item => item.code === 'state_corrupt'));
  });
});

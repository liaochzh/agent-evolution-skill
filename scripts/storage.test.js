const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Storage } = require('./storage');

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-evolution-storage-'));
const TEST_STATE = path.join(TMP_DIR, 'state.json');

describe('Storage migration', () => {
  beforeEach(() => {
    fs.rmSync(TEST_STATE, { force: true });
    fs.rmSync(`${TEST_STATE}.v2.0.bak`, { force: true });
  });

  afterEach(() => {
    fs.rmSync(TEST_STATE, { force: true });
    fs.rmSync(`${TEST_STATE}.v2.0.bak`, { force: true });
  });

  it('migrates a 2.0 state without losing data', () => {
    const legacy = {
      version: '2.0',
      rules: { r1: { description: '禁止猜测', source: 'AGENTS.md', weight: 0.95, executions: 3, violations: 0, createdAt: '2026-01-01T00:00:00.000Z' } },
      identity: { role: 'planner', traits: ['careful'], version: 2, history: [], updatedAt: '2026-01-01T00:00:00.000Z' },
      patterns: {},
      logs: [{ timestamp: '2026-01-01T00:00:00.000Z', action_type: 'edit', detail: 'x', session_id: 's1' }],
      errors: { 'ERR-1': { title: 't', root_cause: 'r', solution: 's', prevention: 'p', related: [], created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z' } },
      insights: {},
      assessments: { updated_at: '', code_quality: 4 },
      reviews: [{ id: 'REV-1', task: 'x', completion: 90, highlights: [], improvements: [], learnings: [], error_ids: [], insight_ids: [], created_at: '2026-01-01T00:00:00.000Z' }],
      config: { thresholds: { repeatCount: 5, repeatWindowMinutes: 10, driftMatchScore: 0.3 }, limits: { maxLogs: 1000 } }
    };
    fs.writeFileSync(TEST_STATE, JSON.stringify(legacy), 'utf8');

    const storage = new Storage(TEST_STATE);
    const state = storage.load();

    assert.strictEqual(state.version, '3.0');
    assert.strictEqual(state.rules.r1.weight, 0.95);
    assert.strictEqual(state.identity.role, 'planner');
    assert.strictEqual(state.errors['ERR-1'].title, 't');
    assert.deepStrictEqual(state.lessons, {});
    assert.deepStrictEqual(state.events, []);
    assert.strictEqual(state.config.recall.minConfidence, 0.5);
    assert.strictEqual(state.config.lifecycle.activateConfidence, 0.6);
    assert.strictEqual(state.config.limits.maxLessons, 500);
    assert.ok(fs.existsSync(`${TEST_STATE}.v2.0.bak`));
  });

  it('reports invalid JSON with an actionable message', () => {
    fs.writeFileSync(TEST_STATE, '{ broken', 'utf8');
    const storage = new Storage(TEST_STATE);
    assert.throws(() => storage.load(), /not valid JSON/);
  });

  it('enforceLimits drops retired lessons first', () => {
    const storage = new Storage(TEST_STATE);
    const state = storage.defaultState();
    state.config.limits.maxLessons = 2;
    state.lessons = {
      'L-1': { status: 'retired', confidence: 0.5, created_at: '2026-01-01T00:00:00.000Z' },
      'L-2': { status: 'pending', confidence: 0.5, created_at: '2026-01-02T00:00:00.000Z' },
      'L-3': { status: 'active', confidence: 0.9, created_at: '2026-01-03T00:00:00.000Z' }
    };
    storage.save(state);
    const saved = storage.load();
    assert.deepStrictEqual(Object.keys(saved.lessons).sort(), ['L-2', 'L-3']);
  });

  it('enforceLimits caps events', () => {
    const storage = new Storage(TEST_STATE);
    const state = storage.defaultState();
    state.config.limits.maxEvents = 2;
    state.events = [
      { op: 'a' }, { op: 'b' }, { op: 'c' }
    ];
    storage.save(state);
    assert.deepStrictEqual(storage.load().events.map(event => event.op), ['b', 'c']);
  });
});

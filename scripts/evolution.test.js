const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-evolution-cli-'));
const TEST_STATE = path.join(TMP_DIR, 'state.json');
const CLI = path.join(__dirname, 'evolution.js');

function run(args) {
  return spawnSync(process.execPath, [CLI, ...args], {
    encoding: 'utf8',
    env: {
      ...process.env,
      AGENT_EVOLUTION_STATE: TEST_STATE,
      AGENT_EVOLUTION_GLOBAL_STATE: path.join(TMP_DIR, 'global.json')
    }
  });
}

describe('evolution CLI', () => {
  beforeEach(() => {
    fs.rmSync(TEST_STATE, { force: true });
  });

  afterEach(() => {
    fs.rmSync(TMP_DIR, { recursive: true, force: true });
  });

  it('init is idempotent and never overwrites existing data', () => {
    const first = run(['init']);
    assert.strictEqual(first.status, 0);
    assert.strictEqual(JSON.parse(first.stdout).created, true);

    const added = run(['add-rule', 'r1', '禁止猜测', 'AGENTS.md']);
    assert.strictEqual(added.status, 0);

    const second = run(['init']);
    assert.strictEqual(second.status, 0);
    const output = JSON.parse(second.stdout);
    assert.strictEqual(output.created, false);

    const stats = run(['stats']);
    assert.strictEqual(JSON.parse(stats.stdout).r1.description, '禁止猜测');
  });

  it('init --force resets the state', () => {
    run(['init']);
    run(['add-rule', 'r1', '禁止猜测', 'AGENTS.md']);
    const forced = run(['init', '--force']);
    assert.strictEqual(JSON.parse(forced.stdout).created, true);
    assert.deepStrictEqual(JSON.parse(run(['stats']).stdout), {});
  });

  it('recall prints raw markdown instead of JSON', () => {
    run(['init']);
    run(['lesson-add', 'L-001', '修改共享代码', '先 grep 调用方', '--confidence', '0.9']);
    const result = run(['recall', '修改共享代码']);
    assert.strictEqual(result.status, 0);
    assert.ok(result.stdout.startsWith('<!-- agent-evolution recall'));
    assert.ok(result.stdout.includes('[L-001]'));
  });

  it('prints structured errors and exits non-zero', () => {
    const result = run(['nope']);
    assert.strictEqual(result.status, 1);
    const error = JSON.parse(result.stderr);
    assert.strictEqual(error.error.code, 'UNKNOWN_COMMAND');
  });

  it('reports version', () => {
    const result = run(['version']);
    assert.strictEqual(JSON.parse(result.stdout).version, '3.0');
  });
});

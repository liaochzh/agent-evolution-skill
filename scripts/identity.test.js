const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { register } = require('./identity');
const { Storage } = require('./storage');

const TEST_STATE = path.join('/tmp', `agent-evolution-identity-test-${Date.now()}.json`);

describe('identity', () => {
  let storage, registry;

  beforeEach(() => {
    storage = new Storage(TEST_STATE);
    registry = {};
    register(registry, storage);
  });

  afterEach(() => {
    try { fs.unlinkSync(TEST_STATE); } catch (_) {}
  });

  it('identity returns default identity', () => {
    const identity = registry['identity']();
    assert.strictEqual(identity.role, '');
    assert.deepStrictEqual(identity.traits, []);
    assert.strictEqual(identity.version, 1);
    assert.deepStrictEqual(identity.history, []);
  });

  it('identity-update role updates field and increments version', () => {
    const result = registry['identity-update']('role', 'planner');
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.identity.role, 'planner');
    assert.strictEqual(result.identity.version, 2);
    assert.ok(result.identity.updatedAt);
  });

  it('identity-update traits accepts JSON array', () => {
    const result = registry['identity-update']('traits', '["analytical", "careful"]');
    assert.deepStrictEqual(result.identity.traits, ['analytical', 'careful']);
    assert.strictEqual(result.identity.version, 2);
  });

  it('identity-update traits accepts comma-separated string', () => {
    const result = registry['identity-update']('traits', 'analytical, careful, thorough');
    assert.deepStrictEqual(result.identity.traits, ['analytical', 'careful', 'thorough']);
  });

  it('identity-update throws on invalid field', () => {
    assert.throws(() => registry['identity-update']('invalid', 'value'), /Invalid field/);
  });

  it('evolve records event and increments version', () => {
    registry['identity-update']('role', 'planner'); // version 2
    const result = registry['evolve']('Added code reading step', 'user feedback');
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.event.change, 'Added code reading step');
    assert.strictEqual(result.event.trigger, 'user feedback');
    assert.strictEqual(result.event.version, 3);
    
    const identity = registry['identity']();
    assert.strictEqual(identity.version, 3);
    assert.strictEqual(identity.history.length, 1);
    assert.strictEqual(identity.history[0].change, 'Added code reading step');
  });

  it('multiple evolves accumulate history', () => {
    registry['evolve']('First change', 'trigger1');
    registry['evolve']('Second change', 'trigger2');
    const identity = registry['identity']();
    assert.strictEqual(identity.history.length, 2);
    assert.strictEqual(identity.version, 3);
  });
});
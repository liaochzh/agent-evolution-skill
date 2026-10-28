const { describe, it } = require('node:test');
const assert = require('node:assert');
const {
  tokenize,
  similarity,
  sharedTokenCount,
  redact,
  parseArgs,
  flagNumber,
  recencyScore,
  raw,
  clamp
} = require('./shared');

describe('shared utils', () => {
  it('tokenize splits CJK into bigrams', () => {
    const tokens = tokenize('修改共享代码');
    assert.ok(tokens.has('修改'));
    assert.ok(tokens.has('共享'));
    assert.ok(tokens.has('代码'));
    assert.ok(!tokens.has('修改共享代码'));
  });

  it('tokenize keeps ascii words and lowercases', () => {
    const tokens = tokenize('Use Grep BEFORE Edit');
    assert.ok(tokens.has('use'));
    assert.ok(tokens.has('grep'));
    assert.ok(tokens.has('before'));
  });

  it('similarity is high for near-duplicate Chinese text', () => {
    const score = similarity('修改共享代码前先 grep 调用方', '改动共享代码前先 grep 所有调用方');
    assert.ok(score > 0.5, `expected > 0.5, got ${score}`);
  });

  it('similarity is 0 for unrelated text and empty input', () => {
    assert.strictEqual(similarity('数据库连接池', '前端按钮样式'), 0);
    assert.strictEqual(similarity('', 'abc'), 0);
  });

  it('sharedTokenCount exposes weak overlap for caller-side filtering', () => {
    assert.strictEqual(sharedTokenCount('认证失败', '网络失败'), 1);
    assert.ok(sharedTokenCount('修改共享代码前', '改动共享代码前') >= 2);
  });

  it('redact hides tokens, emails and home paths', () => {
    const text = 'token=abcdef123456 ghp_abcdefghijklmnopqrstuvwx user@example.com /Users/lcr/project';
    const masked = redact(text);
    assert.ok(masked.includes('[REDACTED'));
    assert.ok(!masked.includes('abcdef123456'));
    assert.ok(!masked.includes('user@example.com'));
    assert.ok(!masked.includes('/Users/lcr/'));
  });

  it('parseArgs handles flags, equals form and negation', () => {
    const parsed = parseArgs(['query', '--limit', '5', '--domain=workflow', '--no-rules', '--dry-run']);
    assert.deepStrictEqual(parsed.positional, ['query']);
    assert.strictEqual(parsed.flags.limit, '5');
    assert.strictEqual(parsed.flags.domain, 'workflow');
    assert.strictEqual(parsed.flags.rules, false);
    assert.strictEqual(parsed.flags['dry-run'], true);
  });

  it('flagNumber falls back on invalid input', () => {
    assert.strictEqual(flagNumber('0.7', 0.5), 0.7);
    assert.strictEqual(flagNumber('abc', 0.5), 0.5);
    assert.strictEqual(flagNumber(undefined, 0.5), 0.5);
  });

  it('recencyScore decays with age', () => {
    const fresh = recencyScore(new Date().toISOString(), 30);
    const old = recencyScore(new Date(Date.now() - 90 * 86400000).toISOString(), 30);
    assert.ok(fresh > old);
    assert.ok(old > 0);
  });

  it('clamp and raw behave as documented', () => {
    assert.strictEqual(clamp(1.4, 0, 1), 1);
    assert.strictEqual(clamp(-1, 0, 1), 0);
    assert.deepStrictEqual(raw('x'), { __raw: 'x' });
  });
});

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { register, extractRules, extractRulesFromMarkdown, extractRulesFromYaml, extractRulesFromText } = require('./init-rules');
const { Storage } = require('./storage');

const TEST_STATE = path.join('/tmp', `agent-evolution-init-rules-test-${Date.now()}.json`);
const TEST_DIR = path.join('/tmp', `agent-evolution-test-files-${Date.now()}`);

describe('init-rules', () => {
  let storage, registry;

  beforeEach(() => {
    fs.mkdirSync(TEST_DIR, { recursive: true });
    storage = new Storage(TEST_STATE);
    registry = {};
    register(registry, storage);
  });

  afterEach(() => {
    try { fs.unlinkSync(TEST_STATE); } catch (_) {}
    try { fs.rmSync(TEST_DIR, { recursive: true }); } catch (_) {}
  });

  describe('extractRulesFromMarkdown', () => {
    it('extracts from headings', () => {
      const content = `## Rule One\nDescription one\n\n## Rule Two\nDescription two`;
      const rules = extractRulesFromMarkdown(content, 'test.md');
      assert.strictEqual(rules.length, 2);
      assert.ok(rules[0].description.includes('Rule One'));
      assert.ok(rules[1].description.includes('Rule Two'));
    });

    it('extracts from list with colon', () => {
      const content = `- Rule A: Description A\n- Rule B: Description B`;
      const rules = extractRulesFromMarkdown(content, 'test.md');
      assert.strictEqual(rules.length, 2);
    });

    it('extracts from list with dash', () => {
      const content = `- Rule A - Description A\n- Rule B - Description B`;
      const rules = extractRulesFromMarkdown(content, 'test.md');
      assert.strictEqual(rules.length, 2);
    });
  });

  describe('extractRulesFromYaml', () => {
    it('extracts from yaml rules array', () => {
      const content = `rules:\n  - id: r1\n    description: Desc 1\n  - id: r2\n    description: Desc 2`;
      const rules = extractRulesFromYaml(content, 'test.yaml');
      assert.strictEqual(rules.length, 2);
      assert.strictEqual(rules[0].id, 'r1');
      assert.strictEqual(rules[1].id, 'r2');
    });

    it('handles missing yaml gracefully', () => {
      const content = `rules:\n  - desc: test`;
      const rules = extractRulesFromYaml(content, 'test.yaml');
      assert.strictEqual(rules.length, 0); // 没有 description 字段
    });
  });

  describe('extractRulesFromText', () => {
    it('extracts each line as rule', () => {
      const content = `Line 1\nLine 2\n\nLine 3`;
      const rules = extractRulesFromText(content, 'test.txt');
      assert.strictEqual(rules.length, 3);
      assert.strictEqual(rules[0].description, 'Line 1');
    });
  });

  describe('init-rules command', () => {
    it('adds rules from markdown file', () => {
      const mdFile = path.join(TEST_DIR, 'rules.md');
      fs.writeFileSync(mdFile, `## No Guess\nDon't guess code\n## Read First\nRead before edit`);
      
      const result = registry['init-rules'](['--agents', mdFile]);
      assert.strictEqual(result.success, true);
      assert.strictEqual(result.added, 2);
      
      const state = storage.load();
      assert.strictEqual(Object.keys(state.rules).length, 2);
    });

    it('adds rules from multiple files', () => {
      const mdFile = path.join(TEST_DIR, 'agents.md');
      const txtFile = path.join(TEST_DIR, 'soul.txt');
      fs.writeFileSync(mdFile, `- Rule 1: Desc 1`);
      fs.writeFileSync(txtFile, `Line rule`);
      
      const result = registry['init-rules'](['--agents', mdFile, '--soul', txtFile]);
      assert.strictEqual(result.added, 2);
    });

    it('skips existing rules', () => {
      const mdFile = path.join(TEST_DIR, 'rules.md');
      fs.writeFileSync(mdFile, `## Rule 1\nDesc 1`);
      
      registry['init-rules']([mdFile]);
      const result = registry['init-rules']([mdFile]);
      
      assert.strictEqual(result.added, 0);
      assert.strictEqual(result.skipped, 1);
    });

    it('throws on no files', () => {
      assert.throws(() => registry['init-rules']([]), /No rule files specified/);
    });

    it('warns on missing file but continues', () => {
      const mdFile = path.join(TEST_DIR, 'exists.md');
      fs.writeFileSync(mdFile, `## Rule 1\nDesc 1`);
      
      const result = registry['init-rules'](['--agents', '/nonexistent.md', '--extra', mdFile]);
      assert.strictEqual(result.added, 1);
    });

    it('--dry-run reports without writing', () => {
      const mdFile = path.join(TEST_DIR, 'dry.md');
      fs.writeFileSync(mdFile, `## Rule 1\nDesc 1\n## Rule 2\nDesc 2`);

      const result = registry['init-rules'](['--agents', mdFile, '--dry-run']);
      assert.strictEqual(result.added, 2);
      assert.strictEqual(result.dryRun, true);
      assert.strictEqual(result.apply, false);
      assert.strictEqual(result.hint, null);
      assert.ok(!fs.existsSync(TEST_STATE));
    });

    it('does not write when nothing is new', () => {
      const mdFile = path.join(TEST_DIR, 'same.md');
      fs.writeFileSync(mdFile, `## Rule 1\nDesc 1`);

      registry['init-rules'](['--agents', mdFile]);
      const before = fs.readFileSync(TEST_STATE);

      const result = registry['init-rules'](['--agents', mdFile]);
      assert.strictEqual(result.added, 0);
      assert.strictEqual(result.skipped, 1);
      assert.deepStrictEqual(fs.readFileSync(TEST_STATE), before);
    });

    it('skips heading + list double extraction of the same line', () => {
      const mdFile = path.join(TEST_DIR, 'double.md');
      fs.writeFileSync(
        mdFile,
        '## 接力棒文档规则\n- 位置：`docs/baton/<模块名>.md`，按模块拆分，各会话只读写自己的\n'
      );

      const dry = registry['init-rules'](['--agents', mdFile, '--dry-run']);
      assert.strictEqual(dry.added, 1);
      assert.match(dry.hint, /复活/);

      const result = registry['init-rules'](['--agents', mdFile]);
      assert.strictEqual(result.total, 2);
      assert.strictEqual(result.added, 1);
      assert.strictEqual(result.duplicates[0].reason, 'similar');
    });

    it('does not treat --dry-run as a file path', () => {
      const mdFile = path.join(TEST_DIR, 'flag.md');
      fs.writeFileSync(mdFile, `## Rule 1\nDesc 1`);

      const result = registry['init-rules'](['--agents', mdFile, '--extra', '--dry-run']);
      assert.strictEqual(result.dryRun, true);
      assert.strictEqual(result.added, 1);
      assert.ok(!fs.existsSync(TEST_STATE));
    });
  });
});
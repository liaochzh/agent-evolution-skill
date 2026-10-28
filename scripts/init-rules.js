const fs = require('fs');
const path = require('path');
const { recordEvent } = require('./shared');

let yaml;
try {
  yaml = require('js-yaml');
} catch {
  yaml = null;
}

function extractRulesFromMarkdown(content, source) {
  const rules = [];
  let ruleIndex = 0;

  // 1. 标题格式：## 规则名称\n描述内容（支持多行描述，直到下一个标题或文件结束）
  // 使用更宽松的正则：匹配 ## 标题，然后捕获直到下一个 ## 或文件结束
  const headingRegex = /^##\s+(.+?)\n([\s\S]*?)(?=\n##\s|\n*$)/gm;
  let match;
  while ((match = headingRegex.exec(content)) !== null) {
    const title = match[1].trim();
    const desc = match[2].trim().split('\n')[0]; // 取第一行作为描述
    if (title && desc) {
      rules.push({
        id: `rule-${ruleIndex++}`,
        description: `${title}: ${desc}`,
        source
      });
    }
  }

  // 2. 列表格式：- 规则名称：描述（中文冒号或英文冒号）
  const listRegex = /^-\s+(.+?)[：:]\s*(.+)$/gm;
  while ((match = listRegex.exec(content)) !== null) {
    const title = match[1].trim();
    const desc = match[2].trim();
    if (title && desc) {
      rules.push({
        id: `rule-${ruleIndex++}`,
        description: `${title}: ${desc}`,
        source
      });
    }
  }

  // 3. 列表格式：- 规则名称 - 描述（单行，不跨行匹配）
  const dashRegex = /^-[ \t]+([^\n]+?)[ \t]+-[ \t]+([^\n]+)$/gm;
  while ((match = dashRegex.exec(content)) !== null) {
    const title = match[1].trim();
    const desc = match[2].trim();
    if (title && desc) {
      rules.push({
        id: `rule-${ruleIndex++}`,
        description: `${title}: ${desc}`,
        source
      });
    }
  }

  return rules;
}

function extractRulesFromYaml(content, source) {
  if (!yaml) return [];
  try {
    const doc = yaml.load(content);
    const rules = [];
    let ruleIndex = 0;
    
    if (doc.rules && Array.isArray(doc.rules)) {
      for (const rule of doc.rules) {
        if (rule.id && rule.description) {
          rules.push({
            id: rule.id,
            description: rule.description,
            source
          });
        } else if (rule.description) {
          rules.push({
            id: `rule-${ruleIndex++}`,
            description: rule.description,
            source
          });
        }
      }
    }
    return rules;
  } catch {
    return [];
  }
}

function extractRulesFromText(content, source) {
  const rules = [];
  const lines = content.split('\n').filter(l => l.trim());
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line) {
      rules.push({
        id: `rule-${i}`,
        description: line,
        source
      });
    }
  }
  return rules;
}

function extractRules(filePaths) {
  const allRules = [];
  let globalRuleIndex = 0;
  for (const filePath of filePaths) {
    if (!fs.existsSync(filePath)) {
      console.warn(`File not found: ${filePath}`);
      continue;
    }
    const content = fs.readFileSync(filePath, 'utf8');
    const ext = path.extname(filePath).toLowerCase();
    let rules = [];
    
    if (ext === '.md' || ext === '.markdown') {
      rules = extractRulesFromMarkdown(content, filePath);
    } else if (ext === '.yaml' || ext === '.yml') {
      rules = extractRulesFromYaml(content, filePath);
    } else {
      rules = extractRulesFromText(content, filePath);
    }
    
    // 重新分配唯一 ID
    for (const rule of rules) {
      rule.id = `rule-${globalRuleIndex++}`;
    }
    
    allRules.push(...rules);
  }
  return allRules;
}

function normalizeDescription(text) {
  return String(text || '')
    .replace(/[：:]/g, ':')
    .replace(/^[\s-]+/, '')
    .replace(/\s+/g, '')
    .toLowerCase();
}

/**
 * 近似重复判定：归一后相等，或短串被长串包含且长度比 >= 0.6。
 * 后者专治「## 标题 + 紧随列表项」被标题分支和列表分支各抽一次的同源双抽。
 */
function isNearDuplicate(a, b) {
  if (!a || !b) return false;
  if (a === b) return true;
  const short = a.length <= b.length ? a : b;
  const long = a.length <= b.length ? b : a;
  return short.length / long.length >= 0.6 && long.includes(short);
}

function register(registry, storage) {
  registry['init-rules'] = (...args) => {
    // args 可能是数组或展开的参数
    const argArray = args.length === 1 && Array.isArray(args[0]) ? args[0] : args;
    const filePaths = [];
    let dryRun = false;
    let i = 0;
    while (i < argArray.length) {
      const arg = argArray[i];
      if (arg === '--dry-run') {
        dryRun = true;
        i++;
        continue;
      }
      if (arg === '--agents' || arg === '--soul' || arg === '--extra') {
        // 下一个 token 以 -- 开头时不能再当路径，否则 --dry-run 会被吃掉
        if (i + 1 < argArray.length && !String(argArray[i + 1]).startsWith('--')) {
          filePaths.push(argArray[i + 1]);
          i++;
        }
        i++;
        continue;
      }
      if (typeof arg === 'string' && !arg.startsWith('--')) {
        filePaths.push(arg);
      }
      i++;
    }

    if (filePaths.length === 0) {
      throw new Error('No rule files specified. Use --agents, --soul, --extra or positional args');
    }

    const rules = extractRules(filePaths);
    const state = storage.load();

    const known = Object.entries(state.rules)
      .map(([id, rule]) => ({ id, key: normalizeDescription(rule.description) }));
    const accepted = [];
    const duplicates = [];
    let added = 0;
    let skipped = 0;

    for (const rule of rules) {
      const key = normalizeDescription(rule.description);
      const contentHit = known.find(item => isNearDuplicate(item.key, key))
        || accepted.find(item => isNearDuplicate(item.key, key));
      if (contentHit) {
        skipped++;
        duplicates.push({ description: rule.description, existingId: contentHit.id, reason: 'similar' });
        continue;
      }
      // 同 id 不同内容：保持原「跳过」语义，避免覆盖已有规则
      if (state.rules[rule.id]) {
        skipped++;
        duplicates.push({ description: rule.description, existingId: rule.id, reason: 'id_conflict' });
        continue;
      }

      state.rules[rule.id] = {
        description: rule.description,
        source: rule.source,
        weight: 1,
        executions: 0,
        violations: 0,
        createdAt: new Date().toISOString()
      };
      accepted.push({ id: rule.id, key });
      added++;
    }

    if (!dryRun && added > 0) {
      recordEvent(state, 'init-rules', null, `added=${added} skipped=${skipped}`);
      storage.save(state);
    }

    return {
      success: true,
      apply: !dryRun,
      dryRun,
      added,
      skipped,
      total: rules.length,
      duplicates,
      rules: rules.map(r => r.id),
      hint: dryRun && duplicates.length > 0
        ? '被跳过的近似项若由 rule-remove 删除后重跑，可能以新 id 复活'
        : null
    };
  };
}

module.exports = { register, extractRules, extractRulesFromMarkdown, extractRulesFromYaml, extractRulesFromText, normalizeDescription, isNearDuplicate };
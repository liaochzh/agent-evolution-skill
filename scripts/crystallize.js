const fs = require('fs');
const path = require('path');
const { TARGET_VERSION, parseArgs, flagNumber, nowIso, recordEvent, raw } = require('./shared');

function slugify(value) {
  return String(value || 'general')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'general';
}

function renderSkill(name, lessons, minConfidence) {
  const triggers = lessons.slice(0, 3).map(lesson => lesson.trigger);
  const description = `基于本项目沉淀的高置信经验自动生成的行为手册（草稿，需人工审核）。Use when ${triggers.join('; ')}`.slice(0, 500);

  const lines = [];
  lines.push('---');
  lines.push(`name: ${name}`);
  lines.push(`description: ${JSON.stringify(description)}`);
  lines.push('metadata:');
  lines.push('  generated_by: agent-evolution');
  lines.push(`  version: "${TARGET_VERSION}"`);
  lines.push(`  confidence_min: ${minConfidence}`);
  lines.push(`  lesson_count: ${lessons.length}`);
  lines.push('---');
  lines.push('');
  lines.push(`# ${name}`);
  lines.push('');
  lines.push('> 自动生成草稿，未经人工审核。确认触发条件与措辞后再作为正式 skill 使用。');
  lines.push('');
  lines.push('## When to Activate');
  for (const lesson of lessons) {
    lines.push(`- ${lesson.trigger}`);
  }
  lines.push('');
  lines.push('## Playbook');
  lessons.forEach((lesson, index) => {
    lines.push(`${index + 1}. **当** ${lesson.trigger} **时**，${lesson.action}。（c=${lesson.confidence.toFixed(2)}, domain=${lesson.domain || 'general'}）`);
  });
  lines.push('');
  lines.push('## Provenance');
  lines.push(`- lessons: ${lessons.map(lesson => lesson.id).join(', ')}`);
  lines.push(`- generated_at: ${nowIso()}`);
  lines.push('');
  return lines.join('\n');
}

function register(registry, storage) {
  registry['crystallize'] = (...args) => {
    const { flags } = parseArgs(args);
    const minConfidence = flagNumber(flags['min-confidence'], 0.8);
    const domain = flags.domain || null;
    const state = storage.load();

    const lessons = Object.entries(state.lessons)
      .filter(([, lesson]) => lesson.status === 'active')
      .filter(([, lesson]) => lesson.confidence >= minConfidence)
      .filter(([, lesson]) => !domain || lesson.domain === domain)
      .map(([id, lesson]) => ({ id, ...lesson }))
      .sort((a, b) => b.confidence - a.confidence);

    if (lessons.length < 2) {
      throw new Error(
        `Not enough high-confidence lessons (need >= 2, got ${lessons.length} at confidence >= ${minConfidence}). `
        + 'Use lesson-feedback helpful / lesson-promote to raise confidence first.'
      );
    }

    const name = flags.name
      ? String(flags.name)
      : `learned-${slugify(domain || 'playbook')}`;
    if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) {
      throw new Error(`Invalid skill name: ${name}. Use lowercase letters, digits and hyphens`);
    }

    const content = renderSkill(name, lessons, minConfidence);
    if (flags.write !== true) {
      return raw(content);
    }

    const targetDir = path.join(path.dirname(storage.filePath), 'evolved', name);
    const targetPath = path.join(targetDir, 'SKILL.md');
    fs.mkdirSync(targetDir, { recursive: true });
    fs.writeFileSync(targetPath, content, 'utf8');

    recordEvent(state, 'crystallize', name, `${lessons.length} lessons`);
    storage.save(state);

    return {
      success: true,
      path: targetPath,
      name,
      lessonCount: lessons.length,
      lessons: lessons.map(lesson => lesson.id)
    };
  };
}

module.exports = { register };

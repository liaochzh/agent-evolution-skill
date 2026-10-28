#!/usr/bin/env node
const fs = require('fs');
const { Storage } = require('./storage');
const { TARGET_VERSION, parseArgs } = require('./shared');
const { register: registerTracker } = require('./tracker');
const { register: registerIdentity } = require('./identity');
const { register: registerDetector } = require('./detector');
const { register: registerReporter } = require('./reporter');
const { register: registerInitRules } = require('./init-rules');
const { register: registerHeartbeat } = require('./heartbeat');
const { register: registerLearner } = require('./learner');
const { register: registerInsight } = require('./insight');
const { register: registerAssessment } = require('./assessment');
const { register: registerReview } = require('./review');
const { register: registerLesson } = require('./lesson');
const { register: registerRecall } = require('./recall');
const { register: registerSearch } = require('./search');
const { register: registerDedupe } = require('./dedupe');
const { register: registerPortability } = require('./portability');
const { register: registerCrystallize } = require('./crystallize');
const { register: registerDoctor } = require('./doctor');
const { register: registerBootstrap } = require('./bootstrap');
const { register: registerWrapup } = require('./wrapup');

class EvolutionError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function main() {
  const statePath = process.env.AGENT_EVOLUTION_STATE || Storage.getDefaultStatePath();

  const storage = new Storage(statePath);
  const registry = {};

  // 注册所有模块命令
  [
    registerTracker, registerIdentity, registerDetector, registerReporter, registerInitRules,
    registerHeartbeat, registerLearner, registerInsight, registerAssessment, registerReview,
    registerLesson, registerRecall, registerSearch, registerDedupe, registerPortability, registerCrystallize,
    registerDoctor, registerBootstrap, registerWrapup
  ].forEach(fn => fn(registry, storage));

  const args = process.argv.slice(2);
  const command = args[0];
  const cmdArgs = args.slice(1);

  if (!command) {
    printUsage();
    process.exit(1);
  }

  // 内置命令
  if (command === 'init') {
    const { flags } = parseArgs(cmdArgs);
    if (fs.existsSync(statePath) && flags.force !== true) {
      try {
        const current = storage.load();
        console.log(JSON.stringify({
          success: true,
          created: false,
          path: statePath,
          version: current.version,
          message: 'State already exists; nothing overwritten. Use init --force to reset.'
        }));
        return;
      } catch (e) {
        printError(new EvolutionError('EXECUTION_ERROR', `${e.message} Pass --force to overwrite.`));
        process.exit(1);
      }
    }
    if (fs.existsSync(statePath) && flags.force === true) {
      // --force 也先留底，避免误操作造成不可恢复的数据丢失
      try {
        fs.copyFileSync(statePath, `${statePath}.${Date.now()}.force.bak`);
      } catch {
        // 备份失败不阻塞显式重置
      }
    }
    storage.save(storage.defaultState());
    console.log(JSON.stringify({ success: true, created: true, version: TARGET_VERSION, path: statePath }));
    return;
  }

  if (command === 'help' || command === '--help' || command === '-h') {
    printUsage();
    return;
  }

  if (command === 'version' || command === '--version' || command === '-v') {
    console.log(JSON.stringify({ name: 'agent-evolution', version: TARGET_VERSION }));
    return;
  }

  const handler = registry[command];
  if (!handler) {
    const error = new EvolutionError('UNKNOWN_COMMAND', `Unknown command: ${command}`);
    printError(error);
    process.exit(1);
  }

  try {
    const result = handler(...cmdArgs);
    if (result !== undefined) {
      if (result && typeof result.__raw === 'string') {
        process.stdout.write(result.__raw.endsWith('\n') ? result.__raw : `${result.__raw}\n`);
      } else {
        console.log(JSON.stringify(result));
      }
    }
  } catch (e) {
    if (e instanceof EvolutionError) {
      printError(e);
    } else {
      printError(new EvolutionError('EXECUTION_ERROR', e.message));
    }
    process.exit(1);
  }
}

function printError(error) {
  console.error(JSON.stringify({ error: { code: error.code, message: error.message } }));
}

function printUsage() {
  console.log(`Agent Evolution v${TARGET_VERSION} - 行为固化与进化系统

用法: node evolution.js <command> [args]

规则与身份:
  init [--force]                初始化 state.json（已存在时不覆盖）
  add-rule <id> <desc> <source> 添加规则
  check <id>                    记录规则执行
  violation <id> <context>      记录违反
  stats                         查看规则统计
  identity                      查看身份
  identity-update <field> <value> 更新身份字段 (role|traits)
  evolve <change> <trigger>     记录进化事件

经验（推荐日常使用）:
  lesson-add <id> <trigger> <action> [--domain d] [--confidence 0.5] [--evidence "..."]
  lesson-feedback <id> <helpful|harmful> [note]
  lesson-promote <id> [--global] [--force]  提升为 active；--global 写入跨项目经验库
  lesson-retire <id> [reason] [--global]
  lesson-edit <id> <trigger|action|domain> <value>
  lesson-list [--status s] [--domain d] [--min-confidence 0.5] [--limit 50] [--global]
  lesson-show <id>
  lesson-merge <keepId> <dropId>
  recall [query] [--limit 8] [--threshold 0.5] [--domain d] [--no-rules] [--touch] [--json]
  search <query> [--kind all|errors|insights|lessons|reviews|rules] [--limit 10] [--min-score 0.15] [--json]

闭环入口:
  bootstrap [query] [--limit 8] [--domain d] [--threshold x] [--no-doctor] [--json]
                                任务开始：召回 + 体检提醒（只读）
  wrap-up <task> <completion> <highlights> <improvements> [--lessons json] [--link-error ids] [--link-insight ids] [--dry-run]
                                结束：复盘 + 经验单事务写入
  doctor [--days 90] [--fix] [--json]
                                状态体检；--fix 先备份再归一 config

复盘与错误:
  review-task <task> <completion> <highlights> <improvements>
  review-list [limit]
  review-detail <id|index>
  review-link <id|index> <error|insight> <refId>
  review-learning <id|index> <learning>
  error-add <id> <title> <root_cause> <solution> <prevention>
  error-update <id> <field> <value>
  error-list
  error-analyze <id>
  insight-add <id> <problem> <pattern> <solution>
  insight-update <id> <field> <value>
  insight-list
  insight-migrate <id> <application>
  insight-similar <id> <problem>

维护:
  dedupe [--kind all|lessons|errors|insights|rules] [--threshold 0.55]
  export [--format json|md] [--kind all] [--out path] [--no-redact]
  import <bundle.json> [--dry-run] [--cap 0.6] [--no-cap]
  crystallize [--domain d] [--min-confidence 0.8] [--write] [--name slug]
  prune [--days 90] [--pending-days 30] [--apply] [--global]
  rule-remove <id> [reason] [--apply]
  events [--limit 50]
  log <action_type> <detail>
  detect
  reset <pattern_id>
  report
  heartbeat
  init-rules [--agents] [--soul] [--extra...] [--dry-run]
  version

环境变量:
  AGENT_EVOLUTION_STATE         覆盖项目状态路径
  AGENT_EVOLUTION_GLOBAL_STATE  覆盖全局经验库路径
  OPENCODE_SESSION_ID           会话 ID (用于日志关联)

示例:
  node evolution.js init
  node evolution.js recall "修改登录逻辑"
  node evolution.js lesson-add L-001 "修改共享代码前" "先 grep 调用方" --domain workflow --confidence 0.7
  node evolution.js lesson-feedback L-001 helpful "避免了一次回归"
  node evolution.js lesson-promote L-001 --global
  node evolution.js review-task "实现登录" 90 "核心逻辑完成" "需加错误处理"
  node evolution.js bootstrap "修改登录逻辑"
  node evolution.js wrap-up "实现登录" 90 "核心逻辑完成" "需加错误处理" --lessons '[{"trigger":"改认证代码前","action":"先查 token 来源","confidence":0.7}]'
  node evolution.js doctor --days 30
  node evolution.js crystallize --min-confidence 0.8
`);
}

main();
